/**
 * One-shot importer for the original single-file tracker.
 *
 *   npm run import:legacy
 *
 * Reads legacy/index.html (the `const M = [...]` line), collapses duplicated
 * weekly occurrences into rules, assigns real timezones, moves curated tags into
 * `overrides`, flags case-mangled Zoom passcodes, and writes:
 *   db/seed/legacy.sql      -> `wrangler d1 execute DB --file db/seed/legacy.sql`
 *   src/data/dataset.json   -> bundled fallback dataset served until KV has one
 *
 * Deterministic: re-running produces identical ids and SQL.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Fellowship, Meeting } from '../db/schema.ts';
import { buildDataset, toFellowshipLite, toLite } from '../src/lib/dataset.ts';
import { BYDAY, shiftHHMM } from '../src/lib/time.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const NOW = '2026-07-23 00:00:00'; // when the legacy data was gathered
const NOW_ISO = '2026-07-23T00:00:00.000Z';

interface LegacyRow {
  f: string;
  d: number;
  m: number; // minutes after midnight, America/Phoenix, July 2026
  n: string;
  u: string;
  p: string;
  pw: string;
  mens: 0 | 1;
  t: string[];
  v: 'V' | 'P' | 'F' | '?';
  nt: string;
  s: number;
}

// ---------- reference data ----------

const FELLOWSHIPS: Fellowship[] = [
  { code: 'DA', name: 'Debtors Anonymous', color: '#2f5d50', colorDark: '#7fb3a4', website: 'https://debtorsanonymous.org', sortOrder: 10, active: 1 },
  { code: 'BDA', name: 'Business Debtors Anonymous', color: '#5d4a8f', colorDark: '#a794d6', website: 'https://debtorsanonymous.org/bda/', sortOrder: 20, active: 1 },
  { code: 'UA', name: 'Underearners Anonymous', color: '#b0742a', colorDark: '#d19a52', website: 'https://www.underearnersanonymous.org', sortOrder: 30, active: 1 },
  { code: 'EDA', name: 'Eating Disorders Anonymous', color: '#a84c4c', colorDark: '#cf8080', website: 'https://eatingdisordersanonymous.org', sortOrder: 40, active: 1 },
  { code: 'SLAA', name: 'Sex and Love Addicts Anonymous', color: '#3d6b96', colorDark: '#82aacf', website: 'https://slaafws.org', sortOrder: 50, active: 1 },
];

const SOURCE_URLS: Record<string, string> = {
  DA: 'https://debtorsanonymous.org/meeting-search-virtual-first/',
  BDA: 'https://debtorsanonymous.org/meeting-search-virtual-first/',
  UA: 'https://www.underearnersanonymous.org/meetings-underearners-anonymous/',
  EDA: 'https://eatingdisordersanonymous.org/meetings/',
  SLAA: 'https://slaavirtual.org/meetingcalendar/',
};

/** Legacy `t` tags and note phrases -> TSML-style type codes. */
const TAG_TO_CODE: Record<string, string> = {
  steps: 'ST',
  speaker: 'SP',
  meditation: 'MED',
  newcomer: 'BE',
  biz: 'X-BIZ',
  visions: 'X-VISIONS',
  creative: 'X-CREATIVE',
  action: 'X-ACTION',
};

/** Notes that describe a scrape failure rather than the meeting. Never shown as notes. */
const SCRAPE_NOTES = new Set([
  'detail page has zoom link',
  'no public link — see slaavirtual.org calendar',
  'zoom truncated, check UA calendar',
  'zoom truncated in source',
  'new meeting, no link listed',
  "MEN'S — link truncated in source, check UA calendar link tru",
]);

/**
 * Directories that publish Eastern time. The legacy file stored Arizona minutes
 * captured in July (AZ = UTC-7, ET = UTC-4), so the source-native wall time is +180.
 */
const ET_FELLOWSHIPS = new Set(['DA', 'BDA', 'UA']);

/** Name/note patterns that pin a meeting to a zone regardless of fellowship. Offset is from July Arizona. */
const HAND_FIXES: Array<{ re: RegExp; tz: string; offset: number }> = [
  { re: /\b(london|uk|essex|leigh on sea)\b/i, tz: 'Europe/London', offset: 480 },
  { re: /\bireland|salthill\b/i, tz: 'Europe/Dublin', offset: 480 },
  { re: /\bberlin\b/i, tz: 'Europe/Berlin', offset: 540 },
  { re: /\b(sydney|melbourne|aus)\b/i, tz: 'Australia/Sydney', offset: 1020 },
  { re: /\bchicago\b/i, tz: 'America/Chicago', offset: 120 },
  { re: /\b(tucson|mesa) az\b/i, tz: 'America/Phoenix', offset: 0 },
  { re: /\bbend or\b/i, tz: 'America/Los_Angeles', offset: 0 },
];

// ---------- helpers ----------

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const q = (v: unknown): string => {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') return String(v);
  return `'${String(v).replace(/'/g, "''")}'`;
};
const slugify = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);

function stableId(seed: string): string {
  // 20 chars of base32 from sha256: collision-free at this scale, sortable enough, deterministic.
  const hex = sha(seed);
  const alphabet = '0123456789abcdefghjkmnpqrstvwxyz';
  let bits = '';
  for (const c of hex.slice(0, 25)) bits += parseInt(c, 16).toString(2).padStart(4, '0');
  let out = '';
  for (let i = 0; i + 5 <= bits.length && out.length < 20; i += 5) out += alphabet[parseInt(bits.slice(i, i + 5), 2)];
  return out;
}

function toHHMM(mins: number): string {
  return `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
}

/** '240-591-0364 code 951761#' -> { tel: '+12405910364,,951761#', notes: original } */
function parsePhone(p: string): { tel: string | null; notes: string | null } {
  const raw = p.trim();
  if (!raw) return { tel: null, notes: null };
  const num = /(\d{3})[-.\s]?(\d{3})[-.\s]?(\d{4})/.exec(raw);
  const code = /code\s*:?\s*([\d#]+)/i.exec(raw);
  if (!num) return { tel: null, notes: raw };
  let tel = `+1${num[1]}${num[2]}${num[3]}`;
  if (code) tel += `,,${code[1].replace(/#/g, '')}#`;
  return { tel, notes: raw };
}

interface UrlInfo {
  conferenceUrl: string | null;
  listing: string | null;
  provider: string | null;
  zoomId: string | null;
  daMid: string | null;
  mangledPasscode: boolean;
}

function parseUrl(u: string): UrlInfo {
  const info: UrlInfo = { conferenceUrl: null, listing: null, provider: null, zoomId: null, daMid: null, mangledPasscode: false };
  if (!u) return info;
  let url: URL;
  try {
    url = new URL(u);
  } catch {
    return info;
  }
  if (url.hostname.endsWith('debtorsanonymous.org')) {
    info.listing = u;
    info.provider = 'detail-page';
    info.daMid = url.searchParams.get('mid');
    return info;
  }
  if (url.hostname.endsWith('zoom.us')) {
    info.provider = 'zoom';
    info.zoomId = /\/j\/(\d+)/.exec(url.pathname)?.[1] ?? null;
    const pwd = url.searchParams.get('pwd');
    // Zoom passcodes are case-sensitive base64-ish strings. One that is entirely
    // lowercase (and not purely numeric) was case-mangled at collection time.
    if (pwd && /[a-z]/.test(pwd) && !/[A-Z]/.test(pwd)) {
      url.searchParams.delete('pwd');
      info.mangledPasscode = true;
    }
    info.conferenceUrl = url.toString();
    return info;
  }
  info.conferenceUrl = u;
  info.provider = 'other';
  return info;
}

function resolveTz(row: LegacyRow): { tz: string; offset: number; confidence: Meeting['tzConfidence'] } {
  const hay = `${row.n} ${row.nt}`;
  for (const fix of HAND_FIXES) if (fix.re.test(hay)) return { tz: fix.tz, offset: fix.offset, confidence: 'inferred' };
  if (ET_FELLOWSHIPS.has(row.f)) return { tz: 'America/New_York', offset: 180, confidence: 'inferred' };
  return { tz: 'America/Phoenix', offset: 0, confidence: 'legacy-az' };
}

function typesFor(row: LegacyRow): string[] {
  const codes = new Set<string>();
  for (const t of row.t) if (TAG_TO_CODE[t]) codes.add(TAG_TO_CODE[t]);
  if (row.mens) codes.add('M');
  if (/\bclosed\b/i.test(row.nt)) codes.add('C');
  if (/\bspeaker\b/i.test(row.nt)) codes.add('SP');
  if (/\bnewcomer|beginners\b/i.test(row.nt)) codes.add('BE');
  if (/\bwomen'?s\b/i.test(row.n) && !/\bmen'?s\b/i.test(row.n.replace(/women'?s/i, ''))) codes.add('W');
  return [...codes].sort();
}

// ---------- main ----------

function main() {
  const html = readFileSync(resolve(ROOT, 'legacy/index.html'), 'utf8');
  const line = html.split('\n').find((l) => l.startsWith('const M = '));
  if (!line) throw new Error('could not find `const M = ` in legacy/index.html');
  const rows: LegacyRow[] = JSON.parse(line.replace(/^const M = /, '').replace(/;\s*$/, ''));
  console.log(`legacy rows: ${rows.length}`);

  // 1. collapse occurrences into rules
  const groups = new Map<string, { row: LegacyRow; days: Set<number> }>();
  for (const r of rows) {
    const key = [r.f, r.n, r.m, r.u, r.p, r.pw, r.mens].join('|');
    const g = groups.get(key);
    if (g) g.days.add(r.d);
    else groups.set(key, { row: r, days: new Set([r.d]) });
  }
  console.log(`rules: ${groups.size}, multi-day: ${[...groups.values()].filter((g) => g.days.size > 1).length}`);

  const meetings: Meeting[] = [];
  const overrides: Array<{ meetingId: string; field: string; value: string | null; reason: string }> = [];
  const provenance: Array<{ meetingId: string; sourceId: string; sourceKey: string; rawHash: string; rawJson: string }> = [];
  const health: Array<{ meetingId: string; url: string; verdict: string }> = [];
  const slugs = new Set<string>();
  let mangled = 0;

  for (const { row, days } of groups.values()) {
    const { tz, offset, confidence } = resolveTz(row);
    const url = parseUrl(row.u);
    const phone = parsePhone(row.p);
    const types = typesFor(row);
    const isScrapeNote = SCRAPE_NOTES.has(row.nt);
    const notes = row.nt && !isScrapeNote ? row.nt : null;
    const groupName = days.size > 1 ? row.n : null;
    const listing = url.listing ?? (row.f === 'SLAA' && /slaavirtual/.test(row.nt) ? SOURCE_URLS.SLAA : null);
    const linkKind: Meeting['linkKind'] = url.conferenceUrl ? (row.v === 'F' ? 'F' : 'V') : url.listing || phone.tel ? 'P' : '?';
    const provider = url.provider ?? (phone.tel ? 'phone' : null);

    for (const legacyDay of [...days].sort()) {
      const shifted = shiftHHMM(toHHMM(row.m), offset);
      const day = (legacyDay + shifted.dayCarry + 7) % 7;
      let slug = `${row.f.toLowerCase()}-${slugify(row.n)}-${BYDAY[day].toLowerCase()}-${shifted.time.replace(':', '')}`;
      let n = 2;
      while (slugs.has(slug)) slug = `${slug}-${n++}`;
      slugs.add(slug);
      const id = stableId(`legacy|${slug}`);

      meetings.push({
        id,
        slug,
        fellowship: row.f,
        name: row.n.trim(),
        day,
        time: shifted.time,
        endTime: null,
        timezone: tz,
        tzConfidence: confidence,
        rrule: null,
        typesJson: JSON.stringify(types),
        conferenceUrl: url.conferenceUrl,
        conferenceUrlNotes: row.pw || null,
        conferencePhone: phone.tel,
        conferencePhoneNotes: phone.notes,
        conferenceProvider: provider,
        linkKind,
        notes,
        groupName,
        groupNotes: null,
        url: listing,
        language: 'en',
        formattedAddress: null,
        latitude: null,
        longitude: null,
        region: null,
        approximate: null,
        status: 'active',
        firstSeenAt: NOW_ISO,
        lastSeenAt: NOW_ISO,
        updated: NOW,
      });

      // curated fields win over any future scrape
      if (types.length) overrides.push({ meetingId: id, field: 'types_json', value: JSON.stringify(types), reason: 'legacy tags + mens flag' });
      if (notes) overrides.push({ meetingId: id, field: 'notes', value: JSON.stringify(notes), reason: 'legacy note' });
      if (confidence === 'inferred' && HAND_FIXES.some((f) => f.re.test(`${row.n} ${row.nt}`)))
        overrides.push({ meetingId: id, field: 'timezone', value: JSON.stringify(tz), reason: 'timezone hint in name' });

      const sourceKey = url.daMid ? `mid:${url.daMid}` : url.zoomId ? `zoom:${url.zoomId}:${day}` : `slug:${slug}`;
      provenance.push({ meetingId: id, sourceId: `${row.f.toLowerCase()}-legacy`, sourceKey, rawHash: sha(JSON.stringify(row)), rawJson: JSON.stringify(row) });

      if (url.mangledPasscode && url.conferenceUrl) {
        mangled++;
        health.push({ meetingId: id, url: url.conferenceUrl, verdict: 'needs-passcode' });
      }
    }
  }
  console.log(`meetings: ${meetings.length}, overrides: ${overrides.length}, mangled passcodes: ${mangled}`);

  // 2. SQL
  const out: string[] = ['-- generated by scripts/import-legacy.ts; do not edit by hand. One statement per `;\\n`.'];
  for (const f of FELLOWSHIPS)
    out.push(
      `INSERT OR REPLACE INTO fellowships (code,name,color,color_dark,website,sort_order,active) VALUES (${[f.code, f.name, f.color, f.colorDark, f.website, f.sortOrder, f.active].map(q).join(',')});`,
    );
  for (const f of FELLOWSHIPS)
    out.push(
      `INSERT OR REPLACE INTO sources (id,fellowship,adapter,url,config_json,cadence_hours,default_tz,enabled,last_run_at,last_success_at) VALUES (${[`${f.code.toLowerCase()}-legacy`, f.code, 'manual', SOURCE_URLS[f.code], '{}', 0, ET_FELLOWSHIPS.has(f.code) ? 'America/New_York' : null, 0, NOW_ISO, NOW_ISO].map(q).join(',')});`,
    );

  const cols = Object.keys(meetings[0]) as Array<keyof Meeting>;
  const snake = (s: string) => s.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
  const batches = <T>(arr: T[], n: number) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));
  for (const b of batches(meetings, 25))
    out.push(`INSERT OR REPLACE INTO meetings (${cols.map(snake).join(',')}) VALUES\n${b.map((m) => `(${cols.map((c) => q(m[c])).join(',')})`).join(',\n')};`);
  for (const b of batches(provenance, 25))
    out.push(
      `INSERT OR REPLACE INTO meeting_sources (meeting_id,source_id,source_key,raw_hash,raw_json,seen_at) VALUES\n${b.map((p) => `(${[p.meetingId, p.sourceId, p.sourceKey, p.rawHash, p.rawJson, NOW_ISO].map(q).join(',')})`).join(',\n')};`,
    );
  for (const b of batches(overrides, 50))
    out.push(
      `INSERT OR REPLACE INTO overrides (meeting_id,field,value,reason,author,created_at) VALUES\n${b.map((o) => `(${[o.meetingId, o.field, o.value, o.reason, 'owner-2026-07', NOW_ISO].map(q).join(',')})`).join(',\n')};`,
    );
  for (const b of batches(health, 50))
    out.push(
      `INSERT OR REPLACE INTO link_health (meeting_id,url,checked_at,http_status,verdict,consecutive_failures) VALUES\n${b.map((h) => `(${[h.meetingId, h.url, NOW_ISO, null, h.verdict, 0].map(q).join(',')})`).join(',\n')};`,
    );
  mkdirSync(resolve(ROOT, 'db/seed'), { recursive: true });
  writeFileSync(resolve(ROOT, 'db/seed/legacy.sql'), out.join('\n') + '\n');

  // 3. bundled dataset
  const healthById = new Map(health.map((h) => [h.meetingId, h.verdict]));
  return buildDataset(
    FELLOWSHIPS.map(toFellowshipLite),
    meetings.map((m) => toLite(m, healthById.get(m.id) ?? null)),
  ).then((ds) => {
    ds.generated = NOW_ISO;
    mkdirSync(resolve(ROOT, 'src/data'), { recursive: true });
    writeFileSync(resolve(ROOT, 'src/data/dataset.json'), JSON.stringify(ds));
    console.log(`wrote db/seed/legacy.sql and src/data/dataset.json (hash ${ds.hash})`);
  });
}

await main();
