// Reading and editing .env files.
//
// Both the project env route and the config page used to carry their own copy of
//
//     /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/
//
// which cannot see a quoted value (`KEY="a b"` parsed to `"a b"`, quotes and all)
// and cannot represent a multi-line one at all — so a TLS key, an SSH key or a
// service-account JSON could not be stored. This module is the single place that
// knows the format.
//
// Values are parsed by `dotenv`, which already handles quoting, escapes and
// multi-line strings correctly. What dotenv cannot do is tell you WHERE a key
// lives in the file, so edits here are applied as line-span replacements against
// the original text. Everything the panel did not touch — comments, blank lines,
// ordering, hand-written formatting — survives a write untouched.

import { parse as parseDotenv } from 'dotenv';

export interface EnvVar {
  key: string;
  value: string;
  /** true when the value spans more than one line, so the UI can pick a textarea. */
  multiline: boolean;
}

/** Key -> inclusive line span it occupies, so an edit can replace exactly that. */
type Spans = Map<string, { start: number; end: number }>;

const KEY_LINE = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/;

/**
 * Locate each key's line span, tracking quote state so a multi-line value is
 * treated as one unit. Without this, rewriting a key whose value spans five
 * lines would replace the first line and leave the other four as garbage.
 */
function scanSpans(lines: string[]): Spans {
  const map: Spans = new Map();

  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(KEY_LINE);
    if (!m) continue;

    const key = m[1];
    const rest = m[2].trimStart();
    let end = i;

    // An opening quote with no closing quote on the same line continues until a
    // line ends with the matching quote.
    const quote = rest[0] === '"' || rest[0] === "'" ? rest[0] : '';
    if (quote) {
      const body = rest.slice(1);
      const closedOnThisLine = body.includes(quote) && !body.endsWith('\\' + quote);
      if (!closedOnThisLine) {
        for (let j = i + 1; j < lines.length; j++) {
          if (lines[j].includes(quote)) {
            end = j;
            break;
          }
          end = j;
        }
      }
    }

    // Last definition wins, matching how a shell sourcing the file would behave.
    map.set(key, { start: i, end });
    i = end;
  }
  return map;
}

/**
 * Write a value in the form dotenv will read back unchanged.
 *
 * dotenv's escaping is narrower than it looks, so this is written against its
 * measured behaviour rather than the usual assumptions:
 *
 *   single quotes  fully literal — `"`, `\`, `$`, `#` and real newlines all
 *                  survive. `\'` is NOT unescaped, so a value containing a
 *                  single quote cannot use this form.
 *   double quotes  literal except that `\n` and `\r` become newlines. `\"` and
 *                  `\\` are NOT unescaped — writing them leaves the backslash in
 *                  the value, which is what an earlier version of this function
 *                  did and why round-tripping `"` and `\` failed.
 *
 * So: prefer single quotes, fall back to double quotes only for values that
 * contain a single quote, and refuse the one combination neither form can carry.
 */
function serializeValue(value: string): string {
  const simple = value !== '' && /^[A-Za-z0-9_.:/@+-]+$/.test(value);
  if (simple) return value;

  if (!value.includes("'")) {
    // Single quotes: literal, including newlines. The common case, and the one
    // that carries JSON payloads and PEM blocks intact.
    return `'${value}'`;
  }

  // Contains a single quote, so double quotes are the only option — and they
  // only work if the value has no `"` to terminate them early and no backslash
  // that `\n`/`\r` expansion would rewrite.
  if (!value.includes('"') && !value.includes('\\')) {
    return `"${value}"`;
  }

  throw new EnvFormatError(
    'value contains both a single quote and a double quote or backslash, which ' +
      'the .env format cannot represent without corrupting it',
  );
}

export class EnvFormatError extends Error {}

/** Parse a .env file into the variables it defines. */
export function parseEnv(text: string): EnvVar[] {
  const parsed = parseDotenv(text);
  return Object.entries(parsed).map(([key, value]) => ({
    key,
    value,
    multiline: value.includes('\n'),
  }));
}

/**
 * Apply upserts to .env text and return the new text.
 *
 * A key that already exists is replaced in place, keeping its position; a new one
 * is appended. Passing `null` as a value deletes the key.
 */
export function applyEnvEdits(
  original: string,
  changes: Array<{ key: string; value: string | null }>,
): string {
  const lines = original.length ? original.replace(/\r\n/g, '\n').split('\n') : [];
  const spans = scanSpans(lines);

  // Mark replacements rather than splicing as we go: splicing would invalidate
  // every span after the first edit.
  const replacements = new Map<number, { end: number; text: string | null }>();
  const appended: string[] = [];

  for (const { key, value } of changes) {
    const span = spans.get(key);
    const line = value === null ? null : `${key}=${serializeValue(value)}`;
    if (span) {
      replacements.set(span.start, { end: span.end, text: line });
    } else if (line !== null) {
      appended.push(line);
    }
  }

  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const r = replacements.get(i);
    if (r) {
      if (r.text !== null) out.push(r.text);
      i = r.end; // skip the rest of the old span, including multi-line bodies
      continue;
    }
    out.push(lines[i]);
  }

  if (appended.length) {
    // Keep exactly one blank line between existing content and additions.
    while (out.length && out[out.length - 1].trim() === '') out.pop();
    if (out.length) out.push('');
    out.push(...appended);
  }

  const text = out.join('\n');
  return text.endsWith('\n') || text === '' ? text : text + '\n';
}

/** Heuristic for masking in the UI. Deliberately broad — over-masking is cheap. */
export function looksSecret(key: string): boolean {
  return /(password|passwd|secret|token|key|credential|auth|private|dsn|url)/i.test(key);
}
