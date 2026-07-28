# BitPanel on Debian / Ubuntu

## One command

If the repository is **public**:

```bash
curl -fsSL https://raw.githubusercontent.com/<owner>/bitroot-panel/main/install.sh | bash
```

If it is **private**, the same thing with a token. The script is fetched with
it and passes it on to the clone:

```bash
export GH_TOKEN=ghp_xxx    # 'repo' scope (classic), or Contents:Read (fine-grained)
curl -fsSL -H "Authorization: Bearer $GH_TOKEN" \
  https://raw.githubusercontent.com/<owner>/bitroot-panel/main/install.sh | bash
```

The token is used for the clone and then dropped: the git remote is rewritten
to the clean URL, so no credential is left in `.git/config`.

Or, with the repo already cloned:

```bash
cd bitroot-panel && ./install.sh
```

Run it as your normal user, not root — it installs into `$HOME` and calls
`sudo` only where a package needs it. Re-running upgrades rather than
duplicating; nothing already present at a good version is touched.

## What it does

1. `git`, `curl`, `nginx`, `netcat-openbsd`, `jq` from apt
2. Node 22 from NodeSource, and pm2 globally
3. cloudflared from Cloudflare's own `.deb`
4. Garage from the official release for your architecture, plus
   `/etc/garage.toml` with generated secrets
5. Clones and builds the panel, writes `.env` with a generated password
6. Installs the helper scripts into `~/bin`
7. Assigns a single-node Garage layout
8. Starts everything under pm2 and registers pm2 with systemd

## What it deliberately leaves to you

The installer generates no Cloudflare or Tailscale credentials, because they
are account-level secrets and creating them silently would be worse than asking.

```bash
# private access from anywhere
curl -fsSL https://tailscale.com/install.sh | sh && sudo tailscale up

# public routes
cloudflared tunnel login
cloudflared tunnel create $(hostname)
```

Then fill in `.env`:

- `DOMAIN_SUFFIX` — the zone you route under
- `TAILNET_HOST` — the name Tailscale reports
- `CF_API_TOKEN` — needs **Zone:DNS:Edit**, **Zone:Cache Rules:Edit**,
  **Account:Account Rulesets:Edit** and **Zone:Cache Purge:Purge**. The
  Account-level one is easy to miss and cache rules fail with a bare 403
  without it.
- `CF_ZONE_ID` — on the zone's overview page

Then `pm2 restart bitroot-panel`.

## Differences from the Termux build

Everything the phone cannot do works here: systemd runs pm2 at boot, Garage and
PocketBase ship official Linux binaries, and native Node modules build without
the `android_ndk_path` workaround. Nothing in the panel changes.

## Ports

| port | service |
|---|---|
| 3210 | the panel |
| 3900 | Garage S3 API |
| 3902 | Garage website endpoint, for published buckets |
| 3903 | Garage admin API, loopback only |
| 8090 | PocketBase, if installed |

Only the panel and any published buckets need to be reachable from outside;
keep the rest on loopback or the tailnet.
