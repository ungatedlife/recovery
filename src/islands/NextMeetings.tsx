/**
 * The app. Server-rendered with the viewer's real prefs (from the session) so
 * there is no flash, hydrated once, re-sorted every 30 seconds. One island so
 * the sidebar and the list share state. Before a session exists, state lives in
 * localStorage and is migrated to the server on the first server-acknowledged write.
 */
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { Card, type Timed } from '~/components/Card.tsx';
import { readDataset } from '~/lib/current.ts';
import { browserTimeZone, loadIdSet, loadPrefs, saveIdSet, savePrefs } from '~/lib/prefs.ts';
import { passesFilters, score } from '~/lib/score.ts';
import { createScheduler, DAYS, fmtHM, isValidTimeZone, tzLabel, zonedParts } from '~/lib/time.ts';
import { DEFAULT_PREFS, TUNABLE_TYPES, TYPE_LABELS, type Dataset, type Prefs } from '~/lib/types.ts';

interface Props {
  initialTz: string;
  serverNow: number;
  mode?: 'all' | 'saved';
  hasSession: boolean;
  prefs: Prefs | null;
  saved: string[];
  hidden: string[];
}

interface Scored extends Timed {
  sc: number;
}

const EMPTY = new Set<string>();

async function api(path: string, body: unknown): Promise<boolean> {
  try {
    const r = await fetch(path, { method: 'PUT', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    return r.ok;
  } catch {
    return false;
  }
}

function clearLocal() {
  try {
    localStorage.removeItem('dw.prefs.v1');
    localStorage.removeItem('dw.saved.v1');
    localStorage.removeItem('dw.hidden.v1');
  } catch {
    /* ignore */
  }
}

export default function NextMeetings(props: Props) {
  const { initialTz, serverNow, mode = 'all' } = props;
  const [ds, setDs] = useState<Dataset>(readDataset);
  const [now, setNow] = useState(() => new Date(serverNow));
  const [prefs, setPrefsState] = useState<Prefs>(props.prefs ?? DEFAULT_PREFS);
  const [hasPrefs, setHasPrefs] = useState(props.prefs !== null);
  const [saved, setSaved] = useState<Set<string>>(() => new Set(props.saved));
  const [hidden, setHidden] = useState<Set<string>>(() => new Set(props.hidden));
  const [showHidden, setShowHidden] = useState(false);
  const [shown, setShown] = useState((props.prefs ?? DEFAULT_PREFS).pageSize);
  const [tz, setTz] = useState(props.prefs?.timezone && isValidTimeZone(props.prefs.timezone) ? props.prefs.timezone : initialTz);
  const [pickTz, setPickTz] = useState(false);
  const dsRef = useRef(ds);
  dsRef.current = ds;
  const synced = useRef(props.hasSession);
  const putTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get('deleted') === '1') {
      clearLocal();
      history.replaceState(null, '', location.pathname);
    }
    if (!props.hasSession) {
      const local = loadPrefs();
      const ls = loadIdSet('saved');
      const lh = loadIdSet('hidden');
      if (local || ls.size || lh.size) {
        const p = local ?? DEFAULT_PREFS;
        setPrefsState(p);
        setHasPrefs(Boolean(local));
        setSaved(ls);
        setHidden(lh);
        if (p.timezone && isValidTimeZone(p.timezone)) setTz(p.timezone);
        (async () => {
          let ok = await api('/api/prefs', p);
          for (const id of ls) ok = (await api('/api/saved', { id, kind: 'saved', on: true })) && ok;
          for (const id of lh) ok = (await api('/api/saved', { id, kind: 'hidden', on: true })) && ok;
          if (ok) {
            synced.current = true;
            clearLocal();
          }
        })();
      }
    }
    if (!props.prefs?.timezone) {
      const b = browserTimeZone();
      if (b) setTz(b);
    }
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
    if (!synced.current) savePrefs(next);
    if (putTimer.current) clearTimeout(putTimer.current);
    putTimer.current = setTimeout(async () => {
      const ok = await api('/api/prefs', next);
      if (ok) {
        if (!synced.current) clearLocal();
        synced.current = true;
      } else savePrefs(next);
    }, 400);
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
    const on = !next.has(id);
    if (on) next.add(id);
    else next.delete(id);
    (kind === 'saved' ? setSaved : setHidden)(next);
    if (!synced.current) saveIdSet(kind, next);
    api('/api/saved', { id, kind, on }).then((ok) => {
      if (ok) {
        if (!synced.current) clearLocal();
        synced.current = true;
      } else saveIdSet(kind, next);
    });
  };

  const list = useMemo(() => {
    const out: Scored[] = [];
    const sched = createScheduler(now, prefs.joinGraceMin);
    const hiddenSet = showHidden ? EMPTY : hidden;
    for (const m of ds.meetings) {
      if (mode === 'saved' && !saved.has(m.id)) continue;
      if (!passesFilters(m, prefs, hiddenSet)) continue;
      const { start, delta } = sched.next(m.day, m.time, m.tz);
      out.push({ ...m, start, delta, sc: score(m, prefs, saved) });
    }
    out.sort((a, b) => a.delta - b.delta || b.sc - a.sc || a.name.localeCompare(b.name));
    return out;
  }, [ds, prefs, hidden, saved, now, showHidden, mode]);

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

  const fellowshipChips = () =>
    ds.fellowships.map((f) => (
      <button type="button" class={`f-${f.code}${prefs.fellowships.includes(f.code) ? ' on' : ''}`} data-c="1" title={f.name} onClick={() => toggleFellowship(f.code)}>
        {f.code}
      </button>
    ));

  const cardProps = (x: Scored, feat = false) => ({ m: x, now, tz, feat, saved: saved.has(x.id), onSave: (id: string) => toggleId('saved', id), onHide: (id: string) => toggleId('hidden', id) });

  return (
    <div class="layout">
      <div class="side">
        <h1>
          <a href="/">double winners</a>
          <small>{mode === 'saved' ? 'saved meetings' : 'next meeting'}</small>
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
        <nav class="navline">
          {mode === 'saved' ? <a href="/">all meetings</a> : <a href="/saved">saved{saved.size ? ` (${saved.size})` : ''}</a>}
          {' · '}
          <a href="/account">account</a>
          {' · '}
          <a href="/about">about</a>
        </nav>
        <div class="filters">
          <button type="button" class={prefs.fellowships.length ? '' : 'on'} onClick={() => toggleFellowship(null)}>
            all
          </button>
          {fellowshipChips()}
          <div class="group">rise to the top</div>
          {TUNABLE_TYPES.map((code) => {
            const v = prefs.types[code] ?? 0;
            return (
              <button type="button" class={`util${v === 1 ? ' on' : ''}${v === -1 ? ' mute' : ''}`} title={v === 0 ? 'click to boost' : v === 1 ? 'click to mute' : 'click to reset'} onClick={() => cycleType(code)}>
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
          holding the link. A <i>~</i> means the time hasn't been re-verified since import. Your choices are kept under an anonymous id
          with no name, email or address attached. <a href="/about">About &amp; sources</a>.
        </div>
      </div>
      <div class="main">
        {mode === 'all' && !hasPrefs && (
          <div class="hello">
            Which fellowships are you in? Pick any; the rest stay a click away.
            <div class="chips">{fellowshipChips()}</div>
          </div>
        )}
        {mode === 'saved' && list.length === 0 && (
          <div class="empty">nothing saved yet. tap ☆ on any card and it will wait for you here.</div>
        )}
        {live.length > 0 && (
          <>
            <div class="sect">
              <b>just started</b> — you’ve missed almost nothing
            </div>
            <div class="grid">
              {live.map((x) => (
                <Card key={x.id} {...cardProps(x)} />
              ))}
            </div>
          </>
        )}
        {(mode === 'all' || list.length > 0) && (
          <div class="sect">
            <b>up next</b> — arrive at the top of the hour like a gentleman
          </div>
        )}
        {next.length ? (
          <div class="grid">
            {next.map((x, i) => (
              <Card key={x.id} {...cardProps(x, i === 0)} />
            ))}
          </div>
        ) : mode === 'all' ? (
          <div class="empty">nothing matches these filters. loosen your grip.</div>
        ) : null}
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
