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

No Cloudflare or Tailscale credentials are generated — they are account-level
secrets, and creating them silently would be worse than asking.

The Cloudflare token needs **Zone:DNS:Edit**, **Zone:Cache Rules:Edit**,
**Zone:Cache Purge:Purge** and **Account:Account Rulesets:Edit**. The
account-level one is easy to miss, and cache rules fail with a bare 403 without
it.

Ports: 3210 panel · 3900 Garage S3 · 3902 Garage website · 3903 Garage admin
(loopback) · 8090 PocketBase · 9000 deploy webhook.
