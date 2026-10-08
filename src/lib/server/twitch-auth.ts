import type { Account, Store } from "#lib/core/store.ts";

/** Droits demandés : lire le chat (pour EventSub plus tard), supprimer des messages, timeout/ban, avertir. */
export const SCOPES = ["user:read:chat", "moderator:manage:chat_messages", "moderator:manage:banned_users", "moderator:manage:warnings"];

const creds = () => {
  const id = process.env.TWITCH_CLIENT_ID;
  const secret = process.env.TWITCH_CLIENT_SECRET;
  if (!id || !secret) throw new Error("TWITCH_CLIENT_ID et TWITCH_CLIENT_SECRET manquent dans .env");
  return { id, secret };
};

export function authorizeUrl(redirectUri: string, state: string): string {
  const p = new URLSearchParams({
    client_id: creds().id,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: SCOPES.join(" "),
    state,
    force_verify: "false",
  });
  return `https://id.twitch.tv/oauth2/authorize?${p}`;
}

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  scope: string[];
}

async function tokenRequest(body: Record<string, string>): Promise<TokenResponse> {
  const { id, secret } = creds();
  const res = await fetch("https://id.twitch.tv/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: id, client_secret: secret, ...body }),
  });
  if (!res.ok) throw new Error(`Twitch OAuth ${res.status} : ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as TokenResponse;
}

/** Échange le code reçu au callback contre des jetons, récupère le profil, enregistre le compte. */
export async function completeLogin(store: Store, code: string, redirectUri: string): Promise<Account> {
  const t = await tokenRequest({ code, grant_type: "authorization_code", redirect_uri: redirectUri });
  const res = await fetch("https://api.twitch.tv/helix/users", {
    headers: { "Client-Id": creds().id, Authorization: `Bearer ${t.access_token}` },
  });
  if (!res.ok) throw new Error(`Helix users ${res.status}`);
  const u = ((await res.json()) as { data: { id: string; login: string; display_name: string; profile_image_url: string }[] }).data[0];
  const account: Account = {
    userId: u.id,
    login: u.login,
    displayName: u.display_name,
    avatar: u.profile_image_url,
    accessToken: t.access_token,
    refreshToken: t.refresh_token,
    expiresAt: Date.now() + t.expires_in * 1000,
    scopes: t.scope,
  };
  store.saveAccount(account);
  return account;
}

/** Jeton valide pour ce compte, rafraîchi si nécessaire (et réécrit en base). */
export async function freshToken(store: Store, account: Account): Promise<Account> {
  if (account.expiresAt > Date.now() + 60_000) return account;
  const t = await tokenRequest({ grant_type: "refresh_token", refresh_token: account.refreshToken });
  const next = { ...account, accessToken: t.access_token, refreshToken: t.refresh_token, expiresAt: Date.now() + t.expires_in * 1000 };
  store.saveAccount(next);
  return next;
}

export async function revoke(account: Account): Promise<void> {
  await fetch("https://id.twitch.tv/oauth2/revoke", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: creds().id, token: account.accessToken }),
  }).catch(() => {});
}

export function clientId(): string {
  return creds().id;
}
