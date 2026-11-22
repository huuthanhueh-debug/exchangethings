// Phiên đăng nhập thử cho máy dev (AUTH_MODE=dev, xem DECISIONS D-23): cookie chứa {sub, exp} ký HMAC-SHA256.
// Dùng Web Crypto để chạy được cả trong proxy lẫn Server Component. Không dùng ở production:
// env() từ chối AUTH_MODE=dev khi database không ở localhost hoặc khi chạy trên Vercel.

export const DEV_SESSION_COOKIE = 'et_dev_session';
export const DEV_SESSION_MAX_AGE = 60 * 60 * 24 * 7;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const enc = new TextEncoder();

function toB64url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64url(s: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]*$/.test(s)) return null;
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4));
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function hmacKey(secret: string) {
  return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

export async function signDevSession(sub: string, secret: string, nowMs = Date.now()): Promise<string> {
  if (!UUID.test(sub)) throw new Error('invalid user id');
  const payload = toB64url(enc.encode(JSON.stringify({ sub, exp: Math.floor(nowMs / 1000) + DEV_SESSION_MAX_AGE })));
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', await hmacKey(secret), enc.encode(payload)));
  return `${payload}.${toB64url(sig)}`;
}

/** Trả user id nếu cookie hợp lệ và chưa hết hạn; mọi trường hợp khác trả null. So chữ ký thời gian hằng. */
export async function verifyDevSession(token: string | undefined, secret: string, nowMs = Date.now()): Promise<string | null> {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payload, sigText] = parts;
  const sig = fromB64url(sigText);
  if (!sig) return null;
  const ok = await crypto.subtle.verify('HMAC', await hmacKey(secret), sig, enc.encode(payload));
  if (!ok) return null;
  try {
    const bytes = fromB64url(payload);
    if (!bytes) return null;
    const data: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (typeof data !== 'object' || data === null) return null;
    const { sub, exp } = data as { sub?: unknown; exp?: unknown };
    if (typeof sub !== 'string' || !UUID.test(sub) || typeof exp !== 'number' || exp * 1000 <= nowMs) return null;
    return sub;
  } catch {
    return null;
  }
}
