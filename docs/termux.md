# BitPanel on Android / Termux

Termux works, and it is what the panel was built on — but `install.sh` targets
Debian and will refuse to run here. Android has no service manager, `apt` is
Termux's own, and several dependencies have no Android build at all.

## Prerequisites

```bash
pkg install nodejs git nginx openssh netcat-openbsd garage rclone
npm install -g pm2
```

Termux packages are compiled for bionic, which is why Garage installs from
`pkg` here rather than from the upstream release — the official binary is
glibc-linked and will not start.

Also install **Termux:Boot** so pm2 comes back after a reboot, and
**termux-exec**, which the helper scripts rely on to resolve `#!/usr/bin/env`
shebangs (Termux has no `/usr/bin`).

## Setup

```bash
git clone <repo> ~/apps/bitroot-panel
cd ~/apps/bitroot-panel
npm install && npm run build
install -m 755 server-scripts/* ~/bin/     # skip the .html
```

Write `~/apps/bitroot-panel/.env` by hand — see the table in the main README —
then:

```bash
pm2 start npm --name bitroot-panel --cwd ~/apps/bitroot-panel -- start
pm2 start garage --name garage -- server
pm2 save
```

`pm2 save` matters more here than on Linux: with no systemd, Termux:Boot
replays the saved dump and nothing else will.

## Android-specific things that will bite you

- **`/dev/tcp` does not work** under `sh`, which is dash. Anything probing a
  port must use `nc -z`.
- **`ss` and `netstat` return nothing** — Android denies netlink to apps. You
  cannot enumerate listening sockets; connect to them instead.
- **Native Node modules** need `GYP_DEFINES="android_ndk_path="` or node-gyp
  will not configure. `bit-cli-update` sets this only on Android.
- **No Docker.** The `docker` package exists but ships no daemon.
- **Ports below 1024 are unavailable** to a non-root process.
- **Some binaries simply will not run.** Anything linked against glibc fails
  with `cannot execute: required file not found`, which means the ELF
  interpreter is missing, not the file. Bun, turbo and Claude Code past 2.1.112
  are all in this category.

## Keeping it alive

Android is aggressive about background processes. Acquire a wakelock
(`termux-wake-lock`) and exclude Termux from battery optimisation, or the
device will drop off the network while it sleeps — the services stay running,
but nothing can reach them.
