import type { APIRoute } from 'astro';
import { getDb } from '~/lib/db.ts';
import { handle, json, requireSameOrigin } from '~/lib/guard.ts';
import { clearSessionCookie, deleteUser } from '~/lib/session.ts';

/** POST /api/account/delete — removes the user row; cascades take the rest. Accepts a plain form post from /account. */
export const POST: APIRoute = ({ request, locals, cookies, redirect }) =>
  handle(async () => {
    const isForm = (request.headers.get('content-type') ?? '').startsWith('application/x-www-form-urlencoded');
    const refused = requireSameOrigin(request, { json: !isForm });
    if (refused) return refused;
    if (locals.viewer) await deleteUser(getDb(), locals.viewer.user.id);
    clearSessionCookie(cookies);
    if (isForm) return redirect('/?deleted=1', 303);
    return json({ ok: true });
  });
