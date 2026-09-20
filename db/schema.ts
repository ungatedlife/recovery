/**
 * Double Winners schema. Meetings are recurring rules with a local wall time and an
 * IANA timezone (Meeting Guide / TSML field names wherever one exists), never
 * pre-expanded occurrences. Curated edits live in `overrides` and are re-applied
 * after every scrape so they survive upstream changes.
 *
 * Phase 0 = catalog tables. Identity tables arrive in Phase 1, scrape bookkeeping in Phase 2.
 */
import { index, integer, primaryKey, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const fellowships = sqliteTable('fellowships', {
  code: text('code').primaryKey(), // 'DA', 'BDA', 'UA', 'EDA', 'SLAA', ...
  name: text('name').notNull(),
  color: text('color').notNull(), // CSS color token, light-mode value
  colorDark: text('color_dark').notNull(),
  website: text('website'),
  sortOrder: integer('sort_order').notNull().default(100),
  active: integer('active').notNull().default(1),
});

export const sources = sqliteTable('sources', {
  id: text('id').primaryKey(), // 'da-virtual', 'ua-tsml', 'slaa-teamup', 'da-legacy'
  fellowship: text('fellowship').notNull().references(() => fellowships.code),
  adapter: text('adapter').notNull(), // 'tsml-feed' | 'teamup' | 'da-html' | 'manual'
  url: text('url').notNull(), // human landing page, shown in attribution
  configJson: text('config_json').notNull().default('{}'),
  cadenceHours: integer('cadence_hours').notNull().default(168),
  defaultTz: text('default_tz'),
  enabled: integer('enabled').notNull().default(1),
  lastRunAt: text('last_run_at'),
  lastSuccessAt: text('last_success_at'),
});

export const meetings = sqliteTable(
  'meetings',
  {
    id: text('id').primaryKey(), // ulid-ish, stable forever
    slug: text('slug').notNull().unique(), // TSML slug
    fellowship: text('fellowship').notNull().references(() => fellowships.code),
    name: text('name').notNull(),
    day: integer('day'), // 0 = Sunday .. 6 = Saturday; NULL for non-weekly rrule
    time: text('time'), // 'HH:MM' local wall time in `timezone`
    endTime: text('end_time'),
    timezone: text('timezone').notNull(), // IANA
    tzConfidence: text('tz_confidence').notNull().default('source'), // 'source' | 'inferred' | 'legacy-az'
    rrule: text('rrule'), // RFC 5545, NULL means weekly on `day`
    typesJson: text('types_json').notNull().default('[]'), // TSML codes + X-BIZ, X-VISIONS, X-CREATIVE, X-ACTION
    conferenceUrl: text('conference_url'),
    conferenceUrlNotes: text('conference_url_notes'),
    conferencePhone: text('conference_phone'), // tel-dialable, e.g. +12405910364,,951761#
    conferencePhoneNotes: text('conference_phone_notes'),
    conferenceProvider: text('conference_provider'), // 'zoom' | 'meet' | 'phone' | 'detail-page'
    linkKind: text('link_kind').notNull().default('?'), // 'V' video, 'P' phone/detail page, 'F' hybrid, '?' none
    notes: text('notes'),
    groupName: text('group_name'),
    groupNotes: text('group_notes'),
    url: text('url'), // official listing page for this meeting (TSML `url`)
    language: text('language').default('en'),
    // Geography stays NULL in v1. Present so AA/NA TSML feeds can land later without a migration.
    formattedAddress: text('formatted_address'),
    latitude: real('latitude'),
    longitude: real('longitude'),
    region: text('region'),
    approximate: text('approximate'),
    status: text('status').notNull().default('active'), // 'active' | 'missing' | 'retired' | 'pending'
    firstSeenAt: text('first_seen_at').notNull(),
    lastSeenAt: text('last_seen_at').notNull(),
    updated: text('updated').notNull(), // TSML `updated`, 'YYYY-MM-DD HH:MM:SS' UTC
  },
  (t) => [
    index('meetings_status_day_time').on(t.status, t.day, t.time),
    index('meetings_fellowship_status').on(t.fellowship, t.status),
  ],
);

export const meetingSources = sqliteTable(
  'meeting_sources',
  {
    meetingId: text('meeting_id').notNull().references(() => meetings.id, { onDelete: 'cascade' }),
    sourceId: text('source_id').notNull().references(() => sources.id),
    sourceKey: text('source_key').notNull(), // DA mid, TSML slug, Teamup base event id, zoom meeting id
    rawHash: text('raw_hash').notNull(), // sha256 of the normalized payload
    rawJson: text('raw_json'),
    seenAt: text('seen_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.sourceId, t.sourceKey] }), index('meeting_sources_meeting').on(t.meetingId)],
);

export const overrides = sqliteTable(
  'overrides',
  {
    meetingId: text('meeting_id').notNull().references(() => meetings.id, { onDelete: 'cascade' }),
    field: text('field').notNull(), // column name on meetings, e.g. 'types_json', 'notes', 'timezone'
    value: text('value'), // JSON-encoded; NULL forces NULL
    reason: text('reason'),
    author: text('author').notNull().default('owner'),
    createdAt: text('created_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.meetingId, t.field] })],
);

export const linkHealth = sqliteTable('link_health', {
  meetingId: text('meeting_id').primaryKey().references(() => meetings.id, { onDelete: 'cascade' }),
  url: text('url').notNull(),
  checkedAt: text('checked_at').notNull(),
  httpStatus: integer('http_status'),
  verdict: text('verdict').notNull(), // 'ok' | 'redirect' | 'dead-host' | 'zoom-invalid' | 'needs-passcode' | 'unknown'
  consecutiveFailures: integer('consecutive_failures').notNull().default(0),
});

export type Meeting = typeof meetings.$inferSelect;
export type NewMeeting = typeof meetings.$inferInsert;
export type Fellowship = typeof fellowships.$inferSelect;
