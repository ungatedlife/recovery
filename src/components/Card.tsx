/** One meeting card. Rendered by the island (interactive) and by /m/[slug] (static). */
import { gcalUrl } from '~/lib/gcal.ts';
import { DAYS, fmtHM, zonedParts } from '~/lib/time.ts';
import { TYPE_LABELS, type MeetingLite } from '~/lib/types.ts';

export interface Timed extends MeetingLite {
  start: Date;
  delta: number;
}

export function whenLabel(x: Timed, now: Date, tz: string): string {
  if (x.delta <= 0) return `started ${-x.delta}m ago · joinable`;
  const np = zonedParts(now, tz);
  const sp = zonedParts(x.start, tz);
  const t = fmtHM(sp.h, sp.mi);
  if (x.delta < 1440 && sp.dow === np.dow) {
    const rel = x.delta >= 60 ? `${Math.floor(x.delta / 60)}h ${x.delta % 60}m` : `${x.delta}m`;
    return `in ${rel} · ${t}`;
  }
  return `${DAYS[sp.dow].slice(0, 3).toLowerCase()} ${t}`;
}

export function metaLine(m: MeetingLite): string {
  const tags = m.types.filter((c) => c !== 'M' && c !== 'W').map((c) => TYPE_LABELS[c] ?? c.toLowerCase());
  const parts = [tags.join(' · '), m.urlNotes, m.url ? '' : m.phoneNotes, m.notes];
  if (m.health === 'needs-passcode') parts.push('zoom will ask for a passcode');
  else if (m.health && m.health !== 'ok' && m.health !== 'unknown') parts.push('link may be stale');
  return parts.filter(Boolean).join(' — ');
}

interface Props {
  m: Timed;
  now: Date;
  tz: string;
  feat?: boolean;
  saved?: boolean;
  onSave?: (id: string) => void;
  onHide?: (id: string) => void;
}

export function Card({ m, now, tz, feat, saved, onSave, onHide }: Props) {
  const live = m.delta <= 0;
  const meta = metaLine(m);
  const tel = m.phone ? `tel:${m.phone}` : null;
  return (
    <div class={`card f-${m.f}${live ? ' live' : ''}${feat ? ' feat' : ''}`}>
      <div class="row1">
        <span class={`when${live ? ' live' : ''}`}>
          {whenLabel(m, now, tz)}
          {m.tzc === 'legacy-az' && (
            <span class="unv" title="Time was recorded in Arizona from the fellowship's listing and has not been re-verified. Check the listing if it matters.">
              {' ~'}
            </span>
          )}
        </span>
        <span class="fell">{m.f}</span>
        {m.types.includes('M') && <span class="mens">MEN’S</span>}
        {m.types.includes('W') && <span class="womens">WOMEN’S</span>}
      </div>
      <div class="name">
        <a href={`/m/${m.slug}`}>{m.name}</a>
      </div>
      {meta && <div class="meta">{meta}</div>}
      <div class="acts">
        {m.url ? (
          <a class="join" href={m.url} target="_blank" rel="noopener noreferrer">
            {m.provider === 'zoom' ? 'join zoom' : 'join'}
          </a>
        ) : m.listing ? (
          <a class="detail" href={m.listing} target="_blank" rel="noopener noreferrer">
            details ↗
          </a>
        ) : tel ? (
          <a class="phonebtn" href={tel}>
            call in
          </a>
        ) : null}
        {m.url && m.listing && (
          <a class="detail" href={m.listing} target="_blank" rel="noopener noreferrer">
            listing ↗
          </a>
        )}
        <a class="gcal" href={gcalUrl(m, m.start)} target="_blank" rel="noopener noreferrer">
          + cal
        </a>
        {onSave && (
          <button type="button" class={saved ? 'on' : ''} aria-pressed={saved} onClick={() => onSave(m.id)}>
            {saved ? '★ saved' : '☆ save'}
          </button>
        )}
        {onHide && (
          <button type="button" class="hide" title="hide this meeting" onClick={() => onHide(m.id)}>
            ×
          </button>
        )}
      </div>
    </div>
  );
}
