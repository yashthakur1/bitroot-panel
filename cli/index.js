#!/usr/bin/env node
// Thin front door for the installer.
//
// The panel is a server, not a library: it wants pm2, nginx, cloudflared and
// Garage alongside it. npm cannot express that, so this fetches install.sh and
// hands over. Publishing the panel itself to npm would only produce a package
// that could not run.

import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { platform } from 'node:os';

const require = createRequire(import.meta.url);
const { version } = require('./package.json');

const REPO = 'https://raw.githubusercontent.com/yashthakur1/bitroot-panel';
const DOCS = 'https://yashthakur1.github.io/bitroot-panel/';

// Pinned to the tag matching this package, so `bitpanel@0.1.0` installs the
// panel that was released as 0.1.0 rather than whatever main happens to be
// that afternoon. main moves; a published version should not.
const script = (name) => ({
  tag: `${REPO}/v${version}/${name}`,
  main: `${REPO}/main/${name}`,
});

// --head, so existence is checked without pulling the whole script down and
// throwing it away - the body then gets fetched a second time to actually run.
function reachable(url) {
  const r = spawnSync('curl', ['-fsSL', '--head', '-o', '/dev/null', '-m', '20', url], {
    stdio: 'ignore',
  });
  return r.status === 0;
}

// Falls back rather than failing: a tag can be missing if a release was cut
// by hand, and refusing to install at all would be a worse outcome than
// installing from main and saying so.
function scriptUrl(name) {
  const u = script(name);
  if (reachable(u.tag)) return { url: u.tag, pinned: true };
  return { url: u.main, pinned: false };
}

const cmd = process.argv[2] ?? 'install';

if (cmd === '--version' || cmd === '-v') {
  console.log(version);
  process.exit(0);
}

if (cmd === '--help' || cmd === '-h' || cmd === 'help') {
  console.log(`bitpanel ${version} — installer for BitPanel

  bitpanel install     download and run the installer (Debian/Ubuntu)
  bitpanel uninstall   remove BitPanel; add --purge to remove your data too
  bitpanel url         print the installer URL without running it
  bitpanel docs        print the documentation link
  bitpanel --version   print this version

The installer is a shell script that installs system packages and starts
services. Read it before running it:

  bitpanel url | xargs curl -fsSL | less

Termux and other platforms: see ${DOCS}`);
  process.exit(0);
}

if (cmd === 'url') {
  const { url, pinned } = scriptUrl('install.sh');
  // The warning goes to stderr so `bitpanel url | xargs curl` stays clean.
  // Printing an unpinned URL silently is the failure worth avoiding: it looks
  // identical to a pinned one, and the difference is which code you install.
  if (!pinned) {
    console.warn(`warning: no v${version} tag found — this is main, not a released version`);
  }
  console.log(url);
  process.exit(0);
}

if (cmd === 'docs') {
  console.log(DOCS);
  process.exit(0);
}

if (cmd !== 'install') {
  console.error(`unknown command: ${cmd}\nTry: bitpanel --help`);
  process.exit(1);
}

// Removal runs the same way as installation: fetch the script for this exact
// version and hand over. The extra arguments (--purge, --yes) are passed
// through unchanged, and the script does the asking — it is the only side that
// knows what is about to be destroyed.
if (cmd === 'uninstall') {
  const { url } = scriptUrl('uninstall.sh');
  const args = process.argv.slice(3).filter((a) => /^--?[a-z]+$/.test(a));
  console.log(`Fetching ${url}\n`);
  const child = spawn('bash', ['-c', `curl -fsSL ${url} | bash -s -- ${args.join(' ')}`], {
    stdio: 'inherit',
  });
  child.on('exit', (code) => process.exit(code ?? 1));
} else {

// Node reports "android" under Termux. That is a machine BitPanel runs on very
// well - it is what it was built for - but this installer is apt/systemd/sudo
// and none of those exist there. Saying "run it on the machine that will host
// the panel" to someone already sitting on that machine is the wrong answer.
if (platform() === 'android') {
  console.error(`This installer is for Debian and Ubuntu, and Android has no apt or systemd.

BitPanel does run here — it was built on a phone — but the steps differ enough
that they are written out separately:

  ${DOCS}termux.html

In short: pkg install the dependencies, clone the repo, npm install, and start
things under pm2 by hand, because Android has no service manager to register
with.`);
  process.exit(1);
}

if (platform() !== 'linux') {
  console.error(`BitPanel installs on Linux; this is ${platform()}.
Run it on the machine that will host the panel — see ${DOCS}`);
  process.exit(1);
}

// curl is what actually fetches the script, and its absence produces a bare
// "command not found" from inside bash that reads like the installer failed.
if (spawnSync('curl', ['--version'], { stdio: 'ignore' }).status !== 0) {
  console.error('curl is required and was not found. Install it first: sudo apt install curl');
  process.exit(1);
}

const { url, pinned } = installerUrl();
if (!pinned) {
  console.warn(`note: no v${version} tag published yet — installing from main instead\n`);
}

// Piped straight to bash rather than written to a temp file: nothing is left on
// disk if it fails, and it is the same script the docs tell you to read first.
console.log(`Fetching ${url}\n`);
// The version travels with the request, so the installer can check out the tag
// that matches this package. Without it the script pins itself and then clones
// whatever main is, which makes the version on the package a decoration.
const child = spawn('bash', ['-c', `curl -fsSL ${url} | BITPANEL_VERSION=${version} bash`], {
  stdio: 'inherit',
});
child.on('exit', (code) => process.exit(code ?? 1));
}
