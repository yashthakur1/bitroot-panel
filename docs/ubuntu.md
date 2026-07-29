# BitPanel on Debian / Ubuntu

**The full guide, formatted:** https://yashthakur1.github.io/bitroot-panel/ubuntu.html

```bash
npx bitpanel install
```

Run it as your normal user, not root: it installs into `$HOME` and calls `sudo`
only where a package needs it. Re-running upgrades rather than duplicating.

It is a shell script that installs system packages, so read it first:

```bash
npx bitpanel url | xargs curl -fsSL | less
```

Without npm — the same script, but always the tip of `main` rather than a
released tag:

```bash
curl -fsSL https://raw.githubusercontent.com/yashthakur1/bitroot-panel/main/install.sh | bash
```

It finishes by printing a URL and a generated password. Open it; the setup
wizard collects the rest, and **Config → Setup** shows what this machine can and
cannot do, with the credentials entered there rather than over SSH.

The URL it prints is `http://127.0.0.1:3210`, which is the right one when the
browser is on the same machine. Installed on a headless box over SSH — the usual
case — open it from your own machine using the server's LAN address or its
hostname instead:

```bash
hostname -I | awk '{print "http://" $1 ":3210"}'   # e.g. http://192.168.1.42:3210
```

`http://<hostname>:3210` works wherever the network resolves the name, and once
Tailscale is up the tailnet address reaches it from anywhere. The panel listens
on all interfaces on 3210 and the password is what stands in front of it, so do
not expose that port to the public internet.

## PocketBase credentials

The installer creates PocketBase's superuser account and never prints it. The
email and password are written to `~/apps/pocketbase/.superuser`, mode 600 —
that is where to look before signing in to PocketBase's own admin UI on 8090:

```bash
cat ~/apps/pocketbase/.superuser
```

## What it leaves to you

No Cloudflare or Tailscale credentials are generated — they are account-level
secrets, and creating them silently would be worse than asking.

**`cloudflared tunnel login` needs a browser and blocks until it gets one.** It
prints a `dash.cloudflare.com` URL, tries to open it, then waits — no timeout,
no prompt. On a headless server nothing opens, so copy that URL into a browser
on your laptop or phone, sign in and pick the zone. Only then does the command
return, writing `~/.cloudflared/cert.pem`; `cloudflared tunnel create` fails
without that file, so it has to run second. If it looks stuck, it is waiting for
you.

The Cloudflare token needs **Zone:DNS:Edit**, **Zone:Cache Rules:Edit**,
**Zone:Cache Purge:Purge** and **Account:Account Rulesets:Edit**. The
account-level one is easy to miss, and cache rules fail with a bare 403 without
it.

## Ports

3210 panel · 3900 Garage S3 · 3902 Garage website · 3903 Garage admin
(127.0.0.1 only) · 8090 PocketBase (127.0.0.1 only) · 9000 deploy webhook.

Only the panel, published buckets and the deploy webhook need to be reachable
from outside.

**Installed before 0.1.8? Check port 3903.** Those installs wrote
`api_bind_addr = "[::]:3903"` into `/etc/garage.toml` — every interface, not
loopback — so the Garage admin API, which creates buckets and mints S3 keys
behind nothing but a bearer token, answered on the LAN while this list said it
did not. `ss -lntp | grep 3903` tells you: `127.0.0.1:3903` is fixed, `*:3903`
is not. **Config → Setup** detects it and offers *Bind admin API to 127.0.0.1*,
which rewrites the one line and restarts Garage; re-running the installer does
the same. 3900 and 3902 stay reachable either way — published buckets need them.
