# Vigie

Modérateur de chat Twitch open source. Le streamer écrit ses règles en français,
chaque message est jugé en temps réel contre ces règles par un modèle de décision.

Une vigie observe et signale. Elle ne tranche pas seule : les cas douteux vont
aux modérateurs humains, seuls les cas très sûrs sont traités automatiquement.

## Pourquoi

Les outils existants couvrent le spam et les insultes explicites. Aucun ne sait
juger « est-ce un spoiler ? » ou « est-ce du backseat ? » assez vite et assez peu
cher pour des centaines de messages par minute. Un modèle de décision (Jev, Laya)
répond en moins de 300 ms, pour une fraction de centime par millier de messages,
avec une confiance exploitable par le code.

## Comment ça marche

```
chat Twitch ──▶ préfiltre (spam, liens) ──▶ juge (1 question par règle, 1 appel)
                                                 │
                            ┌────────────────────┼───────────────────┐
                            ▼                    ▼                   ▼
                      laisser passer     file de vérification    supprimer
                                           (humain tranche)    (confiance ≥ seuil)
```

Le juge est une interface (`src/judges/judge.ts`). Trois implémentations prévues :

| Juge | Rôle | Pourquoi |
|------|------|----------|
| Jev (TypeSafe) | candidat principal, hébergé | ~0,04 $ / M tokens, 70 à 500 ms, 1 200 req/min |
| Laya (Apache 2.0) | candidat local | checkpoint multilingue, ~33 ms sur petit GPU, pas de dépendance |
| LLM (Claude Haiku) | référence pour le banc de test | précision maximale, trop cher et lent en production |

## Interface

```sh
pnpm dev          # http://localhost:5173
```

Trois modes, un seul réglage :

- **Observer** : n'importe quelle chaîne, sans compte. Vigie lit, juge et montre ce qu'elle ferait.
- **Assister** : sur ses propres chaînes, avec un compte Twitch modérateur. Vigie signale,
  l'humain supprime ou met en timeout depuis la file.
- **Modérer** : Vigie supprime seule au-dessus des seuils, l'humain traite la zone grise.

Une page, trois colonnes : le chat qui défile avec, à gauche de chaque message, une jauge colorée
par la probabilité la plus forte ; la file des signalements, filtrable par règle, avec les actions
et l'avis « juste / à tort » qui sert à mesurer Jev ; le bilan, le contexte envoyé à Jev et les
règles, éditables par chaîne et appliquées à chaud.

Le service peut être ouvert à tous : chaque navigateur a ses observations, les modérateurs d'une
même chaîne partagent la leur, et des limites bornent la dépense (durée, simultanéité, budget
Jev par jour, voir `.env.example`). Les messages bruts sont effacés après sept jours.

## Commandes en ligne

```
vigie watch <chaine> [--minutes N]    mode observateur en direct : enregistre, juge, affiche. Rien n'est supprimé.
vigie observe <chaine> [--minutes N]  enregistre seulement (pas d'appel à Jev)
vigie replay <chaine> [--limit N]     rejoue un enregistrement contre les règles courantes
vigie annotate <chaine> [--sample N]  annotation à la main, au clavier, pour mesurer
vigie stats <chaine>                  précision, rappel, faux positifs par règle et par seuil
vigie info <chaine>                   contexte du live tel que Jev le reçoit
```

Le contexte du live (titre, catégorie, langue, spectateurs) est relevé toutes les cinq
minutes et horodaté : le rejeu utilise celui qui était en vigueur à l'instant du message.

## État

- [x] Client Jev, une question par règle, un seul appel, nouvelles tentatives sur délai ou plafond
- [x] Lecture anonyme du chat Twitch, sans compte
- [x] Préfiltre : emotes, rires, liens, copier-coller, modérateurs
- [x] Contexte du live détecté automatiquement
- [x] Décision par seuil et par règle, zone grise vers vérification humaine
- [x] Rejeu, annotation, statistiques
- [x] Mode observateur en direct
- [x] Interface : chat en direct, file de vérification, bilan, contexte, règles
- [ ] Seuils et formulations réglés d'après les annotations
- [x] Édition des règles, des seuils et du contexte depuis l'interface, appliquée à chaud
- [x] Mode action : connexion Twitch, suppression, timeout, suppression automatique
- [x] Plusieurs observations en parallèle, règles par chaîne, limites pour un service ouvert

## Stack

TypeScript / Node 22+. Le cœur (`src/lib/core`) n'a pas de framework et sert aussi bien la
ligne de commande que l'interface. L'interface est en SvelteKit, le flux temps réel en SSE.
SQLite intégré à Node (`node:sqlite`), YAML pour les règles, zod pour les valider. Zéro dépendance pour Twitch : IRC sur WebSocket en lecture,
API officielle Helix si des identifiants d'application sont fournis, sinon l'endpoint
public du site. L'interface viendra après les mesures.

## Démarrer

```sh
pnpm install
cp .env.example .env            # clé TypeSafe ou OpenRouter
cp rules.example.yaml rules.yaml
pnpm vigie watch <chaine> --minutes 120
pnpm vigie annotate <chaine>
pnpm vigie stats <chaine>
```

## Garde-fous

- Le message est délimité strictement dans l'appel au juge ; tout message qui mentionne
  le bot part en vérification humaine (parade à l'injection d'instructions).
- Suppression automatique uniquement au-dessus d'un seuil de confiance élevé, par règle.
- Chaque règle est une question séparée : on sait toujours laquelle a déclenché.
- L'appel au modèle est isolé derrière une interface : changer de fournisseur ne touche
  pas le reste.
- Pseudos pseudonymisés dans les exports et les captures.
