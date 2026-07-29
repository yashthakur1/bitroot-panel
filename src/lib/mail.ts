// Transactional email through Brevo.
//
// Optional by design: a panel with no key still installs, signs up and logs in
// exactly as before — it simply does not send. Email is a convenience for
// getting credentials off a terminal and into an inbox, never a dependency.

const API = 'https://api.brevo.com/v3/smtp/email';

const FROM_EMAIL = process.env.MAIL_FROM ?? 'panel.setup@bitroot.club';
const FROM_NAME = process.env.MAIL_FROM_NAME ?? 'BitPanel';

export function mailConfigured(): boolean {
  return Boolean(process.env.BREVO_API_KEY);
}

export interface SendResult {
  ok: boolean;
  /** Safe to show a user: never contains the key or Brevo's raw payload. */
  message: string;
}

async function send(to: string, subject: string, html: string, text: string): Promise<SendResult> {
  const key = process.env.BREVO_API_KEY;
  if (!key) return { ok: false, message: 'email is not configured on this server' };

  try {
    const res = await fetch(API, {
      method: 'POST',
      headers: {
        'api-key': key,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({
        sender: { email: FROM_EMAIL, name: FROM_NAME },
        to: [{ email: to }],
        subject,
        htmlContent: html,
        textContent: text,
      }),
      signal: AbortSignal.timeout(15_000),
    });

    if (res.ok) return { ok: true, message: `sent to ${to}` };

    // Brevo's own message is specific and worth surfacing - an unverified
    // sender or an exhausted credit balance both say so plainly - but the
    // response is not echoed wholesale in case it ever quotes the request.
    const data = (await res.json().catch(() => null)) as { message?: string } | null;
    return { ok: false, message: data?.message ? `Brevo: ${data.message}` : `Brevo: HTTP ${res.status}` };
  } catch (e) {
    const err = e as Error;
    return {
      ok: false,
      message: err.name === 'TimeoutError' ? 'Brevo did not respond in time' : `could not reach Brevo: ${err.message}`,
    };
  }
}

function escape(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string,
  );
}

/**
 * The credentials mail. Deliberately plain: no tracking, no images, nothing
 * that would make a password mail look like marketing.
 */
export async function sendPanelCredentials(opts: {
  to: string;
  url: string;
  password: string;
  server: string;
}): Promise<SendResult> {
  const { to, url, password, server } = opts;
  const subject = `Your BitPanel is ready — ${server}`;

  const text = [
    `Your BitPanel on ${server} is set up.`,
    '',
    `Address:  ${url}`,
    `Email:    ${to}`,
    `Password: ${password}`,
    '',
    'Sign in with that email and password.',
    '',
    'If the address only works on the machine itself, reach it over Tailscale or',
    'publish a route from Config → Setup.',
    '',
    'This message was sent by the panel you just installed. Nobody else was told.',
  ].join('\n');

  const html = `<!doctype html>
<div style="font:15px/1.6 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#111827;max-width:32rem">
  <p style="margin:0 0 1rem">Your BitPanel on <strong>${escape(server)}</strong> is set up.</p>
  <table style="border-collapse:collapse;font-size:14px;margin:0 0 1.25rem">
    <tr><td style="padding:4px 14px 4px 0;color:#6b7280">Address</td>
        <td style="padding:4px 0"><a href="${escape(url)}" style="color:#0e70ff">${escape(url)}</a></td></tr>
    <tr><td style="padding:4px 14px 4px 0;color:#6b7280">Email</td>
        <td style="padding:4px 0">${escape(to)}</td></tr>
    <tr><td style="padding:4px 14px 4px 0;color:#6b7280">Password</td>
        <td style="padding:4px 0"><code style="background:#f3f4f6;padding:2px 6px;border-radius:4px">${escape(password)}</code></td></tr>
  </table>
  <p style="margin:0 0 1rem;color:#4b5563">Sign in with that email and password.</p>
  <p style="margin:0 0 1rem;color:#6b7280;font-size:13px">
    If the address only works on the machine itself, reach it over Tailscale or publish a route
    from Config → Setup.
  </p>
  <p style="margin:0;color:#9ca3af;font-size:12px">
    Sent by the panel you just installed. Nobody else was told.
  </p>
</div>`;

  return send(to, subject, html, text);
}
