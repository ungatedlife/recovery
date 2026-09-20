import type { APIRoute } from 'astro';
import { getDb } from '~/lib/db.ts';
import { handle, HttpError, json, readJson, requireSameOrigin } from '~/lib/guard.ts';
import { createAnonUser, setSavedMeeting, setSessionCookie } from '~/lib/session.ts';

const ID = /^[0-9a-z]{20}$/;

/** PUT /api/saved  { id, kind: 'saved'|'hidden', on: boolean } */
export const PUT: APIRoute = ({ request, locals, cookies }) =>
  handle(async () => {
    const refused = requireSameOrigin(request);
    if (refused) return refused;
    const body = (await readJson(request)) as { id?: unknown; kind?: unknown; on?: unknown };
    const id = typeof body.id === 'string' && ID.test(body.id) ? body.id : null;
    const kind = body.kind === 'saved' || body.kind === 'hidden' ? body.kind : null;
    if (!id || !kind || typeof body.on !== 'boolean') throw new HttpError(400, 'bad request');
    const db = getDb();
    let userId = locals.viewer?.user.id;
    let created = false;
    if (!userId) {
      const { user, token } = await createAnonUser(db);
      setSessionCookie(cookies, token);
      userId = user.id;
      created = true;
    }
    try {
      await setSavedMeeting(db, userId, id, kind, body.on);
    } catch (e) {
      if (String(e).includes('FOREIGN KEY')) throw new HttpError(404, 'unknown meeting');
      throw e;
    }
    return json({ ok: true, created });
  });
