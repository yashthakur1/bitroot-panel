# BitPanel on Android / Termux

**The full guide, formatted:** https://yashthakur1.github.io/bitroot-panel/termux.html

`npx bitpanel install` refuses to run here on purpose — it is apt- and
systemd-shaped, and Android has neither. The equivalent:

```bash
pkg install nodejs git nginx openssh netcat-openbsd garage rclone
npm install -g pm2

git clone --depth 1 --branch v0.1.7 \
  https://github.com/yashthakur1/bitroot-panel.git ~/apps/bitroot-panel
cd ~/apps/bitroot-panel && npm install --include=dev && npm run build

mkdir -p ~/bin
for f in server-scripts/*; do
  head -c 2 "$f" | grep -q '^#!' && install -m 755 "$f" ~/bin/
done

printf 'PORT=3210\nSESSION_SECRET=%s\nDASHBOARD_PASSWORD=%s\n' \
  "$(openssl rand -hex 32)" \
  "$(openssl rand -base64 18 | tr -dc 'A-Za-z0-9' | cut -c1-20)" \
  > .env && chmod 600 .env

PORT=3210 pm2 start npm --name bitroot-panel --cwd ~/apps/bitroot-panel -- start
pm2 start garage --name garage -- server
pm2 save
```

Then open `http://localhost:3210` and the wizard takes over.

Also install **Termux:Boot** (nothing restarts after a reboot without it — there
is no systemd) and **termux-exec** (the helper scripts use `#!/usr/bin/env`
shebangs, and Termux has no `/usr/bin`).

Clone at a tag, not a branch: that is how the panel knows which release it is
running and can update itself later.

`PORT` must be in the environment, not only in `.env` — `next start` reads it
from the process environment, and a dotenv line alone leaves the panel on 3000.

The constraints that will bite you — dash instead of bash, no netlink, no
glibc binaries, no Tailscale CLI — are listed on the page above.
