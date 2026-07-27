// Curated catalog of software that can be installed on the device.
//
// The browser only ever sends a catalog id, which is resolved to a package
// name here. Nothing outside this list can be installed through the panel, so
// a crafted request cannot turn into an arbitrary package - or an arbitrary
// command - running as the Termux user.

export type Manager = 'pkg' | 'npm';
export type Category = 'runtime' | 'tool' | 'library';

export interface CatalogEntry {
  id: string;
  name: string;
  description: string;
  category: Category;
  manager: Manager;
  pkg: string;
  // Set when changing this from the panel would break the panel doing the
  // changing. The version is still reported; the install action is refused.
  locked?: string;
}

export const CATALOG: CatalogEntry[] = [
  // ─── Runtimes ───────────────────────────────────────────────
  {
    id: 'nodejs',
    name: 'Node.js',
    description: 'Runs every service on this device, and the panel itself.',
    category: 'runtime',
    manager: 'pkg',
    pkg: 'nodejs',
    locked:
      'The panel, pm2 and the deploy webhook all run on this Node. Replacing it from inside the panel would kill the install half-way through. Upgrade it from a Termux shell.',
  },
  {
    id: 'python',
    name: 'Python',
    description: 'Needed by node-gyp to build native modules such as better-sqlite3.',
    category: 'runtime',
    manager: 'pkg',
    pkg: 'python',
  },
  {
    id: 'golang',
    name: 'Go',
    description: 'Used to build PocketBase from source for this architecture.',
    category: 'runtime',
    manager: 'pkg',
    pkg: 'golang',
  },
  {
    id: 'rust',
    name: 'Rust',
    description: 'Toolchain for building Rust projects and native crates.',
    category: 'runtime',
    manager: 'pkg',
    pkg: 'rust',
  },

  // ─── Tools ──────────────────────────────────────────────────
  {
    id: 'git',
    name: 'Git',
    description: 'Clones and updates every deployed project.',
    category: 'tool',
    manager: 'pkg',
    pkg: 'git',
  },
  {
    id: 'openssh',
    name: 'OpenSSH',
    description: 'Serves the ssh route and the deploy remote.',
    category: 'tool',
    manager: 'pkg',
    pkg: 'openssh',
    locked:
      'sshd serves the ssh-oneplus route and every remote session - including whichever one is driving the install. Upgrade it from a local Termux shell.',
  },
  {
    id: 'pm2',
    name: 'pm2',
    description: 'Supervises the services and restores them after a reboot.',
    category: 'tool',
    manager: 'npm',
    pkg: 'pm2',
    locked:
      'pm2 supervises the panel. Replacing it while it is running would orphan every managed service. Upgrade it from a Termux shell, then run "pm2 update".',
  },
  {
    id: 'ripgrep',
    name: 'ripgrep',
    description: 'Fast recursive search across project sources.',
    category: 'tool',
    manager: 'pkg',
    pkg: 'ripgrep',
  },
  {
    id: 'jq',
    name: 'jq',
    description: 'Command-line JSON processor, handy in deploy scripts.',
    category: 'tool',
    manager: 'pkg',
    pkg: 'jq',
  },
  {
    id: 'htop',
    name: 'htop',
    description: 'Interactive process and memory viewer.',
    category: 'tool',
    manager: 'pkg',
    pkg: 'htop',
  },
  {
    id: 'tree',
    name: 'tree',
    description: 'Prints directory structures as a tree.',
    category: 'tool',
    manager: 'pkg',
    pkg: 'tree',
  },
  {
    id: 'ffmpeg',
    name: 'FFmpeg',
    description: 'Audio and video transcoding. Large download.',
    category: 'tool',
    manager: 'pkg',
    pkg: 'ffmpeg',
  },
  {
    id: 'imagemagick',
    name: 'ImageMagick',
    description: 'Image conversion and resizing from the shell.',
    category: 'tool',
    manager: 'pkg',
    pkg: 'imagemagick',
  },
  {
    id: 'wget',
    name: 'wget',
    description: 'Non-interactive downloader for scripts.',
    category: 'tool',
    manager: 'pkg',
    pkg: 'wget',
  },

  // ─── Libraries and build dependencies ───────────────────────
  {
    id: 'clang',
    name: 'Clang',
    description: 'C/C++ compiler. Required to build native Node modules here.',
    category: 'library',
    manager: 'pkg',
    pkg: 'clang',
  },
  {
    id: 'make',
    name: 'make',
    description: 'Drives node-gyp and most native build systems.',
    category: 'library',
    manager: 'pkg',
    pkg: 'make',
  },
  {
    id: 'cmake',
    name: 'CMake',
    description: 'Build generator used by many C++ dependencies.',
    category: 'library',
    manager: 'pkg',
    pkg: 'cmake',
  },
  {
    id: 'pkg-config',
    name: 'pkg-config',
    description: 'Resolves compiler and linker flags for native libraries.',
    category: 'library',
    manager: 'pkg',
    pkg: 'pkg-config',
  },
  {
    id: 'binutils',
    name: 'binutils',
    description: 'Assembler and linker behind every native build.',
    category: 'library',
    manager: 'pkg',
    pkg: 'binutils',
  },
  {
    id: 'sqlite',
    name: 'SQLite',
    description: 'Embedded database engine and its command-line shell.',
    category: 'library',
    manager: 'pkg',
    pkg: 'sqlite',
  },
  {
    id: 'openssl',
    name: 'OpenSSL',
    description: 'TLS library behind HTTPS for everything on the device.',
    category: 'library',
    manager: 'pkg',
    pkg: 'openssl',
  },
  {
    id: 'zlib',
    name: 'zlib',
    description: 'Compression library required by most native builds.',
    category: 'library',
    manager: 'pkg',
    pkg: 'zlib',
  },
  {
    id: 'libffi',
    name: 'libffi',
    description: 'Foreign function interface used by Python extensions.',
    category: 'library',
    manager: 'pkg',
    pkg: 'libffi',
  },
];

export function findEntry(id: string): CatalogEntry | undefined {
  return CATALOG.find((e) => e.id === id);
}

// Package names reach a shell, so even though they come from the list above
// rather than from a request, they are checked against the character set
// Debian and npm actually allow. A typo in the catalog fails here, loudly,
// instead of turning into shell syntax.
const SAFE_PKG = /^[a-z0-9][a-z0-9+._@/-]*$/i;

export function assertSafePkg(pkg: string): string {
  if (!SAFE_PKG.test(pkg)) throw new Error(`unsafe package name: ${pkg}`);
  return pkg;
}

// Globally installed CLI apps are discovered from npm rather than declared, so
// this only annotates the ones deliberately held back from their latest
// release. Without it the panel would show an update as simply available and
// invite someone to apply one that cannot run on this device.
export interface CliPin {
  version: string;
  reason: string;
}

export const CLI_PINS: Record<string, CliPin> = {
  '@anthropic-ai/claude-code': {
    version: '2.1.112',
    reason:
      'Claude Code 2.1.113 replaced its JavaScript entry point with a platform-native binary, and no android-arm64 build is published. The linux-arm64 build needs /lib/ld-linux-aarch64.so.1, which Android has no equivalent of, so it cannot start here. 2.1.112 is the last release that runs on this device; DISABLE_AUTOUPDATER=1 in ~/.bashrc keeps the updater from undoing the pin.',
  },
};
