# bitpanel

Installer for **BitPanel** — a self-hosted deploy panel for a machine you own.
It runs Node apps and static sites, routes them through Cloudflare, serves
S3-compatible object storage, and keeps track of what every removal leaves
behind.

```bash
npx bitpanel install
```

Debian or Ubuntu. Installs Node, pm2, nginx, cloudflared and Garage, builds the
panel, registers it with systemd, and hands you a URL and a password. Re-running
upgrades rather than duplicating.

## What this package is

A front door, not the panel. The panel is a server — it wants pm2, nginx,
cloudflared and Garage running alongside it — and npm has no way to express
that. So this fetches `install.sh` and hands over.

The installer URL is pinned to the git tag matching this package version, so
`bitpanel@0.1.0` installs the panel released as 0.1.0 rather than whatever the
main branch happens to be today.

## Read it before you run it

It is a shell script that installs system packages and starts services. That
deserves a look first:

```bash
npx bitpanel url | xargs curl -fsSL | less
```

## Commands

| | |
|---|---|
| `bitpanel install` | download and run the installer |
| `bitpanel url` | print the installer URL without running it |
| `bitpanel docs` | print the documentation link |
| `bitpanel --version` | print the version |

## After it finishes

The panel comes up on `:3210` and walks you through the rest in a browser —
domain, dashboard password, and Cloudflare credentials if you want public
routes. Nothing is invented for you and nothing phones home; every credential is
one you supply.

Storage, routing and IAM are each optional. The panel degrades to whatever is
configured.

## What it manages

| | |
|---|---|
| **Services** | Node apps under pm2, static sites under nginx, and the daemons underneath |
| **Storage** | S3-compatible buckets via [Garage](https://garagehq.deuxfleurs.fr/), with size limits, browser previews and presigned share links |
| **Routes** | Cloudflare Tunnel ingress and DNS, with an edge cache rule for published buckets |
| **PocketBase** | A shared database with per-project isolation and backups |
| **Residue** | What a removal left behind — DNS records, files, keys — and a way to finish the job |

## Other platforms

Android/Termux needs a few steps a Debian installer cannot take, because Android
has no service manager and several upstream projects publish no `android-arm64`
binaries. See the [documentation][docs].

## Links

- [Documentation][docs]
- [Source](https://github.com/yashthakur1/bitroot-panel)

MIT

[docs]: https://yashthakur1.github.io/bitroot-panel/
