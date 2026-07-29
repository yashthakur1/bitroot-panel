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

say()  { printf '\033[1m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[33m !!\033[0m %s\n' "$*"; }
die()  { printf '\033[31m !!\033[0m %s\n' "$*" >&2; exit 1; }
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
say "installing system packages"
sudo apt-get update -qq
sudo apt-get install -y -qq git curl ca-certificates nginx netcat-openbsd jq unzip openssl >/dev/null
# netcat matters: the panel probes reachability with `nc -z` because /dev/tcp is
# a bash feature and commands run under sh, which is dash on Debian too.

# ─── 2. node ─────────────────────────────────────────────────────
if have node && [ "$(node -p 'process.versions.node.split(".")[0]')" -ge "$NODE_MAJOR" ]; then
	say "node $(node -v) already present"
else
	say "installing Node.js $NODE_MAJOR"
	curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | sudo -E bash - >/dev/null
	sudo apt-get install -y -qq nodejs >/dev/null
fi
have pm2 || { say "installing pm2"; sudo npm install -g pm2 >/dev/null; }

# ─── 3. cloudflared ──────────────────────────────────────────────
if have cloudflared; then
	say "cloudflared already present"
else
	say "installing cloudflared"
	curl -fsSL -o /tmp/cloudflared.deb \
		"https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${ARCH}.deb"
	sudo dpkg -i /tmp/cloudflared.deb >/dev/null && rm -f /tmp/cloudflared.deb
fi

# ─── 4. garage ───────────────────────────────────────────────────
if have garage; then
	say "garage already present ($(garage --version 2>/dev/null | head -1))"
else
	say "installing Garage"
	GARAGE_VER="${GARAGE_VERSION:-v2.1.0}"
	curl -fsSL -o /tmp/garage \
		"https://garagehq.deuxfleurs.fr/_releases/${GARAGE_VER}/${GARAGE_ARCH}/garage" \
		|| die "could not download Garage ${GARAGE_VER} for ${GARAGE_ARCH}"
	chmod +x /tmp/garage && sudo mv /tmp/garage /usr/local/bin/garage
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

		[admin]
		api_bind_addr = "[::]:3903"
		admin_token = "$ADMIN_TOKEN"
	EOF
else
	say "/etc/garage.toml already exists — left alone"
	ADMIN_TOKEN=$(sudo grep -E '^admin_token' /etc/garage.toml | cut -d'"' -f2)
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

if [ -d "$APP_DIR/.git" ]; then
	say "updating the panel"
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
	say "cloning the panel"
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

# ─── 6. environment ──────────────────────────────────────────────
ENV_FILE="$APP_DIR/.env"
if [ ! -f "$ENV_FILE" ]; then
	say "writing $ENV_FILE"
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
else
	say ".env already exists — left alone"
fi

# ─── 6b. the directories every script assumes ────────────────────
say "creating the directory layout"
mkdir -p "$HOME/apps" "$HOME/apps/static" "$HOME/repos" \
	"$HOME/etc/nginx/sites" "$HOME/.config/bitpanel" "$HOME/.cloudflared"

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
say "installing helper scripts into $BIN_DIR"
mkdir -p "$BIN_DIR"
for f in "$APP_DIR"/server-scripts/*; do
	case "$(basename "$f")" in *.html) continue ;; esac
	install -m 755 "$f" "$BIN_DIR/$(basename "$f")"
done
[ -f "$HOME/bin/ports.conf" ] || printf '# name=port, one per line. A leading underscore reserves a port\n# without listing it as a service.\n' > "$HOME/bin/ports.conf"
case ":$PATH:" in *":$BIN_DIR:"*) ;; *) echo "export PATH=\"\$HOME/bin:\$PATH\"" >> "$HOME/.bashrc" ;; esac

# ─── 8. build and run ────────────────────────────────────────────
say "building the panel (this takes a minute)"
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

# ─── 8b. optional pieces the panel can manage ────────────────────
if [ ! -x "$HOME/apps/pocketbase/pocketbase" ]; then
	say "installing PocketBase"
	PB_VER="${POCKETBASE_VERSION:-0.30.0}"
	mkdir -p "$HOME/apps/pocketbase"
	if curl -fsSL -o /tmp/pb.zip \
		"https://github.com/pocketbase/pocketbase/releases/download/v${PB_VER}/pocketbase_${PB_VER}_${PB_ARCH}.zip"; then
		(cd "$HOME/apps/pocketbase" && unzip -oq /tmp/pb.zip pocketbase && chmod +x pocketbase)
		rm -f /tmp/pb.zip
	else
		warn "could not download PocketBase ${PB_VER} — the PocketBase page will be empty until it is installed"
	fi
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

say "starting services under pm2"
pm2 start garage --name garage -- server >/dev/null 2>&1 || pm2 restart garage >/dev/null
# PORT has to be in the real environment: next start reads it there, not from
# .env, so writing PORT into .env alone silently leaves the panel on 3000
# while every link, nginx vhost and doc points at 3210.
PORT="$PANEL_PORT" pm2 start npm --name bitroot-panel --cwd "$APP_DIR" -- start >/dev/null 2>&1 || \
	PORT="$PANEL_PORT" pm2 restart bitroot-panel --update-env >/dev/null
pm2 start nginx --name nginx -- -c "$HOME/etc/nginx/nginx.conf" -g 'daemon off;' >/dev/null 2>&1 || pm2 restart nginx >/dev/null
# The deploy webhook is what makes `git push` to this machine deploy anything.
[ -x "$BIN_DIR/deploy-webhook" ] && { pm2 start "$BIN_DIR/deploy-webhook" --name deploy-webhook >/dev/null 2>&1 || pm2 restart deploy-webhook >/dev/null; }
[ -x "$HOME/apps/pocketbase/pocketbase" ] && { pm2 start "$HOME/apps/pocketbase/pocketbase" --name pocketbase -- serve --http=127.0.0.1:8090 --dir "$HOME/apps/pocketbase/pb_data" >/dev/null 2>&1 || pm2 restart pocketbase >/dev/null; }
pm2 save >/dev/null
pm2 startup systemd -u "$USER" --hp "$HOME" 2>/dev/null | grep -E '^sudo' | sh || \
	warn "could not register pm2 with systemd automatically — run 'pm2 startup' and follow its instructions"

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
say "BitPanel is running on http://127.0.0.1:$PANEL_PORT"
if [ "${NEW_ENV:-0}" = "1" ]; then
	echo "    dashboard password:  $(grep '^DASHBOARD_PASSWORD=' "$ENV_FILE" | cut -d= -f2)"
fi
cat <<EOF

  Still to do, because these need credentials only you have:

    1. Tailscale, for private access:
         curl -fsSL https://tailscale.com/install.sh | sh && sudo tailscale up
       then set TAILNET_HOST in $ENV_FILE to the name it reports.

    2. Cloudflare, for public routes and the edge cache rule:
         cloudflared tunnel login && cloudflared tunnel create \$(hostname)
       then put CF_API_TOKEN and CF_ZONE_ID in $ENV_FILE. The token needs
       Zone:DNS:Edit, Zone:Cache Rules:Edit, Account:Account Rulesets:Edit
       and Zone:Cache Purge:Purge.

    3. Set DOMAIN_SUFFIX in $ENV_FILE to the zone you route under.

  Then: pm2 restart bitroot-panel

EOF
