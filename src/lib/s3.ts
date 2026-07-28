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

// Signs any request the same way; PutObject was the first caller, listing and
// fetching objects are the others.
async function signedFetch(
  accessKeyId: string,
  secretAccessKey: string,
  method: string,
  pathname: string,
  query: Record<string, string> = {},
  body?: Buffer,
  extraHeaders: Record<string, string> = {},
): Promise<Response> {
  const url = new URL(`${S3_URL}${pathname}`);
  // Query parameters are signed in sorted order, each key and value encoded.
  const canonicalQuery = Object.keys(query)
    .sort()
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(query[k])}`)
    .join('&');
  if (canonicalQuery) url.search = canonicalQuery;

  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = sha256Hex(body ?? '');

  const headers: Record<string, string> = {
    host: url.host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
    ...extraHeaders,
  };
  if (body) headers['content-length'] = String(body.length);

  const signedHeaders = Object.keys(headers).sort();
  const canonicalHeaders = signedHeaders.map((h) => `${h}:${headers[h].trim()}\n`).join('');
  const signedHeaderList = signedHeaders.join(';');

  const canonicalRequest = [
    method,
    url.pathname,
    canonicalQuery,
    canonicalHeaders,
    signedHeaderList,
    payloadHash,
  ].join('\n');

  const scope = `${dateStamp}/${REGION}/${SERVICE}/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256Hex(canonicalRequest)].join('\n');
  const signingKey = hmac(
    hmac(hmac(hmac(`AWS4${secretAccessKey}`, dateStamp), REGION), SERVICE),
    'aws4_request',
  );
  const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex');

  return fetch(url, {
    method,
    headers: {
      ...headers,
      Authorization: `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${signedHeaderList}, Signature=${signature}`,
    },
    body: body ? new Uint8Array(body) : undefined,
  });
}

export interface S3Object {
  key: string;
  size: number;
  lastModified: string;
  etag: string;
}

// Garage answers ListObjectsV2 in XML. The shape is small and fixed, so the
// few fields we need are pulled out directly rather than adding a parser.
function tag(block: string, name: string): string {
  const m = block.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`));
  return m ? m[1] : '';
}

export async function listObjects(
  accessKeyId: string,
  secretAccessKey: string,
  bucket: string,
): Promise<S3Object[]> {
  const out: S3Object[] = [];
  let token: string | undefined;
  do {
    const query: Record<string, string> = { 'list-type': '2', 'max-keys': '1000' };
    if (token) query['continuation-token'] = token;
    const res = await signedFetch(accessKeyId, secretAccessKey, 'GET', `/${bucket}`, query);
    if (!res.ok) throw new Error(`S3 list failed: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
    const xml = await res.text();
    for (const block of xml.match(/<Contents>[\s\S]*?<\/Contents>/g) ?? []) {
      out.push({
        key: tag(block, 'Key'),
        size: Number(tag(block, 'Size')) || 0,
        lastModified: tag(block, 'LastModified'),
        etag: tag(block, 'ETag').replace(/&quot;|"/g, ''),
      });
    }
    // A truncated listing carries the token for the next page; without this a
    // bucket over 1000 objects would silently show only its first page.
    token = tag(xml, 'IsTruncated') === 'true' ? tag(xml, 'NextContinuationToken') : undefined;
  } while (token);
  return out.sort((a, b) => a.key.localeCompare(b.key));
}

export async function getObject(
  accessKeyId: string,
  secretAccessKey: string,
  bucket: string,
  key: string,
): Promise<Response> {
  return signedFetch(accessKeyId, secretAccessKey, 'GET', `/${bucket}/${encodeKey(key)}`);
}

export async function deleteObject(
  accessKeyId: string,
  secretAccessKey: string,
  bucket: string,
  key: string,
): Promise<void> {
  const res = await signedFetch(accessKeyId, secretAccessKey, 'DELETE', `/${bucket}/${encodeKey(key)}`);
  if (!res.ok && res.status !== 204) {
    throw new Error(`S3 delete failed: HTTP ${res.status}`);
  }
}

// Enough of a mapping to repair objects whose Content-Type was lost, and to
// give uploads a sensible type when a client sends none. Not a full table -
// anything unlisted stays generic rather than being guessed at.
const MIME: Record<string, string> = {
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  ico: 'image/x-icon',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  json: 'application/json',
  txt: 'text/plain',
  md: 'text/markdown',
  csv: 'text/csv',
  css: 'text/css',
  js: 'text/javascript',
  html: 'text/html',
  xml: 'application/xml',
  pdf: 'application/pdf',
  zip: 'application/zip',
};

export function mimeForKey(key: string): string | undefined {
  const ext = key.includes('.') ? key.split('.').pop()!.toLowerCase() : '';
  return MIME[ext];
}

export async function headObject(
  accessKeyId: string,
  secretAccessKey: string,
  bucket: string,
  key: string,
): Promise<Headers> {
  const res = await signedFetch(accessKeyId, secretAccessKey, 'HEAD', `/${bucket}/${encodeKey(key)}`);
  if (!res.ok) throw new Error(`S3 head failed: HTTP ${res.status}`);
  return res.headers;
}

// Rewrites an object's headers in place. S3 has no metadata-only update, so it
// is a copy onto itself with REPLACE - which is how Cache-Control on already
// uploaded objects gets corrected when a bucket is published.
//
// REPLACE discards every header not restated, so the existing ones are read
// first and carried over. Omitting that dropped Content-Type from a re-stamped
// object and browsers stopped rendering it.
export async function restampObject(
  accessKeyId: string,
  secretAccessKey: string,
  bucket: string,
  key: string,
  opts: PutOptions = {},
): Promise<void> {
  const existing = await headObject(accessKeyId, secretAccessKey, bucket, key);
  // A generic type is as good as none for rendering, so fall back to the
  // extension in that case too - which is what repairs an object whose type
  // was already lost.
  const stored = existing.get('content-type');
  const contentType =
    opts.contentType ??
    (stored && stored !== 'application/octet-stream' ? stored : undefined) ??
    mimeForKey(key);
  const contentEncoding = opts.contentEncoding ?? existing.get('content-encoding') ?? undefined;

  const headers: Record<string, string> = {
    'x-amz-copy-source': `/${bucket}/${encodeKey(key)}`,
    'x-amz-metadata-directive': 'REPLACE',
  };
  if (contentType) headers['content-type'] = contentType;
  if (contentEncoding) headers['content-encoding'] = contentEncoding;
  if (opts.cacheControl) headers['cache-control'] = opts.cacheControl;

  const res = await signedFetch(
    accessKeyId,
    secretAccessKey,
    'PUT',
    `/${bucket}/${encodeKey(key)}`,
    {},
    undefined,
    headers,
  );
  if (!res.ok) {
    throw new Error(`S3 copy failed: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  }
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
