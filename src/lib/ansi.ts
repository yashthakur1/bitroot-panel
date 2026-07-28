// pm2 colourises its output, and Termux emits the escape sequences even when
// nothing is attached to a terminal. Rendered as text they show up as literal
// "[32m" noise, so strip them before anything reaches the browser.
//
// Two forms are handled: a complete escape sequence, and the "[32m" remnant
// left when the ESC byte is lost in transit. The remnant pattern requires at
// least one digit so ordinary bracketed text — "[TAILING]" — survives intact.
const ANSI = /\x1b\[[0-9;]*[A-Za-z]|\[[0-9;]+m/g;

export function stripAnsi(input: string): string {
  return input.replace(ANSI, '');
}
