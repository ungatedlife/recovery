/**
 * Build the client dataset from meeting rows. Used by the legacy importer (Node)
 * and the publish job (Worker), so it only touches Web-standard APIs.
 */
import type { Fellowship, Meeting } from '~db/schema.ts';
import type { Dataset, FellowshipLite, LinkKind, MeetingLite, TzConfidence } from './types.ts';

export function toLite(m: Meeting, health: string | null = null): MeetingLite {
  return {
    id: m.id,
    slug: m.slug,
    f: m.fellowship,
    name: m.name,
    day: m.day ?? 0,
    time: m.time ?? '00:00',
    tz: m.timezone,
    tzc: m.tzConfidence as TzConfidence,
    types: safeTypes(m.typesJson),
    url: m.conferenceUrl,
    urlNotes: m.conferenceUrlNotes,
    phone: m.conferencePhone,
    phoneNotes: m.conferencePhoneNotes,
    provider: m.conferenceProvider,
    link: (m.linkKind as LinkKind) ?? '?',
    notes: m.notes,
    group: m.groupName,
    listing: m.url,
    health,
  };
}

export function toFellowshipLite(f: Fellowship): FellowshipLite {
  return { code: f.code, name: f.name, color: f.color, colorDark: f.colorDark, website: f.website };
}

function safeTypes(json: string): string[] {
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function buildDataset(fellowships: FellowshipLite[], meetings: MeetingLite[]): Promise<Dataset> {
  meetings.sort((a, b) => a.day - b.day || a.time.localeCompare(b.time) || a.slug.localeCompare(b.slug));
  const hash = (await sha256Hex(JSON.stringify(meetings))).slice(0, 16);
  return { v: 1, generated: new Date().toISOString(), hash, fellowships, meetings };
}
