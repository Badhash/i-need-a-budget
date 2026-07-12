# PLAN.md — Sessions restantes

Les fondations sont en place (moteur d'enveloppes + tests, schéma Supabase
entièrement chiffré + RLS, module crypto, Edge Function `/api`, signal Realtime,
front mocké avec 3 thèmes). Ce fichier ne liste que ce qu'il reste à faire.
La spécification complète et les conventions restent dans `CLAUDE.md`.

## Session 6 — Branchement du front (1 j)

Remplacer les mocks par des appels TanStack Query vers l'Edge Function `/api`.
Ajouter l'auth (login email/password + MFA TOTP, page de login au même niveau de
finition que le reste). Abonner le front au canal Realtime privé
(`config: { private: true }`) : à chaque signal, invalider les queries.
Optimistic updates sur l'assignation budget et l'ajout de transaction.
Onboarding minimal : création des comptes (solde d'ouverture) et des catégories
par défaut via l'action `seedDefaults`.

## Session 7 — Sync bancaire Enable Banking (1,5 j)

Implémenter l'Edge Function `sync-bank` selon la section Connexion bancaire du
`CLAUDE.md` : auth JWT RS256 Enable Banking, flow de consentement (redirect +
callback), stockage session dans `bank_connections`, fetch des transactions,
dédup par `tx_hash`, application des règles de catégorisation, chiffrement,
insert, log dans `sync_logs`. Planifier via pg_cron (07:30, 12:30, 19:30
Europe/Paris). UI : page Réglages > Connexions bancaires avec état de session,
bannière J-14 et bouton Reconnecter.

## Session 8 — Finitions (1 j)

Moteur de règles de catégorisation éditable dans l'UI (matcher sur libellé,
priorités), targets par catégorie avec barre de progression dans la budget grid,
empty states et skeletons manquants, page Réglages complète (thème, export JSON
chiffré, gestion des règles), audit responsive final des vues.

---

## Backlog phase 2 (après usage réel)

- Import CSV historique bancaire
- Deuxième utilisateur : comptes partagés, RLS par foyer
- Connexions supplémentaires (Trade Republic, livrets)
- PWA installable + notifications locales ("X transactions à catégoriser")
- Widget "âge de l'argent" (age of money YNAB)
