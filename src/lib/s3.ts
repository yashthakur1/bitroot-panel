// Minimal SigV4 PutObject against Garage.
//
// The admin API manages buckets and keys but not their contents, so uploads
// need real S3 auth. One signed PUT is little enough work to do directly, and
// doing it here rather than shelling out to a client keeps the object's
// headers - content type, encoding, cache lifetime - under the panel's control.

import { createHash, createHmac } from 'crypto';

const S3_URL = process.env.GARAGE_S3_URL ?? 'http://127.0.0.1:3900';
const REGION = process.env.GARAGE_REGION ?? 'garage';
const SERVICE = 's3';

function sha256Hex(data: Buffer | string): string {
  return createHash('sha256').update(data).digest('hex');
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data).digest();
}

// Everything except unreserved characters is percent-encoded, and the slashes
// separating path segments are then put back - S3 signs the path segment by
// segment, not as one opaque string.
function encodeKey(key: string): string {
  return key
    .split('/')
    .map((seg) => encodeURIComponent(seg).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`))
    .join('/');
}

export interface PutOptions {
  contentType?: string;
  contentEncoding?: string;
  cacheControl?: string;
}

export async function putObject(
  accessKeyId: string,
  secretAccessKey: string,
  bucket: string,
  key: string,
  body: Buffer,
  opts: PutOptions = {},
): Promise<void> {
  const url = new URL(`${S3_URL}/${bucket}/${encodeKey(key)}`);
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = sha256Hex(body);

  const headers: Record<string, string> = {
    host: url.host,
    'content-length': String(body.length),
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
  };
  if (opts.contentType) headers['content-type'] = opts.contentType;
  if (opts.contentEncoding) headers['content-encoding'] = opts.contentEncoding;
  if (opts.cacheControl) headers['cache-control'] = opts.cacheControl;

  const signedHeaders = Object.keys(headers).sort();
  const canonicalHeaders = signedHeaders.map((h) => `${h}:${headers[h].trim()}\n`).join('');
  const signedHeaderList = signedHeaders.join(';');

  const canonicalRequest = [
    'PUT',
    url.pathname,
    '',
    canonicalHeaders,
    signedHeaderList,
    payloadHash,
  ].join('\n');

  const scope = `${dateStamp}/${REGION}/${SERVICE}/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    scope,
    sha256Hex(canonicalRequest),
  ].join('\n');

  const signingKey = hmac(
    hmac(hmac(hmac(`AWS4${secretAccessKey}`, dateStamp), REGION), SERVICE),
    'aws4_request',
  );
  const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex');

  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      ...headers,
      Authorization: `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${signedHeaderList}, Signature=${signature}`,
    },
    body: new Uint8Array(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`S3 PUT failed: HTTP ${res.status} ${text.slice(0, 300)}`);
  }
}
