# BitPanel

A self-hosted deploy panel for a machine you own. It runs Node apps and static
sites, routes them through Cloudflare, serves S3-compatible object storage, and
keeps track of what every removal leaves behind.

It was built for an Android phone running Termux and also runs on
Debian/Ubuntu. There is one codebase — the differences between the two are
handled at runtime, not in separate branches.

## What it manages

| | |
|---|---|
| **Services** | Node apps under pm2, static sites under nginx, and the daemons underneath |
| **Storage** | S3-compatible buckets via [Garage](https://garagehq.deuxfleurs.fr/), with size limits, browser previews and presigned share links |
| **Routes** | Cloudflare Tunnel ingress and DNS, with an edge cache rule for published buckets |
| **PocketBase** | A shared database with per-project isolation and backups |
| **IAM** | Cloudflare Access policies, so the panel itself is not open to the internet |
| **Residue** | What a removal left behind — DNS records, files, keys — and a way to finish the job |

## Install

**Debian / Ubuntu** — see [docs/ubuntu.md](docs/ubuntu.md)

```bash
git clone <repo> && cd bitroot-panel && ./install.sh
```

**Android / Termux** — see [docs/termux.md](docs/termux.md). Termux needs a few
steps the installer cannot take for you, because Android has no service manager
and several upstream projects publish no Android binaries.

Both end the same way: the panel on `:3210`, Garage on `:3900`, and a short list
of credentials only you can supply.

## Requirements

- Node 22 or newer
- pm2, nginx, cloudflared, Garage — the installer handles these on Ubuntu
- A Cloudflare zone, if you want public routes
- Tailscale, if you want private access from elsewhere

None of the storage, routing or IAM features are required; the panel degrades to
whatever is configured.

## Configuration

Everything device-specific is an environment variable in `.env`, each with a
fallback, so nothing is compiled in:

| variable | purpose |
|---|---|
| `DASHBOARD_PASSWORD`, `SESSION_SECRET` | panel login |
| `DOMAIN_SUFFIX` | the zone routes are created under |
| `TAILNET_HOST`, `TAILNET_IP` | how the panel advertises private URLs |
| `CF_API_TOKEN`, `CF_ZONE_ID` | DNS, cache rules, Access |
| `GARAGE_ADMIN_TOKEN`, `GARAGE_S3_URL` | object storage |
| `GARAGE_S3_PUBLIC_URL` | the address presigned links are signed against |

## Notes from the phone build

These cost real time to discover and are worth knowing before porting anywhere
unusual:

- `sh` is **dash** on both Termux and Debian, so `/dev/tcp` — a bash feature —
  fails silently in anything the panel shells out to. Reachability is probed
  with `nc -z`.
- Android denies netlink to apps, so `ss` and `netstat` return nothing. Ports
  are tracked from what the panel manages, and probed directly.
- cloudflared does **not** start serving a newly added hostname on `SIGHUP`; it
  needs a restart, or requests fall through to the catch-all 404.
- Several upstream projects ship no `android-arm64` binary — Bun, turbo, and
  Claude Code past 2.1.112 among them. Where the runtime is plain JavaScript it
  works; where it is a native binary it does not.
