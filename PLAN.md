# PLAN.md — Reste à faire

Les fondations et le produit sont en place : moteur d'enveloppes + tests, schéma
Supabase entièrement chiffré + RLS (appliqué en prod), module crypto, Edge
Function `/api` (budget, transactions, comptes, rapports, règles, objectifs,
connexions, export), signal Realtime, authentification email/password + MFA TOTP,
front branché sur `/api` (données réelles), objectifs par catégorie, page Règles,
Réglages complets (thème, MFA, connexion bancaire, export, déconnexion), et la
fonction `sync-bank` Enable Banking (écrite, NON encore testée).

Ce fichier ne liste que ce qu'il reste. La spécification complète reste dans
`CLAUDE.md`.

## 1. Configuration (à faire par l'utilisateur, aucun code)

Renseigner les secrets et réglages pour un déploiement fonctionnel :

- Secrets GitHub Actions : `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_ID`
  (deploy Edge Functions), `SUPABASE_URL`, `SUPABASE_ANON_KEY` (build Pages + ping).
- Secrets d'exécution Edge Functions (dashboard Supabase) : `ENCRYPTION_KEY`
  (32 bytes base64, à sauvegarder AUSSI hors Supabase), `ALLOWED_USER_EMAILS`,
  `ALLOWED_ORIGINS`.
- Réglages projet : désactiver l'inscription, créer le compte unique, activer le
  MFA depuis l'app ; Data API activée, exposition auto des tables désactivée.

## 2. Activation Enable Banking (sync bancaire)

La fonction `sync-bank` est écrite mais non testable tant que l'app Enable Banking
n'est pas validée (production restreinte). Une fois validée :

- Secrets EB : `ENABLE_BANKING_APP_ID`, `ENABLE_BANKING_PRIVATE_KEY`,
  `ENABLE_BANKING_ASPSP_NAME`, `ENABLE_BANKING_REDIRECT_URL`, `SYNC_CRON_SECRET`.
- Vérifier le flow réel (consentement, mapping des transactions, dédup) contre
  l'API EB et ajuster les hypothèses marquées `HYP EB` dans `sync-bank/index.ts`.
- Planifier via pg_cron (07:30 / 12:30 / 19:30 Europe/Paris) : SQL prêt à coller
  dans `supabase/functions/sync-bank/README.md`.
- Lier chaque compte à son `providerAccountUid` Enable Banking.

## Backlog phase 2 (après usage réel)

- Import CSV historique bancaire
- Deuxième utilisateur : comptes partagés, RLS par foyer
- Connexions supplémentaires (Trade Republic, livrets)
- PWA installable + notifications locales ("X transactions à catégoriser")
- Widget "âge de l'argent" (age of money YNAB)
- Transferts liés + réconciliation
- Réordonnancement atomique des règles côté serveur (échange de priorités)
