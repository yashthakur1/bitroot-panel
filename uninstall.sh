#!/usr/bin/env bash
#
# Remove BitPanel from this machine.
#
# The default keeps your data. It stops the panel and removes the parts that are
# BitPanel, but it leaves your deployed projects, your git repositories, your
# object storage and your PocketBase database where they are. Use --purge to
# remove those too.
#
#   bitpanel uninstall            remove BitPanel, keep the data
#   bitpanel uninstall --purge    remove the data as well
#   bitpanel uninstall --yes      do not ask for confirmation
#
# Kept in every case: Tailscale, sshd, Docker, and the firewall. Those are how
# you reach this machine. They were not installed by BitPanel.
set -uo pipefail

PURGE=0
ASSUME_YES=0
for a in "$@"; do
	case "$a" in
		--purge) PURGE=1 ;;
		--yes|-y) ASSUME_YES=1 ;;
		--help|-h) sed -n '3,16p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
		*) echo "unknown option: $a" >&2; exit 1 ;;
	esac
done

if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
	C_B=$'\033[1m'; C_R=$'\033[31m'; C_Y=$'\033[33m'; C_D=$'\033[2m'; C_0=$'\033[0m'
else
	C_B=''; C_R=''; C_Y=''; C_D=''; C_0=''
fi
say() { printf '  %s\n' "$*"; }
gone() { printf '  %s- %s%s\n' "$C_D" "$*" "$C_0"; }

APP_DIR="${BITPANEL_APP:-$HOME/apps/bitroot-panel}"

# ─── what is about to happen ────────────────────────────────────────────────
printf '\n  %sRemoving BitPanel%s\n\n' "$C_B" "$C_0"

printf '  %sThis removes:%s\n' "$C_B" "$C_0"
say "the panel, its helper scripts and its pm2 processes"
say "the pm2 startup service"
say "cloudflared, garage and pm2 themselves"

if [ "$PURGE" = 1 ]; then
	printf '\n  %sAnd because you passed --purge, also:%s\n' "$C_R" "$C_0"
	# Name the directories AND what is in them. "~/apps" means nothing to
	# somebody who has forgotten that their projects live there.
	n_apps=$(find "$HOME/apps" -maxdepth 1 -mindepth 1 -type d 2>/dev/null | grep -cv 'bitroot-panel$' || echo 0)
	n_repos=$(find "$HOME/repos" -maxdepth 1 -mindepth 1 -name '*.git' 2>/dev/null | wc -l | tr -d ' ')
	sz_store=$(du -sh "$HOME/storage" 2>/dev/null | cut -f1)
	printf '  %s' "$C_R"
	say "$n_apps deployed project(s) in ~/apps"
	say "$n_repos deploy repositor(y/ies) in ~/repos"
	say "the object storage in ~/storage${sz_store:+ ($sz_store)}"
	say "the PocketBase database and every record in it"
	say "node, npm and nginx"
	printf '%s' "$C_0"
else
	printf '\n  %sThis KEEPS:%s\n' "$C_B" "$C_0"
	say "your deployed projects in ~/apps"
	say "your deploy repositories in ~/repos"
	say "your object storage in ~/storage"
	say "your PocketBase database"
	say "node, npm and nginx"
	printf '  %s(use --purge to remove those as well)%s\n' "$C_D" "$C_0"
fi

printf '\n  %sAlways kept: Tailscale, sshd, Docker, the firewall.%s\n\n' "$C_D" "$C_0"

# ─── confirm ────────────────────────────────────────────────────────────────
# Read from the terminal, not stdin. This script usually arrives through a pipe
# (`curl … | bash`), so stdin is the script itself and `read` would consume it.
if [ "$ASSUME_YES" != 1 ]; then
	# Test by opening it, not by testing the file. A /dev/tty can exist and be
	# readable by the permission bits and still fail to open — inside a container
	# with no controlling terminal, for one — and the failure then prints a raw
	# bash error over the prompt.
	# Braces so the stderr redirect covers the redirection itself. Written as
	# `exec 3< /dev/tty 2>/dev/null` bash reports the failure before the
	# redirect takes effect, and prints its own error over this message.
	if { exec 3< /dev/tty; } 2>/dev/null; then
		printf '  Type %syes%s to continue: ' "$C_B" "$C_0"
		read -r reply <&3 || reply=''
		exec 3<&-
		[ "$reply" = "yes" ] || { printf '\n  nothing was changed\n\n'; exit 1; }
	else
		printf '  %sThere is no terminal here to ask on.%s\n' "$C_Y" "$C_0"
		printf '  Re-run with --yes if you are certain.\n\n'
		exit 1
	fi
fi
echo

# ─── 1. processes ───────────────────────────────────────────────────────────
if command -v pm2 >/dev/null 2>&1; then
	pm2 delete all      >/dev/null 2>&1
	pm2 save --force    >/dev/null 2>&1
	# Unregister before pm2 is removed, or the systemd unit outlives it and
	# fails on every boot with a binary that is no longer there.
	pm2 unstartup systemd >/dev/null 2>&1
	pm2 kill            >/dev/null 2>&1
	gone "pm2 processes and the startup service"
fi

# ─── 2. BitPanel's own files ────────────────────────────────────────────────
rm -rf "$APP_DIR" 2>/dev/null              && gone "the panel ($APP_DIR)"
rm -rf "$HOME/bin" "$HOME/etc" 2>/dev/null && gone "helper scripts and the nginx config"
rm -rf "$HOME/.config/bitpanel" "$HOME/.cloudflared" "$HOME/.pm2" 2>/dev/null && gone "panel, tunnel and pm2 state"
rm -f  "$HOME/ecosystem.config.js" 2>/dev/null
sudo rm -f /etc/garage.toml 2>/dev/null    && gone "/etc/garage.toml"
sed -i '/export PATH="\$HOME\/bin:\$PATH"/d' "$HOME/.bashrc" 2>/dev/null

# ─── 3. the binaries BitPanel installed ─────────────────────────────────────
sudo rm -f /usr/local/bin/garage 2>/dev/null && gone "garage"
dpkg -l cloudflared >/dev/null 2>&1 && sudo dpkg --purge cloudflared >/dev/null 2>&1 && gone "cloudflared"
if command -v npm >/dev/null 2>&1; then
	sudo npm uninstall -g pm2 >/dev/null 2>&1
fi
# Purging node leaves the shim behind, and a pm2 on PATH that cannot run is
# worse than no pm2 at all.
sudo rm -f /usr/bin/pm2 /usr/local/bin/pm2 2>/dev/null
gone "pm2"

# ─── 4. data and packages, only with --purge ────────────────────────────────
if [ "$PURGE" = 1 ]; then
	rm -rf "$HOME/apps" "$HOME/repos" "$HOME/storage" 2>/dev/null
	gone "projects, repositories and object storage"
	sudo systemctl disable --now nginx >/dev/null 2>&1
	sudo apt-get purge -y -qq nodejs nginx nginx-common netcat-openbsd >/dev/null 2>&1
	sudo rm -f /etc/apt/sources.list.d/nodesource.list
	sudo rm -rf /usr/lib/node_modules /usr/local/lib/node_modules 2>/dev/null
	sudo apt-get autoremove -y -qq >/dev/null 2>&1
	gone "node, npm and nginx"
fi

# ─── report ─────────────────────────────────────────────────────────────────
echo
printf '  %sBitPanel is removed.%s\n\n' "$C_B" "$C_0"

left=''
for c in node npm pm2 nginx cloudflared garage; do
	command -v "$c" >/dev/null 2>&1 && left="$left $c"
done
[ -n "$left" ] && printf '  still on this machine:%s\n' "$left"

if [ "$PURGE" != 1 ]; then
	for d in "$HOME/apps" "$HOME/repos" "$HOME/storage"; do
		[ -d "$d" ] && printf '  your data is still at %s\n' "$d"
	done
fi
echo
