import type { ChatMessage } from "../types.js";

/**
 * Lecture anonyme du chat Twitch via IRC sur WebSocket.
 * Aucune clé : Twitch accepte les pseudos « justinfan<nombre> » en lecture seule.
 * Zéro dépendance, le protocole tient en quelques lignes.
 */
export interface TwitchReaderOptions {
  channels: string[];
  onMessage: (msg: ChatMessage) => void;
  onStatus?: (text: string) => void;
}

export function readTwitchChat(opts: TwitchReaderOptions): () => void {
  let ws: WebSocket | null = null;
  let stopped = false;
  let retryMs = 1_000;

  const log = (t: string) => opts.onStatus?.(t);

  const connect = () => {
    ws = new WebSocket("wss://irc-ws.chat.twitch.tv:443");

    ws.addEventListener("open", () => {
      retryMs = 1_000;
      ws!.send("CAP REQ :twitch.tv/tags twitch.tv/commands");
      ws!.send(`NICK justinfan${Math.floor(Math.random() * 90_000) + 10_000}`);
      for (const c of opts.channels) ws!.send(`JOIN #${c.toLowerCase()}`);
      log(`connecté, canaux : ${opts.channels.join(", ")}`);
    });

    ws.addEventListener("message", (ev) => {
      for (const line of String(ev.data).split("\r\n")) {
        if (!line) continue;
        if (line.startsWith("PING")) {
          ws!.send("PONG :tmi.twitch.tv");
          continue;
        }
        const msg = parsePrivmsg(line);
        if (msg) opts.onMessage(msg);
      }
    });

    ws.addEventListener("close", () => {
      if (stopped) return;
      log(`déconnecté, nouvelle tentative dans ${retryMs} ms`);
      setTimeout(connect, retryMs);
      retryMs = Math.min(retryMs * 2, 30_000);
    });

    ws.addEventListener("error", () => ws?.close());
  };

  connect();
  return () => {
    stopped = true;
    ws?.close();
  };
}

/** @badge-info=...;id=...;user-id=... :nick!nick@nick.tmi.twitch.tv PRIVMSG #chan :texte */
export function parsePrivmsg(line: string): ChatMessage | null {
  if (!line.startsWith("@")) return null;
  const sp = line.indexOf(" ");
  const rawTags = line.slice(1, sp);
  const rest = line.slice(sp + 1);

  const m = /^:(\w+)!\S+ PRIVMSG #(\w+) :(.*)$/.exec(rest);
  if (!m) return null;
  const [, nick, channel, text] = m;

  const tags: Record<string, string> = {};
  for (const kv of rawTags.split(";")) {
    const eq = kv.indexOf("=");
    tags[kv.slice(0, eq)] = kv.slice(eq + 1).replace(/\\s/g, " ").replace(/\\\\/g, "\\");
  }

  return {
    id: tags["id"] ?? crypto.randomUUID(),
    channel,
    userId: tags["user-id"] ?? "",
    userName: tags["display-name"] || nick,
    text,
    sentAt: Number(tags["tmi-sent-ts"]) || Date.now(),
    isMod: tags["mod"] === "1" || (tags["badges"] ?? "").includes("broadcaster"),
    isSub: tags["subscriber"] === "1",
    emoteOnly: isEmoteOnly(text, tags["emotes"]),
  };
}

/** `emotes` vaut par ex. "25:0-4,6-10/1902:12-16" : des plages de caractères. Si elles couvrent tout le texte hors espaces, c'est une emote seule. */
function isEmoteOnly(text: string, emotes: string | undefined): boolean {
  if (!emotes) return false;
  const chars = [...text]; // les plages Twitch sont en points de code
  const covered = new Array(chars.length).fill(false);
  for (const part of emotes.split("/")) {
    const ranges = part.split(":")[1] ?? "";
    for (const r of ranges.split(",")) {
      const [a, b] = r.split("-").map(Number);
      for (let i = a; i <= b && i < covered.length; i++) covered[i] = true;
    }
  }
  return chars.every((c, i) => covered[i] || /\s/.test(c));
}
