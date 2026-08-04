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

export function assertEnvValue(value: unknown): string {
  if (typeof value !== 'string' || value.includes('\n') || value.length > 4096) {
    throw new ValidationError('invalid env value (no newlines, max 4096 chars)');
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
