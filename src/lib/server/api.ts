import { error } from "@sveltejs/kit";
import { hub, type Observation, type Viewer } from "./hub.ts";

/** Retrouve une observation par sa clé et vérifie que ce navigateur a le droit de la voir. */
export async function observationFor(key: string | null, viewer: Viewer): Promise<Observation> {
  if (!key) error(400, "Observation manquante");
  const o = hub.get(key);
  if (!o) error(404, "Cette observation n'existe plus. Relancez-la.");
  if (!(await hub.mayView(o, viewer))) error(403, "Cette observation ne vous est pas accessible.");
  return o;
}

/** Comme observationFor, mais exige en plus le droit d'agir (compte modérateur de la chaîne). */
export async function actingOn(key: string | null, viewer: Viewer): Promise<Observation> {
  const o = await observationFor(key, viewer);
  if (!viewer.account) error(401, "Connectez un compte Twitch modérateur");
  if (!(await o.canAct(viewer.account))) error(403, `${viewer.account.displayName} n'est pas modérateur de ${o.channel}.`);
  return o;
}

export function fail(e: unknown): never {
  const err = e as Error & { status?: number };
  error(err.status ?? 500, err.message);
}
