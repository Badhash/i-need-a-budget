# PLAN-MVP.md — Reste à faire (MVP)

## Définition du MVP

Une seule promesse : "Je vois mes transactions bancaires arriver automatiquement,
je les range dans des enveloppes, je sais combien il me reste à dépenser."

Fondations déjà livrées (hors de ce fichier) : moteur d'enveloppes + tests,
schéma Supabase entièrement chiffré + RLS, module crypto, Edge Function `/api`,
signal Realtime, shell UI et vues sur données mockées (3 thèmes, light/dark).

Reste à faire pour boucler le MVP : authentification, branchement du front sur
`/api`, et la synchronisation bancaire (le cœur de la promesse).

---

## EPIC 2 (reliquat) — Authentification

### Story 2.3 — En tant qu'utilisateur, je me connecte
- [ ] Supabase Auth email/password, page de login au niveau du design system
- [ ] Signup fermé (single user) : compte créé manuellement via dashboard, MFA TOTP

---

## EPIC 3 — Branchement front (1 j)

### Story 3.1 — En tant qu'utilisateur, je manipule mes vraies données
- [ ] Remplacement des mocks par TanStack Query → `/api`
- [ ] Onboarding minimal : créer comptes + solde d'ouverture + groupes/catégories par défaut (`seedDefaults`)
- [ ] Assignation et ajout de transaction fonctionnels de bout en bout

### Story 3.2 — En tant qu'utilisateur, l'app se met à jour toute seule
- [ ] Abonnement Realtime privé (`config: { private: true }`) → invalidation des queries
- [ ] Skeletons sur toutes les vues

---

## EPIC 4 — Sync bancaire (1,5 j)
Le cœur de la promesse MVP.

### Story 4.1 — En tant qu'utilisateur, je connecte ma banque
- [ ] Edge Function `sync-bank` : JWT RS256, flow consentement (redirect + callback), session en `bank_connections`
- [ ] Page Réglages > Connexion : état de session, bouton Connecter/Reconnecter, bannière J-14 avant expiration

### Story 4.2 — En tant qu'utilisateur, mes transactions arrivent seules
- [ ] Fetch + dédup `tx_hash` + chiffrement + insert, log `sync_logs`
- [ ] Transactions importées → catégorie null → badge "À catégoriser"
- [ ] pg_cron 07:30 / 12:30 / 19:30 Europe/Paris + bouton "Synchroniser maintenant"

---

## Definition of Done du MVP

- Une transaction réelle apparaît dans l'app sans action manuelle
- Je la catégorise en 2 taps depuis mobile
- Le Disponible et le RTA sont justes (vérifiés contre les tests engine)
- Rien en clair dans les tables Supabase (vérification visuelle dashboard)
- L'app est utilisable et agréable sur mobile et desktop, light et dark

## Backlog post-MVP (ordre suggéré par valeur)

1. Règles de catégorisation auto (supprime la corvée quotidienne)
2. Rapports : donut dépenses par groupe + cash-flow 6 mois (Tremor)
3. Targets par catégorie
4. Transferts liés + réconciliation
5. Import CSV historique, comptes tracking, MFA, PWA
