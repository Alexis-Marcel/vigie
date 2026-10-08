/**
 * Métadonnées du live : titre, catégorie, langue, spectateurs.
 * Deux chemins :
 *  - Helix (API officielle) si TWITCH_CLIENT_ID et TWITCH_CLIENT_SECRET sont définis ;
 *  - sinon l'endpoint GraphQL public du site Twitch, sans clé. Non officiel, suffisant
 *    pour le prototype, à abandonner quand le streamer sera connecté en OAuth.
 */
export interface StreamInfo {
  channel: string;
  live: boolean;
  title: string;
  game: string; // catégorie Twitch : jeu, "Just Chatting", "IRL", etc.
  language: string;
  viewers: number;
  tags: string[];
  fetchedAt: number;
}

export async function fetchStreamInfo(channel: string): Promise<StreamInfo> {
  const login = channel.toLowerCase();
  if (process.env.TWITCH_CLIENT_ID && process.env.TWITCH_CLIENT_SECRET) return viaHelix(login);
  return viaGql(login);
}

let appToken: { value: string; expiresAt: number } | null = null;

/** Jeton d'application Twitch (client credentials), renouvelé au besoin. Null sans identifiants d'application. */
export async function appHeaders(): Promise<Record<string, string> | null> {
  const clientId = process.env.TWITCH_CLIENT_ID;
  const secret = process.env.TWITCH_CLIENT_SECRET;
  if (!clientId || !secret) return null;
  if (!appToken || appToken.expiresAt < Date.now() + 60_000) {
    const res = await fetch("https://id.twitch.tv/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: clientId, client_secret: secret, grant_type: "client_credentials" }),
    });
    if (!res.ok) throw new Error(`Twitch token HTTP ${res.status}`);
    const j = (await res.json()) as { access_token: string; expires_in: number };
    appToken = { value: j.access_token, expiresAt: Date.now() + j.expires_in * 1000 };
  }
  return { "Client-Id": clientId, Authorization: `Bearer ${appToken.value}` };
}

export interface ChannelHit {
  login: string;
  displayName: string;
  avatar: string;
  isLive: boolean;
  game: string;
  title: string;
}

/** Recherche de chaînes par nom, en live d'abord. Vide sans identifiants d'application. */
export async function searchChannels(query: string): Promise<ChannelHit[]> {
  const headers = await appHeaders();
  const q = query.trim();
  if (!headers || q.length < 2) return [];
  const res = await fetch(`https://api.twitch.tv/helix/search/channels?first=8&query=${encodeURIComponent(q)}`, { headers });
  if (!res.ok) throw new Error(`Helix search HTTP ${res.status}`);
  const data = ((await res.json()) as { data: Record<string, unknown>[] }).data;
  return data
    .map((c) => ({
      login: c.broadcaster_login as string,
      displayName: c.display_name as string,
      avatar: c.thumbnail_url as string,
      isLive: c.is_live as boolean,
      game: (c.game_name as string) ?? "",
      title: (c.title as string) ?? "",
    }))
    .sort((a, b) => {
      // En live d'abord, puis le nom exact, puis ceux qui commencent par la saisie ; sinon l'ordre de Twitch.
      const ql = q.toLowerCase();
      const rank = (c: ChannelHit) => (c.login === ql ? 0 : c.login.startsWith(ql) ? 1 : 2);
      return Number(b.isLive) - Number(a.isLive) || rank(a) - rank(b);
    });
}

async function viaHelix(login: string): Promise<StreamInfo> {
  const headers = (await appHeaders())!;

  const streams = await fetch(`https://api.twitch.tv/helix/streams?user_login=${login}`, { headers });
  if (!streams.ok) throw new Error(`Helix streams HTTP ${streams.status}`);
  const s = ((await streams.json()) as { data: Record<string, unknown>[] }).data[0];
  if (s) {
    return {
      channel: login,
      live: true,
      title: s.title as string,
      game: s.game_name as string,
      language: s.language as string,
      viewers: s.viewer_count as number,
      tags: (s.tags as string[]) ?? [],
      fetchedAt: Date.now(),
    };
  }
  // Hors ligne : on prend les réglages de la chaîne
  const users = await fetch(`https://api.twitch.tv/helix/users?login=${login}`, { headers });
  const u = ((await users.json()) as { data: { id: string }[] }).data[0];
  if (!u) throw new Error(`Chaîne inconnue : ${login}`);
  const ch = await fetch(`https://api.twitch.tv/helix/channels?broadcaster_id=${u.id}`, { headers });
  const c = ((await ch.json()) as { data: Record<string, unknown>[] }).data[0];
  return {
    channel: login,
    live: false,
    title: (c?.title as string) ?? "",
    game: (c?.game_name as string) ?? "",
    language: (c?.broadcaster_language as string) ?? "",
    viewers: 0,
    tags: (c?.tags as string[]) ?? [],
    fetchedAt: Date.now(),
  };
}

async function viaGql(login: string): Promise<StreamInfo> {
  const res = await fetch("https://gql.twitch.tv/gql", {
    method: "POST",
    headers: { "Client-Id": "kimne78kx3ncx6brgo4mv6wki5h1ko", "Content-Type": "application/json" },
    body: JSON.stringify({
      query: `query($login:String!){ user(login:$login){
        broadcastSettings{ title language game{ displayName } }
        stream{ title viewersCount language game{ displayName } tags{ localizedName } }
      } }`,
      variables: { login },
    }),
  });
  if (!res.ok) throw new Error(`Twitch GQL HTTP ${res.status}`);
  const j = (await res.json()) as {
    data: {
      user: null | {
        broadcastSettings: { title: string; language: string; game: { displayName: string } | null };
        stream: null | {
          title: string;
          viewersCount: number;
          language: string;
          game: { displayName: string } | null;
          tags: { localizedName: string }[];
        };
      };
    };
  };
  const u = j.data.user;
  if (!u) throw new Error(`Chaîne inconnue : ${login}`);
  const s = u.stream;
  return {
    channel: login,
    live: s !== null,
    title: s?.title ?? u.broadcastSettings.title,
    game: s?.game?.displayName ?? u.broadcastSettings.game?.displayName ?? "",
    language: u.broadcastSettings.language || s?.language || "",
    viewers: s?.viewersCount ?? 0,
    tags: s?.tags.map((t) => t.localizedName) ?? [],
    fetchedAt: Date.now(),
  };
}
