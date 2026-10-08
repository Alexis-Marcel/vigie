import type { Account, Store } from "#lib/core/store.ts";
import { freshToken, clientId } from "./twitch-auth.ts";

export type ActionKind = "delete" | "timeout" | "warn";

const userIds = new Map<string, string>();

async function helix(store: Store, account: Account, path: string, init: RequestInit = {}): Promise<Response> {
  const a = await freshToken(store, account);
  return fetch(`https://api.twitch.tv/helix/${path}`, {
    ...init,
    headers: { "Client-Id": clientId(), Authorization: `Bearer ${a.accessToken}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
}

/** Identifiant numérique d'une chaîne à partir de son login, mis en cache. */
export async function broadcasterId(store: Store, account: Account, login: string): Promise<string> {
  const cached = userIds.get(login);
  if (cached) return cached;
  const res = await helix(store, account, `users?login=${encodeURIComponent(login)}`);
  if (!res.ok) throw new Error(`Helix users ${res.status}`);
  const u = ((await res.json()) as { data: { id: string }[] }).data[0];
  if (!u) throw new Error(`Chaîne inconnue : ${login}`);
  userIds.set(login, u.id);
  return u.id;
}

/** Traduit les refus de Twitch en phrases utiles. */
async function explain(res: Response): Promise<string> {
  const text = await res.text().catch(() => "");
  if (res.status === 403) return "Twitch refuse : ce compte n'est pas modérateur de la chaîne, ou le message vient du streamer ou d'un modérateur.";
  if (res.status === 401) return "Jeton Twitch invalide : reconnectez le compte.";
  if (res.status === 404) return "Message introuvable : déjà supprimé, ou trop ancien (plus de 6 h).";
  if (res.status === 429) return "Twitch limite le débit : réessayez dans un instant.";
  return `Twitch ${res.status} : ${text.slice(0, 160)}`;
}

export async function deleteMessage(store: Store, account: Account, channel: string, messageId: string): Promise<void> {
  const b = await broadcasterId(store, account, channel);
  const q = new URLSearchParams({ broadcaster_id: b, moderator_id: account.userId, message_id: messageId });
  const res = await helix(store, account, `moderation/chat?${q}`, { method: "DELETE" });
  if (!res.ok) throw new Error(await explain(res));
}

export async function timeoutUser(store: Store, account: Account, channel: string, userId: string, seconds: number, reason: string): Promise<void> {
  const b = await broadcasterId(store, account, channel);
  const q = new URLSearchParams({ broadcaster_id: b, moderator_id: account.userId });
  const res = await helix(store, account, `moderation/bans?${q}`, {
    method: "POST",
    body: JSON.stringify({ data: { user_id: userId, duration: seconds, reason: reason.slice(0, 500) } }),
  });
  if (!res.ok) throw new Error(await explain(res));
}

export async function warnUser(store: Store, account: Account, channel: string, userId: string, reason: string): Promise<void> {
  const b = await broadcasterId(store, account, channel);
  const q = new URLSearchParams({ broadcaster_id: b, moderator_id: account.userId });
  const res = await helix(store, account, `moderation/warnings?${q}`, {
    method: "POST",
    body: JSON.stringify({ data: { user_id: userId, reason: reason.slice(0, 500) } }),
  });
  if (!res.ok) throw new Error(await explain(res));
}
