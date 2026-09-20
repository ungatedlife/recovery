/**
 * The app. Server-rendered with defaults, hydrated with the viewer's prefs, and
 * re-sorted every 30 seconds. One island so the sidebar and the list share state.
 */
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { Card, type Timed } from '~/components/Card.tsx';
import { browserTimeZone, loadIdSet, loadPrefs, saveIdSet, savePrefs } from '~/lib/prefs.ts';
import { passesFilters, score } from '~/lib/score.ts';
import { DAYS, fmtHM, isValidTimeZone, minutesBetween, nextStart, tzLabel, zonedParts } from '~/lib/time.ts';
import { readDataset } from '~/lib/current.ts';
import { DEFAULT_PREFS, TUNABLE_TYPES, TYPE_LABELS, type Dataset, type Prefs } from '~/lib/types.ts';

interface Props {
  initialTz: string;
  serverNow: number;
}

interface Scored extends Timed {
  sc: number;
}

const EMPTY = new Set<string>();

export default function NextMeetings({ initialTz, serverNow }: Props) {
  const [ds, setDs] = useState<Dataset>(readDataset);
  const [now, setNow] = useState(() => new Date(serverNow));
  const [prefs, setPrefsState] = useState<Prefs>(DEFAULT_PREFS);
  const [hasPrefs, setHasPrefs] = useState(false);
  const [saved, setSaved] = useState<Set<string>>(EMPTY);
  const [hidden, setHidden] = useState<Set<string>>(EMPTY);
  const [showHidden, setShowHidden] = useState(false);
  const [shown, setShown] = useState(DEFAULT_PREFS.pageSize);
  const [tz, setTz] = useState(initialTz);
  const [pickTz, setPickTz] = useState(false);
  const dsRef = useRef(ds);
  dsRef.current = ds;
  const startCache = useRef(new Map<string, Date>());

  useEffect(() => {
    const p = loadPrefs();
    if (p) {
      setPrefsState(p);
      setHasPrefs(true);
      if (p.timezone && isValidTimeZone(p.timezone)) setTz(p.timezone);
      else {
        const b = browserTimeZone();
        if (b) setTz(b);
      }
    } else {
      const b = browserTimeZone();
      if (b) setTz(b);
    }
    setSaved(loadIdSet('saved'));
    setHidden(loadIdSet('hidden'));
    const tick = () => setNow(new Date());
    tick();
    const iv = setInterval(tick, 30_000);
    const vis = () => document.visibilityState === 'visible' && tick();
    document.addEventListener('visibilitychange', vis);
    const refresh = async () => {
      try {
        const r = await fetch('/data/meetings.json', { headers: { 'if-none-match': `"${dsRef.current.hash}"` } });
        if (r.status === 200) {
          const next = (await r.json()) as Dataset;
          if (next.v === 1 && next.hash !== dsRef.current.hash) setDs(next);
        }
      } catch {
        /* offline: keep what we have */
      }
    };
    const rf = setInterval(refresh, 30 * 60_000);
    return () => {
      clearInterval(iv);
      clearInterval(rf);
      document.removeEventListener('visibilitychange', vis);
    };
  }, []);

  const setPrefs = (next: Prefs) => {
    setPrefsState(next);
    setHasPrefs(true);
    setShown(next.pageSize);
    savePrefs(next);
  };
  const toggleFellowship = (code: string | null) => {
    if (code === null) return setPrefs({ ...prefs, fellowships: [] });
    const has = prefs.fellowships.includes(code);
    setPrefs({ ...prefs, fellowships: has ? prefs.fellowships.filter((c) => c !== code) : [...prefs.fellowships, code] });
  };
  const cycleType = (code: string) => {
    const cur = prefs.types[code] ?? 0;
    const next: -1 | 0 | 1 = cur === 0 ? 1 : cur === 1 ? -1 : 0;
    setPrefs({ ...prefs, types: { ...prefs.types, [code]: next } });
  };
  const changeTz = (next: string) => {
    if (!isValidTimeZone(next)) return;
    setTz(next);
    setPickTz(false);
    setPrefs({ ...prefs, timezone: next });
    try {
      document.cookie = `dw_tz=${encodeURIComponent(next)}; path=/; max-age=31536000; samesite=lax; secure`;
    } catch {
      /* ignore */
    }
  };
  const toggleId = (kind: 'saved' | 'hidden', id: string) => {
    const cur = kind === 'saved' ? saved : hidden;
    const next = new Set(cur);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    (kind === 'saved' ? setSaved : setHidden)(next);
    saveIdSet(kind, next);
  };

  const list = useMemo(() => {
    const out: Scored[] = [];
    const grace = prefs.joinGraceMin;
    const hiddenSet = showHidden ? EMPTY : hidden;
    for (const m of ds.meetings) {
      if (!passesFilters(m, prefs, hiddenSet)) continue;
      const key = `${m.id}|${m.day}|${m.time}|${m.tz}|${grace}`;
      let start = startCache.current.get(key);
      if (!start || minutesBetween(now, start) < -grace) {
        start = nextStart(m.day, m.time, m.tz, now, grace).start;
        startCache.current.set(key, start);
      }
      out.push({ ...m, start, delta: minutesBetween(now, start), sc: score(m, prefs, saved) });
    }
    out.sort((a, b) => a.delta - b.delta || b.sc - a.sc || a.name.localeCompare(b.name));
    return out;
  }, [ds, prefs, hidden, saved, now, showHidden]);

  const live = list.filter((x) => x.delta <= 0);
  const future = list.filter((x) => x.delta > 0);
  const next = future.slice(0, shown);
  const np = zonedParts(now, tz);
  const hasWomens = useMemo(() => ds.meetings.some((m) => m.types.includes('W')), [ds]);
  const tzOptions = useMemo(() => {
    try {
      return Intl.supportedValuesOf('timeZone');
    } catch {
      return [tz];
    }
  }, [tz]);

  const fellowshipChips = (extraClass = '') =>
    ds.fellowships.map((f) => (
      <button
        type="button"
        class={`f-${f.code} ${extraClass}${prefs.fellowships.includes(f.code) ? ' on' : ''}`}
        data-c="1"
        title={f.name}
        onClick={() => toggleFellowship(f.code)}
      >
        {f.code}
      </button>
    ));

  return (
    <div class="layout">
      <div class="side">
        <h1>
          <a href="/">double winners</a>
          <small>next meeting</small>
        </h1>
        <div class="clock">
          {DAYS[np.dow]}, {fmtHM(np.h, np.mi)} in {tzLabel(tz)}{' '}
          <button type="button" onClick={() => setPickTz(!pickTz)} aria-expanded={pickTz}>
            {pickTz ? 'done' : 'change'}
          </button>
          {pickTz && (
            <label class="tzpick">
              <select value={tz} onChange={(e) => changeTz((e.currentTarget as HTMLSelectElement).value)}>
                {tzOptions.map((z) => (
                  <option value={z}>{z}</option>
                ))}
              </select>
            </label>
          )}
        </div>
        <div class="filters">
          <button type="button" class={prefs.fellowships.length ? '' : 'on'} onClick={() => toggleFellowship(null)}>
            all
          </button>
          {fellowshipChips()}
          <div class="group">rise to the top</div>
          {TUNABLE_TYPES.map((code) => {
            const v = prefs.types[code] ?? 0;
            return (
              <button
                type="button"
                class={`util${v === 1 ? ' on' : ''}${v === -1 ? ' mute' : ''}`}
                title={v === 0 ? 'click to boost' : v === 1 ? 'click to mute' : 'click to reset'}
                onClick={() => cycleType(code)}
              >
                {TYPE_LABELS[code]}
              </button>
            );
          })}
          <div class="group">only</div>
          <button type="button" class={`util${prefs.menOnly ? ' on' : ''}`} onClick={() => setPrefs({ ...prefs, menOnly: !prefs.menOnly, womenOnly: false })}>
            men's meetings
          </button>
          {hasWomens && (
            <button type="button" class={`util${prefs.womenOnly ? ' on' : ''}`} onClick={() => setPrefs({ ...prefs, womenOnly: !prefs.womenOnly, menOnly: false })}>
              women's meetings
            </button>
          )}
          <button type="button" class={`util${prefs.videoOnly ? ' on' : ''}`} onClick={() => setPrefs({ ...prefs, videoOnly: !prefs.videoOnly })}>
            1-click video
          </button>
        </div>
        <div class="foot">
          For people in more than one program. Times are shown in your zone; each meeting keeps its own. Meetings more than ten minutes
          underway wait for next week; the point is to arrive near the beginning. Cards marked <i>details</i> open the fellowship's own page
          holding the link. A <i>~</i> means the time hasn't been re-verified since import. Nothing you do here is recorded anywhere but this
          browser. <a href="/about">About &amp; sources</a>.
        </div>
      </div>
      <div class="main">
        {!hasPrefs && (
          <div class="hello">
            Which fellowships are you in? Pick any; the rest stay a click away.
            <div class="chips">{fellowshipChips()}</div>
          </div>
        )}
        {live.length > 0 && (
          <>
            <div class="sect">
              <b>just started</b> — you’ve missed almost nothing
            </div>
            <div class="grid">
              {live.map((x) => (
                <Card key={x.id} m={x} now={now} tz={tz} saved={saved.has(x.id)} onSave={(id) => toggleId('saved', id)} onHide={(id) => toggleId('hidden', id)} />
              ))}
            </div>
          </>
        )}
        <div class="sect">
          <b>up next</b> — arrive at the top of the hour like a gentleman
        </div>
        {next.length ? (
          <div class="grid">
            {next.map((x, i) => (
              <Card key={x.id} m={x} now={now} tz={tz} feat={i === 0} saved={saved.has(x.id)} onSave={(id) => toggleId('saved', id)} onHide={(id) => toggleId('hidden', id)} />
            ))}
          </div>
        ) : (
          <div class="empty">nothing matches these filters. loosen your grip.</div>
        )}
        {future.length > shown && (
          <button type="button" class="more" onClick={() => setShown(shown + prefs.pageSize)}>
            show more
          </button>
        )}
        {hidden.size > 0 && (
          <div class="hiddenline">
            {hidden.size} hidden —{' '}
            <button type="button" onClick={() => setShowHidden(!showHidden)}>
              {showHidden ? 'hide them again' : 'show'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
