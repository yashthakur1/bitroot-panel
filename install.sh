#!/usr/bin/env bash
# BitPanel installer for Debian/Ubuntu.
#
#   curl -fsSL https://raw.githubusercontent.com/yashthakur1/bitroot-panel/main/install.sh | bash
#   ...or: git clone … && cd bitroot-panel && ./install.sh
#
# Installs the panel and the pieces it drives: Node, pm2, nginx, cloudflared,
# Garage, and the ~/bin scripts. Everything is idempotent - re-running it
# upgrades rather than duplicating - and nothing is installed that is already
# present at a good version.
#
# It deliberately does NOT invent secrets or touch DNS. Cloudflare and Tailscale
# need credentials only you have, so the script prepares the configuration and
# tells you the two or three things left to paste in.
set -euo pipefail

REPO="${BITPANEL_REPO:-https://github.com/yashthakur1/bitroot-panel.git}"
# A private repo needs a token for the clone. Passed in the environment rather
# than embedded in the URL, so it does not end up in the git remote on disk or
# in shell history any more than it has to.
GH_TOKEN="${GH_TOKEN:-${GITHUB_TOKEN:-}}"
APP_DIR="${BITPANEL_DIR:-$HOME/apps/bitroot-panel}"
BIN_DIR="$HOME/bin"
PANEL_PORT="${BITPANEL_PORT:-3210}"
DEFAULT_BRANCH="${BITPANEL_BRANCH:-main}"
NODE_MAJOR="${NODE_MAJOR:-22}"

# ─── progress ────────────────────────────────────────────────────────────────
# An installer that prints nothing for four minutes looks broken, and the honest
# fix is not a fake progress bar — it is saying which of a known number of steps
# is running, how long each took, and what failed.
#
# Everything noisy goes to a log file. It is printed only when a step fails,
# because that is the only time anyone wants apt's opinion.

LOG_FILE="${BITPANEL_LOG:-/tmp/bitpanel-install-$$.log}"
: > "$LOG_FILE"

# A pipe is not a terminal: `curl … | bash` with output redirected, or CI, gets
# plain lines with no spinner and no escape codes. NO_COLOR is honoured too.
if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then TTY=1; else TTY=0; fi
if [ "$TTY" = 1 ]; then
  C_DIM=$'\033[2m'; C_B=$'\033[1m'; C_G=$'\033[32m'; C_R=$'\033[31m'
  C_Y=$'\033[33m'; C_C=$'\033[36m'; C_0=$'\033[0m'
else
  C_DIM=''; C_B=''; C_G=''; C_R=''; C_Y=''; C_C=''; C_0=''
fi

STEP_TOTAL=11
STEP_N=0
STEP_LABEL=''
STEP_START=0
RUN_START=$(date +%s)
SPIN_PID=''

_elapsed() { local s=$(( $(date +%s) - $1 )); printf '%dm%02ds' $((s/60)) $((s%60)); }

_spin() {
  local frames='⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏' i=0
  while :; do
    i=$(( (i+1) % 10 ))
    printf '\r  %s%s%s %s' "$C_C" "${frames:$i:1}" "$C_0" "$STEP_LABEL"
    sleep 0.1
  done
}

_spin_stop() {
  [ -n "$SPIN_PID" ] || return 0
  kill "$SPIN_PID" 2>/dev/null || true
  wait "$SPIN_PID" 2>/dev/null || true
  SPIN_PID=''
  printf '\r\033[2K'
}

# step "Installing Node.js"
step() {
  _spin_stop
  STEP_N=$((STEP_N + 1))
  STEP_START=$(date +%s)
  local pct=$(( STEP_N * 100 / STEP_TOTAL ))
  STEP_LABEL="$(printf '%s[%2d/%d]%s %s%3d%%%s  %s' \
    "$C_DIM" "$STEP_N" "$STEP_TOTAL" "$C_0" "$C_B" "$pct" "$C_0" "$1")"
  echo "── step $STEP_N: $1 ──" >> "$LOG_FILE"
  if [ "$TTY" = 1 ]; then
    _spin & SPIN_PID=$!
  else
    printf '  [%2d/%d] %s\n' "$STEP_N" "$STEP_TOTAL" "$1"
  fi
}

# step_ok ["it was already there"]
step_ok() {
  _spin_stop
  local note=''
  [ $# -gt 0 ] && [ -n "$1" ] && note=" $1"
  if [ "$TTY" = 1 ]; then
    # The spinner erased its own line, so this reprints the label with a tick.
    printf '  %s✓%s %s%s%s%s  %s%s%s\n' \
      "$C_G" "$C_0" "$STEP_LABEL" "$C_DIM" "$note" "$C_0" \
      "$C_DIM" "$(_elapsed "$STEP_START")" "$C_0"
  else
    # The label was already printed when the step opened; repeating it turns a
    # log into two lines of the same thing.
    printf '         done in %s%s\n' "$(_elapsed "$STEP_START")" "$note"
  fi
}

# step_fail "the reason, in words a person can act on"
step_fail() {
  _spin_stop
  printf '  %s✗%s %s\n\n' "$C_R" "$C_0" "$STEP_LABEL"
  printf '  %s%s%s\n\n' "$C_R" "$1" "$C_0"
  printf '  %slast 20 lines of %s%s\n' "$C_DIM" "$LOG_FILE" "$C_0"
  tail -n 20 "$LOG_FILE" 2>/dev/null | sed 's/^/    /'
  printf '\n  %sthe whole log is at %s%s\n' "$C_DIM" "$LOG_FILE" "$C_0"
  exit 1
}

# run_quiet "what failed, in plain words" -- command args...
# Sends stdout and stderr to the log. On failure, says why and shows the tail.
run_quiet() {
  local why="$1"; shift
  [ "${1:-}" = "--" ] && shift
  if ! "$@" >>"$LOG_FILE" 2>&1; then
    step_fail "$why"
  fi
}

say()  { if [ "$TTY" = 1 ]; then :; else printf '     %s\n' "$*"; fi; echo "$*" >> "$LOG_FILE"; }
warn() { _spin_stop; printf '  %s!%s %s\n' "$C_Y" "$C_0" "$*"; echo "WARN: $*" >> "$LOG_FILE"; }
die()  { _spin_stop; printf '  %s✗%s %s\n' "$C_R" "$C_0" "$*" >&2; echo "DIE: $*" >> "$LOG_FILE"; exit 1; }

# A spinner left running after Ctrl-C keeps redrawing over the shell prompt.
trap '_spin_stop' EXIT INT TERM

# apt's own noise, and the reason this installer looked frozen: needrestart
# scans every running process and every kernel image after each install, prints
# "Scanning processes..." with no progress, and on some hosts stops to ask a
# question that nobody can answer through a pipe.
export DEBIAN_FRONTEND=noninteractive
export NEEDRESTART_MODE=a
export NEEDRESTART_SUSPEND=1

banner() {
  [ "$TTY" = 1 ] || return 0
  printf '\n'
  printf '  %s┌──────────────────────────────────────────┐%s\n' "$C_C" "$C_0"
  printf '  %s│%s  %sBitPanel%s — a deploy panel for a machine  %s│%s\n' "$C_C" "$C_0" "$C_B" "$C_0" "$C_C" "$C_0"
  printf '  %s│%s              you actually own            %s│%s\n' "$C_C" "$C_0" "$C_C" "$C_0"
  printf '  %s└──────────────────────────────────────────┘%s\n\n' "$C_C" "$C_0"
  printf '  %s%d steps. Around four minutes, most of it apt and the build.%s\n' "$C_DIM" "$STEP_TOTAL" "$C_0"
  printf '  %sFull log: %s%s\n\n' "$C_DIM" "$LOG_FILE" "$C_0"
}
banner
have() { command -v "$1" >/dev/null 2>&1; }

[ "$(id -u)" -ne 0 ] || die "run this as your normal user, not root — it installs into \$HOME and uses sudo only where needed"
have sudo || die "sudo is required"
. /etc/os-release 2>/dev/null || die "cannot read /etc/os-release — this installer targets Debian/Ubuntu"
case "${ID_LIKE:-$ID}" in *debian*|*ubuntu*) ;; *) die "this installer targets Debian/Ubuntu; found ${PRETTY_NAME:-$ID}" ;; esac

ARCH="$(dpkg --print-architecture)"
case "$ARCH" in
	amd64) GARAGE_ARCH=x86_64-unknown-linux-musl; PB_ARCH=linux_amd64 ;;
	arm64) GARAGE_ARCH=aarch64-unknown-linux-musl; PB_ARCH=linux_arm64 ;;
	*) die "unsupported architecture: $ARCH" ;;
esac

# ─── 1. system packages ──────────────────────────────────────────
step "System packages"
run_quiet "apt could not refresh its package lists — check the network and /etc/apt/sources.list" \
	-- sudo apt-get update -qq
run_quiet "apt could not install the base packages — the failing package is named in the log" \
	-- sudo apt-get install -y -qq git curl ca-certificates nginx netcat-openbsd jq unzip openssl
step_ok
# netcat matters: the panel probes reachability with `nc -z` because /dev/tcp is
# a bash feature and commands run under sh, which is dash on Debian too.

# ─── 2. node ─────────────────────────────────────────────────────
step "Node.js $NODE_MAJOR and pm2"
if have node && [ "$(node -p 'process.versions.node.split(".")[0]')" -ge "$NODE_MAJOR" ]; then
	NODE_NOTE="node $(node -v) already there"
else
	NODE_NOTE=''
	run_quiet "could not add the NodeSource repository — check outbound HTTPS to deb.nodesource.com" \
		-- sh -c "curl -fsSL 'https://deb.nodesource.com/setup_${NODE_MAJOR}.x' | sudo -E bash -"
	run_quiet "apt could not install nodejs — see the log" -- sudo apt-get install -y -qq nodejs
fi
have pm2 || run_quiet "npm could not install pm2 globally" -- sudo npm install -g pm2
step_ok "$NODE_NOTE"

# ─── 3. cloudflared ──────────────────────────────────────────────
step "cloudflared"
if have cloudflared; then
	step_ok "already there"
else
	run_quiet "could not download cloudflared for ${ARCH} from GitHub" \
		-- curl -fsSL -o /tmp/cloudflared.deb \
			"https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${ARCH}.deb"
	run_quiet "dpkg could not install cloudflared" -- sudo dpkg -i /tmp/cloudflared.deb
	rm -f /tmp/cloudflared.deb
	step_ok
fi

# ─── 4. garage ───────────────────────────────────────────────────
step "Garage object storage"
if have garage; then
	step_ok "already there"
else
	GARAGE_VER="${GARAGE_VERSION:-v2.1.0}"
	curl -fsSL -o /tmp/garage \
		"https://garagehq.deuxfleurs.fr/_releases/${GARAGE_VER}/${GARAGE_ARCH}/garage" \
		|| die "could not download Garage ${GARAGE_VER} for ${GARAGE_ARCH}"
	chmod +x /tmp/garage && sudo mv /tmp/garage /usr/local/bin/garage
	step_ok
fi

if [ ! -f /etc/garage.toml ]; then
	say "writing /etc/garage.toml"
	RPC_SECRET=$(openssl rand -hex 32)
	ADMIN_TOKEN=$(openssl rand -hex 32)
	mkdir -p "$HOME/storage/garage/meta" "$HOME/storage/garage/data"
	sudo tee /etc/garage.toml >/dev/null <<-EOF
		metadata_dir = "$HOME/storage/garage/meta"
		data_dir = "$HOME/storage/garage/data"
		db_engine = "sqlite"
		replication_factor = 1
		rpc_bind_addr = "[::]:3901"
		rpc_public_addr = "127.0.0.1:3901"
		rpc_secret = "$RPC_SECRET"

		[s3_api]
		s3_region = "garage"
		api_bind_addr = "[::]:3900"
		root_domain = ".s3.garage.localhost"

		[s3_web]
		bind_addr = "[::]:3902"
		root_domain = ".${DOMAIN_SUFFIX:-example.com}"
		index = "index.html"

		# Loopback only, deliberately. The admin API creates buckets, mints S3
		# keys and rewrites the cluster layout, with a bearer token as the only
		# thing in front of it. Nothing outside this machine needs to reach it —
		# the panel talks to it over 127.0.0.1 — and "[::]:3903" published it on
		# every interface while the port table promised loopback.
		[admin]
		api_bind_addr = "127.0.0.1:3903"
		admin_token = "$ADMIN_TOKEN"
	EOF
else
	say "/etc/garage.toml already exists — left alone"
	ADMIN_TOKEN=$(sudo grep -E '^admin_token' /etc/garage.toml | cut -d'"' -f2)
	# The one exception to leaving it alone. Installs made before this change
	# have the admin API on every interface; that is the bug being fixed, and a
	# re-run is the cheapest place to fix it. Only the address inside [admin] is
	# touched - [s3_api] and [s3_web] are meant to be reachable.
	ADMIN_BIND=$(awk '/^[[:space:]]*\[/ { s=$1 } s=="[admin]" && /^[[:space:]]*api_bind_addr[[:space:]]*=/ { print; exit }' /etc/garage.toml 2>/dev/null || true)
	case "$ADMIN_BIND" in
		*'"127.0.0.1:'*|*'"[::1]:'*|*'"localhost:'*|'') ;;
		*)
			say "moving the Garage admin API onto loopback (was ${ADMIN_BIND#*= })"
			ADMIN_PORT=$(printf '%s' "$ADMIN_BIND" | sed -n 's/.*:\([0-9]\{1,5\}\)".*/\1/p')
			ADMIN_TMP=$(mktemp)
			awk -v p="${ADMIN_PORT:-3903}" '
				/^[[:space:]]*\[/ { s=$1 }
				s=="[admin]" && /^[[:space:]]*api_bind_addr[[:space:]]*=/ { print "api_bind_addr = \"127.0.0.1:" p "\""; next }
				{ print }
			' /etc/garage.toml > "$ADMIN_TMP"
			if [ -s "$ADMIN_TMP" ]; then
				sudo cp "$ADMIN_TMP" /etc/garage.toml
				pm2 restart garage >/dev/null 2>&1 || true
			else
				warn "could not rewrite the Garage admin bind address — check [admin] api_bind_addr in /etc/garage.toml"
			fi
			rm -f "$ADMIN_TMP"
			;;
	esac
fi

# ─── 5. the panel itself ─────────────────────────────────────────
clone_url() {
	# Token goes in the URL only for the duration of the command; the remote is
	# rewritten to the clean URL immediately afterwards so the credential is not
	# left sitting in .git/config.
	if [ -n "$GH_TOKEN" ]; then
		echo "$REPO" | sed "s|https://|https://x-access-token:${GH_TOKEN}@|"
	else
		echo "$REPO"
	fi
}

# The version this installer belongs to, passed by the npm package. Without it
# there is nothing to pin to and main is the only sensible answer.
#
# This is what makes `bitpanel@x.y.z` mean anything: the CLI pinned *this
# script* to the tag, but the script then cloned the default branch, so the
# panel that arrived was whatever main happened to be that afternoon.
WANT_TAG=""
[ -n "${BITPANEL_VERSION:-}" ] && WANT_TAG="v${BITPANEL_VERSION#v}"

record_version() {
	# git describe is the truth, but a shallow clone can lose the tag on a later
	# fetch, so the resolved version is written down as well.
	{
		echo "ref=$(git -C "$APP_DIR" describe --tags --always 2>/dev/null || echo unknown)"
		echo "commit=$(git -C "$APP_DIR" rev-parse --short HEAD 2>/dev/null || echo unknown)"
		echo "installed=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
	} > "$APP_DIR/.bitpanel-version"
}

step "Panel source"
_spin_stop     # git writes its own progress; a spinner under it corrupts the line
if [ -d "$APP_DIR/.git" ]; then
	git -C "$APP_DIR" remote set-url origin "$(clone_url)"
	if [ -n "$WANT_TAG" ] && git -C "$APP_DIR" fetch --depth 1 origin "refs/tags/$WANT_TAG:refs/tags/$WANT_TAG" 2>/dev/null; then
		git -C "$APP_DIR" checkout -q --detach "$WANT_TAG"
		say "checked out $WANT_TAG"
	else
		# No tag asked for, or it does not exist upstream. A detached HEAD has no
		# branch to fast-forward, so re-attach before pulling.
		git -C "$APP_DIR" symbolic-ref -q HEAD >/dev/null 2>&1 || git -C "$APP_DIR" checkout -q "$DEFAULT_BRANCH" 2>/dev/null || true
		git -C "$APP_DIR" pull --ff-only
	fi
	git -C "$APP_DIR" remote set-url origin "$REPO"
	record_version
else
	mkdir -p "$(dirname "$APP_DIR")"
	if [ -n "$WANT_TAG" ] && git clone --depth 1 --branch "$WANT_TAG" "$(clone_url)" "$APP_DIR" 2>/dev/null; then
		say "cloned at $WANT_TAG"
		git -C "$APP_DIR" remote set-url origin "$REPO"
		record_version
	elif ! git clone --depth 1 "$(clone_url)" "$APP_DIR" 2>/dev/null; then
		if [ -z "$GH_TOKEN" ]; then
			die "clone failed. If the repository is private, supply a token:
    GH_TOKEN=ghp_xxx curl -fsSL -H \"Authorization: Bearer \$GH_TOKEN\" <raw-url>/install.sh | GH_TOKEN=\$GH_TOKEN bash
  The token needs the 'repo' scope (classic) or Contents:Read (fine-grained)."
		fi
		die "clone failed even with a token — check the token has access to $REPO"
	else
		git -C "$APP_DIR" remote set-url origin "$REPO"
		record_version
	fi
fi
step_ok

# ─── 6. environment ──────────────────────────────────────────────
ENV_FILE="$APP_DIR/.env"
step "Configuration"
if [ ! -f "$ENV_FILE" ]; then
	cat > "$ENV_FILE" <<-EOF
		PORT=$PANEL_PORT
		SESSION_SECRET=$(openssl rand -hex 32)
		DASHBOARD_PASSWORD=$(openssl rand -base64 18 | tr -dc 'A-Za-z0-9' | cut -c1-20)
		DOMAIN_SUFFIX=${DOMAIN_SUFFIX:-example.com}
		TAILNET_HOST=$(hostname)
		GARAGE_ADMIN_URL=http://127.0.0.1:3903
		GARAGE_ADMIN_TOKEN=${ADMIN_TOKEN:-}
		GARAGE_S3_URL=http://127.0.0.1:3900
		# Fill these in to enable routes, DNS cleanup and the edge cache rule:
		CF_API_TOKEN=
		CF_ZONE_ID=
	EOF
	chmod 600 "$ENV_FILE"
	NEW_ENV=1
	step_ok
else
	step_ok "kept the existing .env"
fi

# ─── 6b. the directories every script assumes ────────────────────
step "Directory layout"
mkdir -p "$HOME/apps" "$HOME/apps/static" "$HOME/repos" \
	"$HOME/etc/nginx/sites" "$HOME/.config/bitpanel" "$HOME/.cloudflared"
step_ok

# nginx serves the static sites from one config that includes a file per site.
if [ ! -f "$HOME/etc/nginx/nginx.conf" ]; then
	cat > "$HOME/etc/nginx/nginx.conf" <<-EOF
		worker_processes 1;
		error_log $HOME/etc/nginx/error.log;
		pid $HOME/etc/nginx/nginx.pid;
		events { worker_connections 256; }
		http {
		  include $(nginx -V 2>&1 | grep -oE 'conf-path=\S+' | cut -d= -f2 | xargs dirname)/mime.types;
		  default_type application/octet-stream;
		  access_log $HOME/etc/nginx/access.log;
		  client_body_temp_path $HOME/etc/nginx/tmp;
		  proxy_temp_path $HOME/etc/nginx/tmp-proxy;
		  fastcgi_temp_path $HOME/etc/nginx/tmp-fcgi;
		  uwsgi_temp_path $HOME/etc/nginx/tmp-uwsgi;
		  scgi_temp_path $HOME/etc/nginx/tmp-scgi;
		  sendfile on;
		  include $HOME/etc/nginx/sites/*.conf;
		}
	EOF
fi

# tunnel-add inserts each route above this marker, so the file has to exist and
# has to contain it. Without the marker the sed matches nothing and the route is
# silently never added.
if [ ! -f "$HOME/.cloudflared/config.yml" ]; then
	say "seeding ~/.cloudflared/config.yml"
	cat > "$HOME/.cloudflared/config.yml" <<-EOF
		# tunnel: <uuid>            # filled in by 'cloudflared tunnel create'
		# credentials-file: $HOME/.cloudflared/<uuid>.json

		ingress:
		  # Routes are inserted above the catch-all, which must stay last.
		  # Catch-all
		  - service: http_status:404
	EOF
	warn "~/.cloudflared/config.yml is a skeleton — add 'tunnel:' and 'credentials-file:' after 'cloudflared tunnel create'"
fi

# pm2 reads this when rebuilding from scratch; `project add` edits it.
[ -f "$HOME/ecosystem.config.js" ] || echo 'module.exports = { apps: [] };' > "$HOME/ecosystem.config.js"

# ─── 7. scripts and port registry ────────────────────────────────
step "Helper scripts"
mkdir -p "$BIN_DIR"
for f in "$APP_DIR"/server-scripts/*; do
	case "$(basename "$f")" in *.html) continue ;; esac
	install -m 755 "$f" "$BIN_DIR/$(basename "$f")"
done
[ -f "$HOME/bin/ports.conf" ] || printf '# name=port, one per line. A leading underscore reserves a port\n# without listing it as a service.\n' > "$HOME/bin/ports.conf"
case ":$PATH:" in *":$BIN_DIR:"*) ;; *) echo "export PATH=\"\$HOME/bin:\$PATH\"" >> "$HOME/.bashrc" ;; esac
step_ok

# ─── 8. build and run ────────────────────────────────────────────
step "Building the panel"
_spin_stop                    # this step prints its own output; see the note below
printf '  %s…this is the slow one, roughly two minutes%s\n' "$C_DIM" "$C_0"
cd "$APP_DIR"
# Dev dependencies are required: the build is a compile step, and without
# typescript Next cannot read the @/* path aliases out of tsconfig.json - every
# import then fails with "module not found" for files that are plainly there.
# --include=dev is explicit because npm silently drops them when NODE_ENV is
# production, which is exactly the environment an installer tends to run in.
#
# Output is not suppressed: a half-finished install that walks into the build
# produces a wall of "module not found" that looks like missing source, and
# that misdirection costs more than the noise saves.
npm ci --include=dev || npm install --include=dev || {
	echo "  dependency install failed - see the npm output above" >&2
	exit 1
}

# Assert rather than hope. If the toolchain is not there the build fails with an
# error that points at the wrong thing entirely.
if [ ! -d node_modules/typescript ]; then
	echo "  typescript is missing after install - the build cannot resolve @/* without it" >&2
	echo "  try: cd $APP_DIR && npm install --include=dev" >&2
	exit 1
fi

npm run build
step_ok

# ─── 8b. optional pieces the panel can manage ────────────────────
if [ ! -x "$HOME/apps/pocketbase/pocketbase" ]; then
	step "PocketBase"
	PB_VER="${POCKETBASE_VERSION:-0.30.0}"
	mkdir -p "$HOME/apps/pocketbase"
	if curl -fsSL -o /tmp/pb.zip \
		"https://github.com/pocketbase/pocketbase/releases/download/v${PB_VER}/pocketbase_${PB_VER}_${PB_ARCH}.zip"; then
		(cd "$HOME/apps/pocketbase" && unzip -oq /tmp/pb.zip pocketbase && chmod +x pocketbase)
		rm -f /tmp/pb.zip
	else
		warn "could not download PocketBase ${PB_VER} — the PocketBase page will be empty until it is installed"
	fi
	step_ok
fi

# PocketBase starts with no account at all, so the panel's Databases and Backups
# tabs have nothing to authenticate against and report the credentials as
# missing. Create one here and record it where the panel looks for it.
PB_CRED="$HOME/apps/pocketbase/.superuser"
if [ -x "$HOME/apps/pocketbase/pocketbase" ] && [ ! -f "$PB_CRED" ]; then
	say "creating the PocketBase superuser"
	PB_EMAIL="${POCKETBASE_EMAIL:-panel@bitpanel.local}"
	PB_PASSWORD="$(head -c 24 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | cut -c1-24)"
	# upsert writes to the same SQLite data directory the running instance holds
	# open, so stop it for the moment it takes rather than racing the lock.
	pm2 stop pocketbase >/dev/null 2>&1 || true
	if "$HOME/apps/pocketbase/pocketbase" superuser upsert "$PB_EMAIL" "$PB_PASSWORD" \
		--dir "$HOME/apps/pocketbase/pb_data" >/dev/null 2>&1; then
		printf 'PB_EMAIL=%s\nPB_PASSWORD=%s\n' "$PB_EMAIL" "$PB_PASSWORD" > "$PB_CRED"
		chmod 600 "$PB_CRED"
	else
		warn "could not create the PocketBase superuser — databases and backups stay unavailable until you run:
     ~/apps/pocketbase/pocketbase superuser upsert <email> <password> --dir ~/apps/pocketbase/pb_data"
	fi
	pm2 start pocketbase >/dev/null 2>&1 || true
fi

step "Starting services"
_spin_stop     # pm2 prints a table

# `pm2 start X --name N` does NOT fail when a process called N already exists.
# For most services pm2 notices the same script path and errors, so the `||
# restart` fallback fired and re-running was harmless. For the panel the script
# is `npm`, pm2 happily starts a second one, and it crash-loops forever on
# EADDRINUSE because the first still holds 3210 - then `pm2 save` persists the
# wreckage. The installer promises re-running upgrades rather than duplicating,
# so ask pm2 what exists instead of relying on start to fail.
pm2_has() { pm2 describe "$1" >/dev/null 2>&1; }

# How many processes carry this name. These are all single-instance services,
# so more than one means an earlier run duplicated it - and restarting a name
# restarts every copy, so they fight over the port forever.
pm2_count() {
	pm2 jlist 2>/dev/null | node -e '
		let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{
			try{console.log(JSON.parse(d).filter(p=>p.name===process.argv[1]).length);}
			catch(e){console.log(0);}
		});' "$1" 2>/dev/null || echo 0
}

# Collapse a duplicated name back to nothing, so the caller starts one clean
# copy. pm2 delete <name> removes every process carrying it.
pm2_dedupe() {
	if [ "$(pm2_count "$1")" -gt 1 ]; then
		say "removing duplicate \"$1\" processes left by an earlier run"
		pm2 delete "$1" >/dev/null 2>&1 || true
	fi
}

pm2_dedupe garage
if pm2_has garage; then pm2 restart garage >/dev/null
else pm2 start garage --name garage -- server >/dev/null 2>&1 || true; fi

# PORT has to be in the real environment: next start reads it there, not from
# .env, so writing PORT into .env alone silently leaves the panel on 3000
# while every link, nginx vhost and doc points at 3210.
pm2_dedupe bitroot-panel
if pm2_has bitroot-panel; then
	PORT="$PANEL_PORT" pm2 restart bitroot-panel --update-env >/dev/null
else
	PORT="$PANEL_PORT" pm2 start npm --name bitroot-panel --cwd "$APP_DIR" -- start >/dev/null 2>&1 || true
fi

pm2_dedupe nginx
if pm2_has nginx; then pm2 restart nginx >/dev/null
else pm2 start nginx --name nginx -- -c "$HOME/etc/nginx/nginx.conf" -g 'daemon off;' >/dev/null 2>&1 || true; fi

# The deploy webhook is what makes `git push` to this machine deploy anything.
if [ -x "$BIN_DIR/deploy-webhook" ]; then
	pm2_dedupe deploy-webhook
if pm2_has deploy-webhook; then pm2 restart deploy-webhook >/dev/null
	else pm2 start "$BIN_DIR/deploy-webhook" --name deploy-webhook >/dev/null 2>&1 || true; fi
fi

if [ -x "$HOME/apps/pocketbase/pocketbase" ]; then
	pm2_dedupe pocketbase
if pm2_has pocketbase; then pm2 restart pocketbase >/dev/null
	else pm2 start "$HOME/apps/pocketbase/pocketbase" --name pocketbase -- serve --http=127.0.0.1:8090 --dir "$HOME/apps/pocketbase/pb_data" >/dev/null 2>&1 || true; fi
fi

# An earlier install may have left duplicates behind; clear any that are stuck.
if pm2 jlist 2>/dev/null | grep -q '"status":"errored"'; then
	say "removing errored duplicates left by an earlier run"
	pm2 jlist 2>/dev/null | node -e '
		let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{
			try{JSON.parse(d).filter(p=>p.pm2_env&&p.pm2_env.status==="errored")
				.forEach(p=>console.log(p.pm_id));}catch(e){}
		});' | while read -r id; do
		[ -n "$id" ] && pm2 delete "$id" >/dev/null 2>&1 || true
	done
fi
pm2 save >/dev/null
# Boot persistence. `pm2 startup` does the registration itself whenever it can
# reach sudo, and only *prints* a `sudo …` line for you to run when it cannot.
# The old form here piped its output into grep and trusted the pipeline's exit
# status: on every machine where pm2 succeeded there was no `sudo` line to
# match, grep exited 1, `set -o pipefail` turned that into a failure, and the
# warning fired directly underneath pm2's own "[v] Command successfully
# executed." Ask systemd instead of guessing from an exit code - the unit being
# enabled is the thing that was actually wanted.
PM2_UNIT="pm2-$USER"
if ! have systemctl; then
	warn "no systemd here, so pm2 will not start at boot — start it yourself, or run 'pm2 startup' for the right instructions"
else
	PM2_STARTUP_OUT=$(pm2 startup systemd -u "$USER" --hp "$HOME" 2>&1 || true)
	# Present only when pm2 declined to run it, which is the case worth acting on.
	PM2_STARTUP_CMD=$(printf '%s\n' "$PM2_STARTUP_OUT" | grep -E '^[[:space:]]*sudo ' | head -1 || true)
	if [ -n "$PM2_STARTUP_CMD" ]; then
		eval "$PM2_STARTUP_CMD" >/dev/null 2>&1 || true
	fi
	if systemctl is-enabled "$PM2_UNIT" >/dev/null 2>&1; then
		say "pm2 will start at boot ($PM2_UNIT is enabled)"
	else
		warn "could not register pm2 with systemd automatically — run 'pm2 startup' and follow its instructions"
	fi
fi

# a single-node Garage still needs a layout before it will accept objects
if ! garage status 2>/dev/null | grep -q 'NO ROLE ASSIGNED'; then
	say "garage layout already assigned"
else
	NODE_ID=$(garage status 2>/dev/null | awk '/NO ROLE ASSIGNED/{print $1}' | head -1)
	if [ -n "$NODE_ID" ]; then
		say "assigning garage layout"
		garage layout assign "$NODE_ID" -z local -c "${GARAGE_CAPACITY:-50G}" >/dev/null
		garage layout apply --version 1 >/dev/null
	fi
fi

# ─── 9. what is left for a human ─────────────────────────────────
echo
# Every address this panel can actually be opened on. Printing only the
# loopback one is useless from the laptop you are almost certainly sitting at,
# and leaves people guessing what to substitute for "this machine".
LAN_IP=$(hostname -I 2>/dev/null | awk '{print $1}')
TS_NAME=$(tailscale status --json 2>/dev/null | sed -n 's/.*"DNSName":"\([^"]*\)".*/\1/p' | head -1 | sed 's/\.$//')

step_ok
printf '\n  %s✓ done in %s%s\n\n' "$C_G" "$(_elapsed "$RUN_START")" "$C_0"

say "BitPanel is running"
echo "    on this machine:  http://127.0.0.1:$PANEL_PORT"
[ -n "$LAN_IP" ] && echo "    on your network:  http://$LAN_IP:$PANEL_PORT"
[ -n "$TS_NAME" ] && echo "    over Tailscale:   http://$TS_NAME:$PANEL_PORT"
if [ "${NEW_ENV:-0}" = "1" ]; then
	echo ""
	echo "    password:         $(grep '^DASHBOARD_PASSWORD=' "$ENV_FILE" | cut -d= -f2)"
	echo "    (you will be asked to replace this with one of your own)"
fi
cat <<EOF

  Open one of those addresses and sign up: pick an email and a password, and
  the panel takes it from there — domain, Cloudflare, storage. You do not need
  to edit any files by hand.

  Config -> Setup then shows what this machine can and cannot do yet, and takes
  each credential right there. What it will ask for:

    * a domain, if you want public URLs
    * a Cloudflare API token, for DNS and the edge cache rule
    * Tailscale, for private access without opening anything:
        curl -fsSL https://tailscale.com/install.sh | sh && sudo tailscale up
    * a Cloudflare tunnel, for public routes:
        cloudflared tunnel login && cloudflared tunnel create \$(hostname)
      (the login opens a browser — do it from a machine that has one)

EOF
