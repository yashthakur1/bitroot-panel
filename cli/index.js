#!/usr/bin/env node
// Thin front door for the installer.
//
// The panel is a server, not a library: it wants pm2, nginx, cloudflared and
// Garage alongside it. npm cannot express that, so this fetches install.sh and
// hands over. Publishing the panel itself to npm would only produce a package
// that could not run.

import { spawn } from 'node:child_process';
import { platform } from 'node:os';

const RAW = 'https://raw.githubusercontent.com/yashthakur1/bitroot-panel/main/install.sh';
const DOCS = 'https://yashthakur1.github.io/bitroot-panel/';

const cmd = process.argv[2] ?? 'install';

if (cmd === '--help' || cmd === '-h' || cmd === 'help') {
  console.log(`bitpanel — installer for BitPanel

  bitpanel install     download and run the installer (Debian/Ubuntu)
  bitpanel url         print the installer URL without running it
  bitpanel docs        print the documentation link

Termux and other platforms: see ${DOCS}`);
  process.exit(0);
}

if (cmd === 'url') { console.log(RAW); process.exit(0); }
if (cmd === 'docs') { console.log(DOCS); process.exit(0); }

if (cmd !== 'install') {
  console.error(`unknown command: ${cmd}\nTry: bitpanel --help`);
  process.exit(1);
}

if (platform() !== 'linux') {
  console.error(`BitPanel installs on Linux; this is ${platform()}.
Run it on the machine that will host the panel — see ${DOCS}`);
  process.exit(1);
}

// Piped straight to bash rather than written to a temp file: nothing is left on
// disk if it fails, and the script is the same one the docs tell you to read
// first, at ${RAW}.
console.log(`Fetching ${RAW}\n`);
const child = spawn('bash', ['-c', `curl -fsSL ${RAW} | bash`], { stdio: 'inherit' });
child.on('exit', (code) => process.exit(code ?? 1));
