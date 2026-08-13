// Input validation for everything that ends up in a shell command.
// The panel never executes free-form strings — only `project`/`pm2` verbs
// with arguments that pass these checks.

export function assertName(name: unknown): string {
  if (typeof name !== 'string' || !/^[a-zA-Z0-9_-]{1,40}$/.test(name)) {
    throw new ValidationError('invalid project name (letters, digits, - and _ only)');
  }
  return name;
}

export function assertPort(port: unknown): number {
  const p = Number(port);
  if (!Number.isInteger(p) || p < 1024 || p > 65535) {
    throw new ValidationError('invalid port (1024-65535)');
  }
  return p;
}

export function assertRepo(url: unknown): string {
  if (
    typeof url !== 'string' ||
    url.length > 300 ||
    !/^(https:\/\/|git@|ssh:\/\/)[\w.@:/~+-]+$/.test(url)
  ) {
    throw new ValidationError('invalid repo URL (https://, ssh:// or git@ form)');
  }
  return url;
}

export function assertEnvKey(key: unknown): string {
  if (typeof key !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(key)) {
    throw new ValidationError(`invalid env key: ${String(key)}`);
  }
  return key;
}

// Newlines are allowed. A TLS certificate, an SSH private key and a
// service-account JSON are all ordinary things to keep in a .env, and rejecting
// them meant they could not be stored at all. They are safe now because values
// travel on stdin instead of a command line (runner.runWithInput) and are quoted
// and escaped on write (lib/env).
//
// The ceiling fits a certificate chain while staying small enough that a
// mis-pasted binary cannot fill the device.
export function assertEnvValue(value: unknown): string {
  if (typeof value !== 'string' || value.length > 32_768) {
    throw new ValidationError('invalid env value (max 32768 chars)');
  }
  // A NUL byte cannot survive a process environment, so its presence means the
  // input was binary rather than text.
  if (value.includes('\0')) {
    throw new ValidationError('invalid env value (contains a null byte)');
  }
  return value;
}

/** Shell-escape a string with single quotes. */
export function shq(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

export class ValidationError extends Error {}

/**
 * A hostname for a Pages custom domain. Rejects schemes, ports and paths:
 * Cloudflare accepts only a bare host and its error for anything else names
 * neither the field nor the problem.
 */
export function assertHostname(v: string): string {
  const h = String(v).trim().toLowerCase();
  if (!h) return '';
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(h)) {
    throw new ValidationError(`"${v}" is not a hostname — use something like blog.bitroot.in`);
  }
  return h;
}
