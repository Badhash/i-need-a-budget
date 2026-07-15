# PLAN-MVP.md — Reste à faire (MVP)

> Document largement historique : le code du MVP est livré. Il ne reste que la
> configuration (secrets Supabase / GitHub) et l'activation d'Enable Banking. Le
> backlog vivant est dans `BACKLOG.md`.

## Définition du MVP

Une seule promesse : "Je vois mes transactions bancaires arriver automatiquement,
je les range dans des enveloppes, je sais combien il me reste à dépenser."

## État

Tout le code du MVP est livré : moteur d'enveloppes + tests, schéma chiffré + RLS,
crypto, Edge Function `/api`, signal Realtime, authentification email/password +
MFA TOTP, front branché sur données réelles (budget, transactions, comptes,
rapports), onboarding (catégories par défaut + solde d'ouverture), catégorisation
en 2 taps, règles de catégorisation automatique, objectifs par catégorie, et la
fonction `sync-bank` Enable Banking (écrite, à valider).

Reste, hors code :

1. Configuration des secrets et réglages Supabase / GitHub (voir `PLAN.md`).
2. Validation de l'app Enable Banking, puis test réel de `sync-bank` et activation
   du pg_cron. Tant que ce n'est pas fait, la saisie manuelle de transactions
   fonctionne déjà de bout en bout.

## Definition of Done du MVP

- Une transaction réelle apparaît dans l'app sans action manuelle (dépend de
  l'activation Enable Banking).
- Je la catégorise en 2 taps depuis mobile — OK.
- Le Disponible et le RTA sont justes (vérifiés contre les tests engine) — OK.
- Rien en clair dans les tables Supabase (vérification visuelle dashboard) — OK.
- L'app est utilisable et agréable sur mobile et desktop, light et dark — OK.

## Backlog post-MVP

Voir `BACKLOG.md` (priorisé, statut par item). Déjà livré depuis ce plan :
rapports enrichis (donut par groupe, cash-flow, taux d'épargne, valeur nette,
coach d'épargne, Zakat), PWA installable, édition/déplacement de transactions,
cartes à débit différé, import YNAB destructif. Reste notamment : import CSV
historique bancaire, mode offline, et le deuxième utilisateur (RLS par foyer).
