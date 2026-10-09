import type { Handle } from "@sveltejs/kit/hooks";

const SID = "vigie_sid";

/**
 * Chaque navigateur reçoit un identifiant, même sans compte : il sert à retrouver
 * son observation après un rechargement et à appliquer les limites par personne.
 */
export const handle: Handle = async ({ event, resolve }) => {
  let sid = event.cookies.get(SID);
  if (!sid) {
    sid = crypto.randomUUID();
    event.cookies.set(SID, sid, { path: "/", httpOnly: true, sameSite: "lax", maxAge: 60 * 60 * 24 * 365 });
  }
  event.locals.sid = sid;
  return resolve(event);
};
