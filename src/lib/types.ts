/** Shapes shared by the publish job, the SSR shell and the client island. */

export type LinkKind = 'V' | 'P' | 'F' | '?';
export type TzConfidence = 'source' | 'inferred' | 'legacy-az';

/** One weekly meeting rule, trimmed to what the cards need. */
export interface MeetingLite {
  id: string;
  slug: string;
  f: string; // fellowship code
  name: string;
  day: number; // 0 = Sunday
  time: string; // 'HH:MM' in tz
  tz: string; // IANA
  tzc: TzConfidence;
  types: string[]; // TSML codes plus X-* custom codes
  url: string | null; // direct join link
  urlNotes: string | null; // passcode hint etc.
  phone: string | null; // tel-dialable
  phoneNotes: string | null; // human form
  provider: string | null; // 'zoom' | 'meet' | 'phone' | 'detail-page'
  link: LinkKind;
  notes: string | null;
  group: string | null; // shared across daily/weekdaily siblings
  listing: string | null; // official page for this meeting
  health: string | null; // link_health verdict, null = unchecked
}

export interface FellowshipLite {
  code: string;
  name: string;
  color: string;
  colorDark: string;
  website: string | null;
}

export interface Dataset {
  v: 1;
  generated: string; // ISO
  hash: string; // sha256 prefix of meetings payload
  fellowships: FellowshipLite[];
  meetings: MeetingLite[];
}

/** Per-viewer preferences. Phase 0 keeps these in localStorage, Phase 1 in D1. */
export interface Prefs {
  fellowships: string[]; // [] = all
  types: Record<string, -1 | 0 | 1>; // boost / neutral / mute per code
  menOnly: boolean;
  womenOnly: boolean;
  videoOnly: boolean;
  timezone: string | null; // null = auto
  joinGraceMin: number;
  pageSize: number;
}

export const DEFAULT_PREFS: Prefs = {
  fellowships: [],
  types: {},
  menOnly: false,
  womenOnly: false,
  videoOnly: false,
  timezone: null,
  joinGraceMin: 10,
  pageSize: 12,
};

/** Human labels for type codes, in the order they should read on a card. */
export const TYPE_LABELS: Record<string, string> = {
  M: "men's",
  W: "women's",
  'X-BIZ': 'biz',
  'X-VISIONS': 'visions',
  'X-CREATIVE': 'creative',
  'X-ACTION': 'action',
  ST: 'steps',
  SP: 'speaker',
  MED: 'meditation',
  BE: 'newcomer',
  LIT: 'literature',
  D: 'discussion',
  C: 'closed',
  O: 'open',
  LGBTQ: 'lgbtq+',
  Y: 'young people',
};

/** Types a viewer can boost or mute from the sidebar. */
export const TUNABLE_TYPES = ['X-BIZ', 'X-CREATIVE', 'X-ACTION', 'X-VISIONS', 'SP', 'ST', 'MED', 'BE'] as const;
