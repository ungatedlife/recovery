import type { APIRoute } from 'astro';
import { getDb } from '~/lib/db.ts';
import { handle, json, readJson, requireSameOrigin } from '~/lib/guard.ts';
import { sanitizePrefs } from '~/lib/prefs.ts';
import { createAnonUser, savePrefs, setSessionCookie } from '~/lib/session.ts';

/**
 * PUT /api/prefs  {…Prefs}
 * The first call from a browser with no session lazily creates an anonymous
 * user and sets the cookie. That tap on a fellowship chip is the whole signup.
 */
export const PUT: APIRoute = ({ request, locals, cookies }) =>
  handle(async () => {
    const refused = requireSameOrigin(request);
    if (refused) return refused;
    const prefs = sanitizePrefs(await readJson(request));
    const db = getDb();
    let userId = locals.viewer?.user.id;
    let created = false;
    if (!userId) {
      const { user, token } = await createAnonUser(db);
      setSessionCookie(cookies, token);
      userId = user.id;
      created = true;
    }
    await savePrefs(db, userId, prefs);
    return json({ ok: true, created, prefs });
  });
