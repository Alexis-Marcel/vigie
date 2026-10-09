# Vigie

Modérateur de chat Twitch open source. Le streamer écrit ses règles en français, et chaque
message du chat est jugé en temps réel contre ces règles par un modèle de décision. Vigie
observe, assiste les modérateurs, ou modère seule : c'est le streamer qui choisit jusqu'où
elle a le droit d'aller.

Une vigie observe et signale. Elle ne tranche pas seule : les cas douteux vont aux humains,
seuls les cas très sûrs sont traités automatiquement, et seulement si on le lui demande.

## Pourquoi

Les outils existants couvrent le spam, les liens et les insultes explicites. Aucun ne sait
juger « est-ce une question sur la vie privée du streamer ? », « est-ce du backseat ? » ou
« est-ce une dérive politique hors sujet ? » assez vite et assez peu cher pour des centaines de
messages par minute. Un modèle de décision répond à ces questions en 250 ms, pour une fraction
de centime par millier de messages, avec une probabilité que le code peut exploiter.

Mesuré sur une grosse chaîne francophone, une nuit entière :

| | |
|---|---|
| Messages lus | 17 932 en 15,7 h |
| Jugés par le modèle | 15 245 |
| Erreurs | 0 |
| Latence médiane / p95 | 247 ms / 366 ms |
| Coût | 0,63 $, soit environ 0,40 $ pour 10 000 messages jugés |

## Comment ça marche

```
chat Twitch ──▶ préfiltre (emotes, liens, copier-coller) ──▶ Jev : une question par règle, un seul appel
                                                                      │
                                           ┌──────────────────────────┼──────────────────────────┐
                                           ▼                          ▼                          ▼
                                     laisser passer        file « à vérifier » (humain)     supprimer (si Modérer)
```

- **Les règles sont des questions.** « Ce message cherche-t-il à obtenir une information
  personnelle que le streamer ne partage pas lui-même ? » Chaque règle a une action
  (supprimer, vérifier, noter) et un seuil de probabilité. Juste sous le seuil, une zone grise
  envoie le message aux humains.
- **Le contexte du live est envoyé avec chaque message** : catégorie, titre, langue, et une
  phrase libre du streamer. Un « tu es où ? » n'a pas le même sens sur un voyage IRL et sur
  un live de jeu. Les cinq messages précédents sont joints aussi.
- **Trois modes, un seul réglage.** Observer : n'importe quelle chaîne, sans compte, rien ne
  touche Twitch. Assister : sur ses propres chaînes, Vigie signale et l'humain agit depuis la
  file. Modérer : Vigie supprime seule au-dessus des seuils, l'humain traite la zone grise.
- **Chaque clic sert à mesurer.** Dans la file, « juste » ou « à tort » sont enregistrés pour
  calculer précision et rappel par règle et par seuil.

Le juge est une interface. L'implémentation fournie utilise [Jev](https://typesafe.ai) de
TypeSafe, un modèle de décision qui renvoie des probabilités calibrées sans générer de texte.
Un autre modèle se branche en implémentant `Judge`.

## Héberger Vigie

Il faut une clé TypeSafe (ou OpenRouter) et une application Twitch. Les deux se créent en
quelques minutes.

1. Sur [dev.twitch.tv/console/apps](https://dev.twitch.tv/console/apps), créez une application
   de type « confidentiel » avec comme URL de redirection `https://votre-domaine/auth/twitch/callback`
   (en local, `http://localhost:3000/auth/twitch/callback` est accepté).
2. Copiez `.env.example` en `.env` et remplissez `TYPESAFE_API_KEY`, `TWITCH_CLIENT_ID`,
   `TWITCH_CLIENT_SECRET`, et `ORIGIN` avec l'adresse publique du site.
3. Lancez :

```sh
docker compose up -d
```

L'image publique est `ghcr.io/alexis-marcel/vigie`, pour `linux/amd64` et `linux/arm64`. Les
données (base SQLite, règles par chaîne, comptes connectés) vivent dans le volume `/app/data`.
Mettez un reverse proxy HTTPS devant : Twitch exige HTTPS pour la redirection OAuth hors
localhost. `GET /api/health` renvoie l'état du service.

### Limites d'un service ouvert

Vigie peut être exposée à tous. Chaque navigateur a ses observations, les modérateurs d'une
même chaîne partagent la leur, et des bornes protègent la facture. Tout se règle par variable
d'environnement :

| Variable | Défaut | Rôle |
|---|---|---|
| `VIGIE_MAX_CONCURRENT` | 20 | observations simultanées sur le serveur |
| `VIGIE_ANON_HOURS` | 2 | durée maximale d'une observation sans compte, une à la fois par navigateur |
| `VIGIE_CONNECTED_HOURS` | 12 | durée maximale pour un modérateur connecté, arrêt 15 min après la fin du live |
| `VIGIE_DAILY_BUDGET_USD` | 3 | dépense Jev maximale par jour, toutes chaînes confondues |

Les messages bruts sont effacés après sept jours. Les verdicts et les annotations restent.

### Depuis les sources

```sh
pnpm install
cp .env.example .env
pnpm dev            # http://localhost:5173
pnpm build && pnpm start
```

Node 22.13 à 24 (SQLite est intégré à Node, aucune dépendance native). Node 25 fait échouer le build de SvelteKit pour l'instant.

## Règles

Chaque chaîne démarre avec le jeu de `rules.example.yaml`, pensé pour un stream quelconque :
insultes et discrimination, vie privée, autopromotion, comparaison avec d'autres créateurs,
drama et sujets clivants, backseat, spoilers. Tout se modifie depuis l'interface, règle par
règle : nom, question posée au modèle, action, seuil, ordre. Les changements s'appliquent à
l'observation en cours sans redémarrage.

Les formulations comptent. Deux versions d'une même question peuvent déplacer une probabilité
de vingt points ; l'outil de rejeu ci-dessous sert à comparer sur un enregistrement réel.

## Ligne de commande

Pour travailler hors interface, sur des enregistrements :

```
pnpm vigie watch <chaine> [--minutes N]    observe, juge et affiche en direct, sans rien supprimer
pnpm vigie observe <chaine> [--minutes N]  enregistre seulement
pnpm vigie replay <chaine> [--limit N]     rejoue un enregistrement contre les règles courantes
pnpm vigie annotate <chaine> [--sample N]  annotation au clavier
pnpm vigie stats <chaine>                  précision, rappel, faux positifs par règle et par seuil
pnpm vigie info <chaine>                   contexte du live tel que le modèle le reçoit
```

## Ce que Vigie ne fait pas

- Elle ne bannit pas. Les actions possibles sont la suppression d'un message et un timeout
  de dix minutes, au nom d'un modérateur connecté. Twitch ne laisse de toute façon pas un bot
  supprimer les messages du streamer ou d'un autre modérateur.
- Elle ne remplace pas l'équipe de modération. Elle lit tout, ce qu'aucun humain ne peut faire
  sur un gros chat, et remonte ce qui mérite un regard.
- Elle ne garde pas les conversations. Sept jours de messages bruts pour pouvoir rejouer et
  régler, puis effacement.

## Architecture

```
src/lib/core      pipeline sans framework : sources Twitch, préfiltre, juge, décision, SQLite
src/lib/server    observations, limites, OAuth Twitch, actions Helix
src/lib/ui        composants Svelte et état de la page
src/routes        pages et API (SvelteKit)
src/cli.ts        ligne de commande sur le même cœur
```

TypeScript partout, SvelteKit pour l'interface, SSE pour le temps réel, SQLite intégré à Node.
Zéro dépendance pour Twitch : IRC sur WebSocket en lecture, API Helix pour agir.

## Licence

MIT.
