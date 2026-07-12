# CLAUDE.md — Budget App (clone YNAB personnel)

## Contexte

Application de budget par enveloppes (zero-based) pour usage personnel, inspirée de YNAB. Utilisateur unique (extensible à 2 plus tard). Langue de l'UI : français. Priorité produit : une UI/UX soignée qui donne envie de revenir, PUIS la logique métier.

## Stack (ne pas dévier sans validation explicite)

* Front : React 18 + TypeScript + Vite, déployé sur GitHub Pages (hash routing obligatoire `/#/`)
* State serveur : TanStack Query. State UI : Zustand. Tables : TanStack Table.
* Styles : Tailwind CSS + shadcn/ui. Widgets analytiques : Tremor. Graphes custom : Recharts.
* Backend : Supabase free tier (Postgres + RLS, Auth email/password + MFA TOTP, Edge Functions Deno, pg_cron + pg_net, Realtime)
* Bancaire : Enable Banking (restricted production app, JWT RS256, sessions 180 jours)
* Tests : Vitest, uniquement sur le moteur d'enveloppes et la crypto

## Structure du repo

```
/app                    → front React (déployé sur Pages)
/supabase
  /migrations           → schéma SQL versionné (jamais de modif manuelle dashboard)
  /functions
    /sync-bank          → poll Enable Banking, dédup, chiffrement, insert
    /api                → lecture/écriture déchiffrée (endpoint unique, actions typées)
/docs
  /design-references    → captures Copilot Money (north star visuelle)
/.github/workflows      → deploy pages, db push, backup pg_dump hebdo, ping anti-pause quotidien
```

## Architecture de chiffrement (décision figée : TOUT CHIFFRÉ, zéro champ métier en clair)

* Clé unique `ENCRYPTION_KEY` (32 bytes base64) en secret Edge Function, sauvegardée AUSSI hors Supabase par l'utilisateur (gestionnaire de mots de passe). Deux sous-clés dérivées via HKDF-SHA256 : `k_enc` (AES-256-GCM, payloads) et `k_idx` (HMAC-SHA256, index aveugles).
* Enveloppe opaque : chaque table se réduit à (id, user_id, enc_payload bytea, created_at). TOUT le JSON métier est chiffré : montants, libellés, IBAN, notes, noms, mois comptable, références compte/catégorie/transfert, institution, statuts de sync, flags (on_budget, hidden, is_income), ordres de tri.
* Index aveugles (valeurs HMAC opaques, domaines séparés par table) : `transactions.month_idx` (filtre par mois), `transactions.tx_hash` (dédup), `assignments.assign_idx` (unicité catégorie+mois), `assignments.month_idx`, `targets.target_idx`. Fuite résiduelle assumée : égalité et fréquence (regroupement des lignes d'un même mois, sans révéler lequel).
* Chaque payload est lié par AAD AES-GCM à sa table et à son utilisateur : un ciphertext recopié dans une autre table ou chez un autre utilisateur ne se déchiffre pas. Risque résiduel assumé : échange entre lignes d'une même table du même utilisateur, rollback d'une ligne isolée.
* Les références entre entités vivent dans le payload chiffré : intégrité référentielle vérifiée par l'Edge Function `/api` (pas de FK SQL métier).
* Métadonnées résiduelles assumées (aucune base ne peut les cacher) : nombre de lignes par table, horodatages, identifiants aléatoires.
* Le front ne fait JAMAIS de SELECT direct sur les tables sensibles. Toute lecture/écriture passe par l'Edge Function `/api` (auth Supabase vérifiée, déchiffrement en mémoire, agrégations calculées côté serveur, réponse JSON en clair sur TLS).
* Realtime : SIGNAL uniquement, aucun payload sensible. Topic privé `changes:<user_id>`, broadcast vide émis par trigger Postgres (dédupliqué par transaction). Le front DOIT s'abonner avec `supabase.channel('changes:' + userId, { config: { private: true } })` — sans `private: true`, le canal privé est refusé silencieusement. À réception, invalider les queries TanStack et refetch via `/api`.
* RLS activée sur toutes les tables, policies limitées au user_id, même si l'accès direct n'est pas utilisé (défense en profondeur).
* Interdit : logger des payloads déchiffrés, exposer la clé au front, désactiver RLS.

## Design system — north star : Copilot Money

Objectif : finance chaleureuse, moderne, arrondie. PAS un back-office admin. Références : captures dans /docs/design-references. En cas de doute visuel, imiter Copilot.

### Tokens (source unique : app/src/styles/tokens.css, mappés dans tailwind.config)

* Mode : light ET dark, toggle, préférence système par défaut.
* Light : fond `#FAF9F7` (blanc cassé chaud), surfaces `#FFFFFF`, texte `#1A1A1A`.
* Dark : fond `#141414` (chaud, pas bleuté), surfaces `#1E1E1E`, texte `#F2F0ED`.
* Accent principal : corail `#FF6B5E`. Succès/revenus : vert `#34C77B`. Alerte/dépassement : ambre `#F5A623`. Négatif : rouge `#E5484D`.
* Chaque groupe de catégories a une couleur pastel dédiée + icône Lucide (pastille ronde).
* Rayons : cards `rounded-2xl`, boutons/inputs `rounded-xl`, pastilles `rounded-full`.
* Ombres légères en light (`shadow-sm`), bordures subtiles en dark (pas d'ombres).
* Typographie : Instrument Sans (Google Fonts). Chiffres en `font-variant-numeric: tabular-nums`. Montants héros en 600/32px, corps 15px, labels 13px uppercase tracking-wide muted.
* Espacements : grille 4px, padding cards 20px, gaps 16px. Aérer, ne jamais tasser.

### Règles de composition des widgets (dashboard analytique)

* Un widget = UNE question ("où part mon argent ce mois-ci ?") + un chiffre principal + une tendance (vs mois précédent) + un graphe secondaire max. Zéro graphe décoratif.
* Base : composants Tremor (KPI card, BarList, DonutChart, SparkAreaChart, Tracker), restylés avec les tokens ci-dessus.
* Skeletons de chargement systématiques (pas de spinners), empty states illustrés avec CTA.
* Montants : format fr-FR, `1 234,56 €`, négatifs en rouge avec signe.

### Responsive (mobile et desktop à égalité)

* Desktop ≥1024px : sidebar gauche fixe (Budget, Comptes, Transactions, Rapports, Réglages), contenu max-w-6xl centré, budget grid en tableau dense.
* Mobile <1024px : bottom navigation 4 onglets + FAB "Ajouter une transaction", budget grid en liste de cards par groupe, montants alignés à droite, touch targets ≥44px.
* Toute vue est conçue et validée dans les deux breakpoints avant d'être considérée terminée.

## Spec du moteur d'enveloppes (règles YNAB, source de vérité)

Définitions par catégorie et par mois M :

* `assigned(M)` : montant alloué manuellement à la catégorie pour M.
* `activity(M)` : somme des transactions de la catégorie sur M (dépenses négatives).
* `available(M) = rollover(M) + assigned(M) + activity(M)`
* `rollover(M) = max(available(M-1), 0)` → un dépassement (available négatif) ne se reporte PAS : il est remis à zéro et vient en déduction du Ready to Assign de M.

Ready to Assign du mois M :

* `RTA(M) = inflows cumulés jusqu'à M (catégorie "Revenus") − assigned cumulés jusqu'à M − somme des overspending des mois < M`
* Assigner plus que le RTA est autorisé mais affiche le RTA en négatif (rouge) avec bannière.

Transferts entre comptes : deux transactions liées (transfer_group_id), aucune catégorie, n'impactent ni activity ni RTA.

Comptes hors budget (tracking, ex. PEA) : soldes suivis, transactions sans catégorie, exclus du RTA. Flag `on_budget` sur le compte.

Futur : assigner sur les mois futurs est possible, décompte du RTA courant.

Tous ces calculs vivent dans un module TypeScript pur `packages/engine` (zéro dépendance), utilisé par l'Edge Function `/api`, couvert par Vitest (cas : rollover positif, overspending, mois vide, transfert, futur).

## Modèle de données (tables principales — enveloppes opaques)

Toutes les tables : (id, user_id, enc_payload bytea, created_at) + index aveugles listés. Contenu du payload chiffré par table :

* `accounts` — payload : name, institution, kind, on_budget, closed, connection_id null, provider_account_uid null (identifiant de compte Enable Banking : contrat explicite pour sync-bank)
* `transactions` — index aveugles : month_idx, tx_hash (unique par user, NULL pour les saisies manuelles : la dédup ne concerne que les imports bancaires) ; payload : account_id, category_id null, booking_date, booking_month, amount, label, counterparty, transfer_group_id null, notes
* `category_groups` — payload : name, color, icon, sort_order, hidden
* `categories` — payload : group_id, name, is_income, sort_order, hidden
* `assignments` — index aveugles : assign_idx (unique par user), month_idx ; payload : category_id, month, amount
* `targets` — index aveugle : target_idx (unique par user) ; payload : category_id, type, amount, due_month
* `rules` — payload : matcher, category_id, priority
* `bank_connections` — payload : institution, session_state, valid_until
* `sync_logs` (run_at en clair pour la rétention) — payload : connection_id, status, imported_count, error

## Connexion bancaire (Enable Banking)

* Périmètre initial : une banque française compatible Enable Banking (identifiants ASPSP configurés hors dépôt, en secret). Le modèle supporte N connexions.
* `sync-bank` déclenchée par pg_cron à 07:30, 12:30, 19:30 Europe/Paris via pg_net.
* Dédup : `tx_hash = sha256(account_id + booking_date + amount + libellé normalisé)`.
* Transactions importées arrivent SANS catégorie → moteur de règles → sinon "À catégoriser" (badge de compteur dans la nav).
* Re-consentement : bannière visible dès J-14 avant expiration de session, bouton "Reconnecter" qui relance le flow d'auth PSD2.
* Démarrage : solde d'ouverture saisi manuellement à la date d'activation ; seules les transactions postérieures sont importées. Import CSV historique = feature phase 2.

## Conventions de travail

* Réponses et commits en français, code/identifiants en anglais.
* Pas d'emojis nulle part (UI, commits, docs).
* Conventional commits (feat:, fix:, chore:).
* Toute modif de schéma = nouvelle migration via Supabase CLI.
* Ne jamais installer de dépendance non listée dans la stack sans la proposer d'abord.
* Chaque vue livrée : vérifier light + dark + mobile + desktop.
* Sécurité : jamais de secrets en dur, jamais de données bancaires réelles dans les fixtures de test.
