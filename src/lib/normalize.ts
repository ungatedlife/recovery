/**
 * Shared normalization used by the legacy importer and every scraper adapter.
 * Web-standard APIs only (runs in Node scripts and in the Worker).
 */

export const slugify = (s: string): string =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);

const ID_ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz';

/** 20 chars of base32 from sha256(seed). Deterministic, collision-free at this scale. */
export async function stableId(seed: string): Promise<string> {
  const buf = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(seed)));
  let bits = '';
  for (const b of buf.subarray(0, 13)) bits += b.toString(2).padStart(8, '0');
  let out = '';
  for (let i = 0; i + 5 <= bits.length && out.length < 20; i += 5) out += ID_ALPHABET[parseInt(bits.slice(i, i + 5), 2)];
  return out;
}

export async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** '240-591-0364 code 951761#' -> { tel: '+12405910364,,951761#', notes: original } */
export function parsePhone(p: string | null | undefined): { tel: string | null; notes: string | null } {
  const raw = (p ?? '').trim();
  if (!raw) return { tel: null, notes: null };
  if (/^\+?\d[\d,#*]+$/.test(raw)) return { tel: raw.startsWith('+') ? raw : `+${raw}`, notes: null };
  const num = /(?:\+?1[-.\s]?)?\(?(\d{3})\)?[-.\s]?(\d{3})[-.\s]?(\d{4})/.exec(raw);
  const code = /(?:code|id|pin)\s*:?\s*([\d#]+)/i.exec(raw);
  if (!num) return { tel: null, notes: raw };
  let tel = `+1${num[1]}${num[2]}${num[3]}`;
  if (code) tel += `,,${code[1].replace(/#/g, '')}#`;
  return { tel, notes: raw };
}

export interface ConferenceUrlInfo {
  conferenceUrl: string | null;
  provider: 'zoom' | 'meet' | 'teams' | 'other' | null;
  zoomId: string | null;
  /** Zoom `pwd` was entirely lowercase: case-mangled somewhere upstream. */
  mangledPasscode: boolean;
}

export function parseConferenceUrl(u: string | null | undefined): ConferenceUrlInfo {
  const info: ConferenceUrlInfo = { conferenceUrl: null, provider: null, zoomId: null, mangledPasscode: false };
  const raw = (u ?? '').trim();
  if (!raw) return info;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return info;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return info;
  const host = url.hostname.toLowerCase();
  if (host === 'zoom.us' || host.endsWith('.zoom.us')) {
    info.provider = 'zoom';
    info.zoomId = /\/j\/(\d+)/.exec(url.pathname)?.[1] ?? null;
    const pwd = url.searchParams.get('pwd');
    if (pwd && /[a-z]/.test(pwd) && !/[A-Z]/.test(pwd)) {
      url.searchParams.delete('pwd');
      info.mangledPasscode = true;
    }
    info.conferenceUrl = url.toString();
    return info;
  }
  info.provider = host.endsWith('meet.google.com') ? 'meet' : host.includes('teams.microsoft') ? 'teams' : 'other';
  info.conferenceUrl = url.toString();
  return info;
}

/** Pull a video link, passcode hint and dial-in out of free text (Teamup notes, TSML notes). */
export function extractConference(text: string): { url: string | null; passcode: string | null; phone: string | null } {
  const plain = text.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ');
  const url = /https?:\/\/[\w.-]*zoom\.us\/j\/\d+(?:\?[\w=&.%-]+)?/.exec(plain)?.[0] ?? /https?:\/\/meet\.google\.com\/[\w-]+/.exec(plain)?.[0] ?? null;
  const noUrls = plain.replace(/https?:\/\/\S+/g, ' ');
  const passcode = /(?:passcode|password|pw|pwd)\s*[:\-]?\s*([^\s<]{3,40})/i.exec(noUrls)?.[1] ?? null;
  const phone = /(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}(?:[^\n]{0,30}?(?:code|id)\s*:?\s*\d{5,12})?/i.exec(noUrls)?.[0] ?? null;
  return { url, passcode, phone };
}

export const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Accepts '9:30', '09:30', '9:30 PM', '21:30:00'; returns 'HH:MM' or null. */
export function normalizeTime(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const m = /^\s*(\d{1,2})(?::(\d{2}))?(?::\d{2})?\s*([ap]\.?m\.?)?\s*$/i.exec(v);
  if (!m) return null;
  let h = +m[1];
  const mi = +(m[2] ?? '0');
  const ap = m[3]?.toLowerCase().replace(/\./g, '');
  if (ap === 'pm' && h < 12) h += 12;
  if (ap === 'am' && h === 12) h = 0;
  if (h > 23 || mi > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}`;
}
