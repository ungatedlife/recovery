/**
 * Cloudflare Access JWT verification for /admin. Workers that serve static
 * assets do not receive ctx.access, so the header is verified by hand:
 * RS256 against the team's JWKS, then iss / aud / nbf / exp. No library.
 */

export interface AccessIdentity {
  email: string;
  sub: string;
}

interface Jwk {
  kid: string;
  kty: string;
  alg?: string;
  n: string;
  e: string;
}

let jwksCache: { at: number; keys: Jwk[] } | null = null;
const JWKS_TTL_MS = 60 * 60 * 1000;

async function jwks(teamDomain: string, force = false): Promise<Jwk[]> {
  if (!force && jwksCache && Date.now() - jwksCache.at < JWKS_TTL_MS) return jwksCache.keys;
  const res = await fetch(`${teamDomain}/cdn-cgi/access/certs`, { cf: { cacheTtl: 3600 } } as RequestInit);
  if (!res.ok) throw new Error(`jwks fetch failed: ${res.status}`);
  const body = (await res.json()) as { keys?: Jwk[] };
  jwksCache = { at: Date.now(), keys: body.keys ?? [] };
  return jwksCache.keys;
}

function b64url(s: string): Uint8Array<ArrayBuffer> {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Returns the identity on success, null on any failure. Never throws. */
export async function verifyAccessJwt(token: string | null, teamDomain: string, aud: string): Promise<AccessIdentity | null> {
  try {
    if (!token) return null;
    const [h, p, s] = token.split('.');
    if (!h || !p || !s) return null;
    const header = JSON.parse(new TextDecoder().decode(b64url(h))) as { alg?: string; kid?: string };
    if (header.alg !== 'RS256' || !header.kid) return null;
    let key = (await jwks(teamDomain)).find((k) => k.kid === header.kid);
    if (!key) key = (await jwks(teamDomain, true)).find((k) => k.kid === header.kid);
    if (!key) return null;
    const cryptoKey = await crypto.subtle.importKey('jwk', { kty: key.kty, n: key.n, e: key.e, alg: 'RS256', ext: true }, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', cryptoKey, b64url(s), new TextEncoder().encode(`${h}.${p}`));
    if (!ok) return null;
    const claims = JSON.parse(new TextDecoder().decode(b64url(p))) as { iss?: string; aud?: string | string[]; exp?: number; nbf?: number; email?: string; sub?: string };
    const now = Math.floor(Date.now() / 1000);
    const audOk = Array.isArray(claims.aud) ? claims.aud.includes(aud) : claims.aud === aud;
    if (claims.iss !== teamDomain || !audOk) return null;
    if (typeof claims.exp !== 'number' || claims.exp <= now) return null;
    if (typeof claims.nbf === 'number' && claims.nbf > now + 60) return null;
    if (!claims.email || !claims.sub) return null;
    return { email: claims.email, sub: claims.sub };
  } catch {
    return null;
  }
}
