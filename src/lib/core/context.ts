import type { StreamInfo } from "./sources/twitch-info.js";

const NON_GAME = new Set(["Just Chatting", "IRL", "Talk Shows & Podcasts", "Music", "Art", "Special Events", "Sports", "ASMR", "Food & Drink", "Travel & Outdoors", "Science & Technology", "Politics"]);

/**
 * Compose le contexte envoyé à Jev à partir des métadonnées du live et de
 * ce que le streamer a écrit dans ses règles. Le but : que « Mathy est louve ? »
 * soit lu comme une question de jeu, pas comme une question personnelle.
 */
export function buildContext(info: StreamInfo | null, userContext: string | undefined): string {
  const parts: string[] = [];
  const lang = info?.language?.toLowerCase();
  parts.push(lang === "fr" || !lang ? "Live Twitch francophone." : `Live Twitch (langue : ${info!.language}).`);

  if (info && !info.live) {
    parts.push("La chaîne est hors ligne : il n'y a pas de live en cours, les spectateurs discutent entre eux dans le chat.");
  } else if (info) {
    const title = info.title.replace(/![a-z0-9_]+/gi, "").replace(/\s*[-|•·]+\s*$/g, "").replace(/\s+/g, " ").trim(); // retire les !commandes et les séparateurs orphelins
    if (info.game) {
      if (info.game === "IRL" || info.game === "Travel & Outdoors") {
        parts.push(
          "Live en extérieur (IRL) : le streamer se filme dans la vraie vie, en déplacement ou sur place. Le lieu où il se trouve, ce qu'il fait et ce qu'il montre font partie du contenu du live, les spectateurs en parlent et posent des questions dessus normalement.",
        );
      } else if (NON_GAME.has(info.game)) {
        parts.push(`Type de live : ${info.game}, pas de jeu vidéo en cours. Le streamer discute avec son chat.`);
      } else {
        parts.push(`Le streamer joue à « ${info.game} ». Les termes du jeu, les rôles, les noms des autres joueurs et les mécaniques font partie du contexte normal du chat.`);
      }
    }
    if (title) parts.push(`Titre du live : « ${title} ».`);
    if (info.tags.length) parts.push(`Tags : ${info.tags.join(", ")}.`);
    if (info.viewers) parts.push(`Environ ${info.viewers} spectateurs.`);
  }

  if (userContext?.trim()) parts.push(userContext.trim());
  return parts.join(" ");
}
