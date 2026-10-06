# Runbook — optimisation egress Supabase (free tier)

Ordre de déploiement des migrations manuelles. Le schéma n'est pas versionné :
tout SQL se colle dans le **SQL Editor** du dashboard Supabase (source de
vérité = base de production).

## Déjà déployé sur `main` (aucune action requise)

Optimisations front + Edge Functions actives sans changement de schéma :

- Fenêtre de silence Realtime 30s + coalescence des écritures locales.
- Suppression des invalidations globales redondantes (transactions, règles,
  banque, sync, onboarding) → chaque action ne recharge que ce qu'elle touche.
- `bootstrapFull` (une seule lecture de la table au démarrage).
- Rapports sans `assignments`.
- Cache mémoire TTL 3s de `loadBudgetData` dans l'Edge Function `/api`.
- `sync_logs` borné à 50 lignes en lecture ; sync 2×/jour + dedup fenêtrée.
- Préchargement M-1 seulement.

Effet : egress par action cassé net (session type : plusieurs centaines de Mo
→ un refetch de réconciliation). Free tier tenable dès cet état.

## Applicable maintenant (optionnel, recommandé, sans risque)

Ces deux scripts n'ont pas de dépendance de code (le code correspondant est
déjà sur `main`). Ils bornent la taille DB et réduisent les invocations.

1. **`F-purge-sync-logs.sql`** — job pg_cron qui purge les `sync_logs` > 90 j.
   Prérequis : extension `pg_cron` activée (Database > Extensions).
2. **`G-cron-2x.sql`** — repasse la sync de 3×/j à 2×/j. **Remplace
   `<PROJECT_REF>` et `<SYNC_CRON_SECRET>` avant d'exécuter** ; ne committe pas
   le secret. Attention au décalage heure d'été/hiver (documenté dans le fichier).

## Refs structurelles — CODE sur branches, déploiement SÉQUENCÉ

D, H, I, J réduisent la « jambe lecture DB » (payloads chiffrés relus). Leur
**code vit sur des branches séparées** (`worktree-agent-*`) et n'est PAS sur
`main`. Elles réécrivent le même chemin de lecture/écriture des transactions de
façons qui se chevauchent : les déployer toutes demande une **intégration
séquencée** (une à la fois, ré-adaptée sur le `main` courant), pas un merge
simultané. Le SQL de chacune est ci-joint (versions corrigées après revue).

Règle commune : chaque ref est conçue avec un **fallback** (le code tolère les
lignes/tables non encore migrées), donc l'ordre sûr est toujours :

> 1. appliquer le SQL (colonnes/tables nullable) → 2. déployer le code de la ref
> → 3. lancer le backfill → 4. vérifier (compteur à 0) → 5. (option) bascule finale.

| Ref | SQL | Backfill (action `/api`) | Gain |
|-----|-----|--------------------------|------|
| **J** `account_idx` | `J-account-idx.sql` (colonne `text` + index partiel) | `backfillAccountIdx` | reconcile/soldes ciblés |
| **D** base64 transport | `D-transport-base64.sql` (computed columns `enc_b64` sans `\n` + RPC `enc_insert`/`enc_update`) | aucun (transport pur) — **appliquer le SQL AVANT de déployer le code** | -35 à -45 % jambe lecture |
| **H** split core/text | `H-split-payload.sql` (colonnes `enc_core`/`enc_text` + contrainte) | `migrateSplitPayload` (par lots) | budget/rapports ne lisent plus le texte lourd |
| **M** réglages utilisateur | `M-user-settings.sql` (table `user_settings` chiffrée + computed column `enc_b64`) | aucun — le code tolère l'absence ; la fonction « Nouveau budget » (Réglages) renvoie une erreur explicite tant que le SQL n'est pas appliqué | active « Nouveau budget » (mois de départ gelé) |
| **N** mémoire de tiers | `N-payee-memory.sql` (table `payee_memory` chiffrée + index aveugle `payee_idx` + computed column `enc_b64`) | aucun — le code tolère l'absence (mémoire vide, apprentissage ignoré) ; `setPayeeCategory` renvoie une erreur explicite tant que le SQL n'est pas appliqué | imports bancaires déjà catégorisés (tiers appris, repli des règles) |
| **O** notifications push | `O-push-state.sql` (table `push_state` chiffrée, 1 ligne / user + computed column `enc_b64`) | aucun — le code tolère l'absence (aucune notification) ; Réglages > Notifications affiche « indisponible » tant que le SQL n'est pas appliqué. Clés VAPID dérivées de `ENCRYPTION_KEY` : aucun secret à ajouter (`VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`/`VAPID_SUBJECT` optionnels) | notifications iPhone (PWA écran d'accueil, iOS 16.4+) après chaque synchro planifiée |
| **I** agrégats | `I-aggregates.sql` (4 tables chiffrées + index aveugles + `rev` anti-course + computed columns `enc_b64`) | AUCUN (bootstrapFull reconstruit automatiquement à l'ouverture de l'app) | `bootstrap`/`getBudgetMonth` ne rescannent plus l'historique |

Notes par ref :

- **D** : le code n'est PAS déployable sans le SQL (les lectures/écritures
  passent par les computed columns et RPC). Appliquer le SQL d'abord.
- **H** : la contrainte `check (enc_core is not null or enc_payload is not null)`
  laisse les lignes legacy valides ; le code lit `enc_payload` en fallback tant
  que `enc_core` est NULL. Bascule finale (drop `enc_payload`) seulement quand le
  compteur legacy est à 0 et qu'aucun code lisant `enc_payload` n'est déployé.
- **I** : le marqueur `aggregate_state` est le kill-switch — tant qu'il est
  absent ou non-prêt, les lectures retombent sur le calcul complet. La colonne
  `rev` sert de fence CAS : toute écriture concurrente empoisonne un recompute
  en cours (jamais d'état faux marqué prêt). Filets anti-dérive intégrés :
  recompute complet après chaque import sync-bank / reconcile, et
  reconstruction automatique par bootstrapFull à l'ouverture de l'app.
  DÉPLOIEMENT : SQL d'abord, puis code ; aucun backfill manuel.
- **J** : `account_idx` est `text` (cohérent avec `month_idx`/`tx_hash`). Le
  code retombe sur le chargement complet tant qu'il reste des lignes NULL.

## Edge Functions en attente de déploiement (transferts croisés)

Le code serveur des transferts croisés (règle YNAB budget ↔ suivi), des comptes
archivables, des objectifs « recharger » et de l'import des virements est prêt
mais ne part qu'au prochain déploiement des Edge Functions (jeton CI à renouveler).

- **Aucun SQL** à appliquer.
- `AGG_VERSION` passe à 3 : le marqueur `aggregate_state` existant est traité
  comme non prêt, les lectures retombent sur le calcul complet, puis
  `bootstrapFull` reconstruit les agrégats en arrière-plan à la première
  ouverture de l'app. Rien à lancer à la main (`recomputeAggregates` reste
  disponible en secours).
- Écritures sur une moitié croisée et bascules budget/suivi : agrégats invalidés
  puis reconstruits en arrière-plan environ 5 s après la dernière écriture
  (une relecture de l'historique par rafale d'actions, pas une par lecture).
- Le front s'adapte seul : `bootstrap` annonce `features` et les interfaces
  correspondantes s'allument sans redéploiement de Pages.
- Effet attendu après déploiement : le badge « À catégoriser » peut augmenter du
  nombre de virements budget → suivi (ou suivi → budget) jamais catégorisés.
  C'est la règle YNAB : catégoriser leur moitié côté budget (ex. « Investissement »
  pour un versement sur le PEA, une catégorie de revenus pour un retrait).
- Vérification : la réponse de `bootstrap` contient `features` avec
  `crossBudgetTransfers`, `accountFlags`, `refillTargets`, `importTransfers`.
