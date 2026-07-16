-- REF I — Agregats chiffres pre-calcules (optimisation egress Supabase free tier)
--
-- Objectif : eviter que bootstrap et getBudgetMonth relisent TOUT l'historique
-- des transactions/assignations a chaque appel. Les agregats materialisent
-- l'etat cumulatif (soldes de comptes, activity+assigned par categorie/mois,
-- compteur "a categoriser" par mois) et sont maintenus INCREMENTALEMENT par
-- l'Edge Function /api a chaque ecriture.
--
-- CONFORMITE CHIFFREMENT (CLAUDE.md) : zero champ metier en clair. Chaque table
-- est une enveloppe opaque (id, user_id, enc_payload bytea, created_at) + index
-- aveugles HMAC (memes schemas que l'existant, domaines separes). Les montants,
-- soldes, categories, mois vivent UNIQUEMENT dans enc_payload chiffre AES-256-GCM.
--
-- Script IDEMPOTENT : rejouable sans effet de bord dans le SQL Editor.
-- Schema NON versionne : source de verite = base de production.

-- Concurrence : les agregats sont maintenus par read-modify-write cote Edge
-- Function (valeur chiffree -> pas d'increment atomique SQL possible). Pour
-- eviter les pertes de mises a jour silencieuses sous ecritures concurrentes
-- (UI optimiste, POST en arriere-plan), chaque table porte une colonne `rev`
-- (compteur de version, PAS une donnee metier -> en clair) : l'Edge Function
-- fait un UPDATE conditionnel `where id = ? and rev = ?` et re-essaie sur echec
-- (compare-and-swap). `rev` s'incremente a chaque ecriture.

-- ---------------------------------------------------------------------------
-- 1. Soldes par compte
--    account_idx = HMAC('acct-balance', user_id, accountId)  (1 ligne / compte)
--    enc_payload = { accountId, balance }   (balance = somme des montants, centimes)
-- ---------------------------------------------------------------------------
create table if not exists public.account_balances (
  id          uuid        primary key default gen_random_uuid(),
  user_id     uuid        not null references auth.users (id) on delete cascade,
  enc_payload bytea       not null,
  account_idx text        not null,
  rev         bigint      not null default 0,
  created_at  timestamptz not null default now()
);
alter table public.account_balances add column if not exists rev bigint not null default 0;
create unique index if not exists account_balances_user_account_idx
  on public.account_balances (user_id, account_idx);

-- ---------------------------------------------------------------------------
-- 2. Rollups mensuels par categorie
--    rollup_idx  = HMAC('rollup', user_id, categoryId, month)   (1 ligne / (cat, mois))
--    month_idx   = HMAC('rollup-month', user_id, month)         (ciblage par mois)
--    enc_payload = { categoryId, month, activity, assigned }    (centimes)
--    Rows sparse : seules les cellules avec activity != 0 OU assigned != 0.
-- ---------------------------------------------------------------------------
create table if not exists public.month_rollups (
  id          uuid        primary key default gen_random_uuid(),
  user_id     uuid        not null references auth.users (id) on delete cascade,
  enc_payload bytea       not null,
  rollup_idx  text        not null,
  month_idx   text        not null,
  rev         bigint      not null default 0,
  created_at  timestamptz not null default now()
);
alter table public.month_rollups add column if not exists rev bigint not null default 0;
create unique index if not exists month_rollups_user_rollup_idx
  on public.month_rollups (user_id, rollup_idx);
create index if not exists month_rollups_user_month_idx
  on public.month_rollups (user_id, month_idx);

-- ---------------------------------------------------------------------------
-- 3. Compteur "a categoriser" par mois
--    month_idx   = HMAC('uncat-month', user_id, month)  (1 ligne / mois, count > 0)
--    enc_payload = { month, count }
-- ---------------------------------------------------------------------------
create table if not exists public.uncat_counts (
  id          uuid        primary key default gen_random_uuid(),
  user_id     uuid        not null references auth.users (id) on delete cascade,
  enc_payload bytea       not null,
  month_idx   text        not null,
  rev         bigint      not null default 0,
  created_at  timestamptz not null default now()
);
alter table public.uncat_counts add column if not exists rev bigint not null default 0;
create unique index if not exists uncat_counts_user_month_idx
  on public.uncat_counts (user_id, month_idx);

-- ---------------------------------------------------------------------------
-- 4. Marqueur d'etat des agregats (1 ligne / user)
--    PRESENCE de la ligne + version courante = agregats actifs et coherents.
--    Absence / version obsolete = les lectures /api retombent sur le calcul
--    complet (loadBudgetData). C'est le KILL-SWITCH : supprimer cette ligne
--    desactive les agregats sans rien casser (fallback = comportement actuel).
--    enc_payload = { version }
-- ---------------------------------------------------------------------------
create table if not exists public.aggregate_state (
  user_id     uuid        primary key references auth.users (id) on delete cascade,
  enc_payload bytea       not null,
  built_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- RLS : filtre par user_id (defense en profondeur). L'acces reel se fait en
-- service role via l'Edge Function (bypass RLS). anon / authenticated : aucun
-- privilege direct, comme sur les autres tables.
-- ---------------------------------------------------------------------------
alter table public.account_balances enable row level security;
alter table public.month_rollups    enable row level security;
alter table public.uncat_counts      enable row level security;
alter table public.aggregate_state   enable row level security;

drop policy if exists account_balances_owner on public.account_balances;
create policy account_balances_owner on public.account_balances
  for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists month_rollups_owner on public.month_rollups;
create policy month_rollups_owner on public.month_rollups
  for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists uncat_counts_owner on public.uncat_counts;
create policy uncat_counts_owner on public.uncat_counts
  for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists aggregate_state_owner on public.aggregate_state;
create policy aggregate_state_owner on public.aggregate_state
  for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

revoke all on public.account_balances from anon, authenticated;
revoke all on public.month_rollups    from anon, authenticated;
revoke all on public.uncat_counts      from anon, authenticated;
revoke all on public.aggregate_state   from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Filet de securite : recompute periodique (borne toute derive residuelle)
-- ---------------------------------------------------------------------------
-- Le compare-and-swap (colonne `rev`) elimine les pertes de mises a jour sous
-- concurrence. Restent des derives THEORIQUES non couvertes par une exception :
-- crash de l'Edge Function ENTRE l'ecriture metier et la maintenance de
-- l'agregat (non transactionnel a travers PostgREST). Pour les borner, planifier
-- un recompute complet hors des heures d'usage, sur le modele du cron de
-- sync-bank (pg_cron + pg_net appellent l'Edge Function /api, qui seule detient
-- la cle de dechiffrement -- un recompute en SQL pur est impossible). Exemple
-- (a adapter : URL du projet + secret d'appel, jamais de secret en dur ici) :
--
--   select cron.schedule(
--     'recompute-aggregates-nightly',
--     '17 3 * * *',                      -- 03:17 chaque nuit
--     $$
--       select net.http_post(
--         url     := 'https://<PROJECT-REF>.supabase.co/functions/v1/api',
--         headers := jsonb_build_object(
--           'Content-Type', 'application/json',
--           'Authorization', 'Bearer ' || current_setting('app.cron_jwt', true)
--         ),
--         body    := jsonb_build_object('action', 'recomputeAggregates')
--       );
--     $$
--   );
--
-- NB : l'action recomputeAggregates exige un JWT utilisateur valide (allowlist).
-- Pour un declenchement par cron, prevoir un jeton de service dedie ou etendre
-- /api a un secret x-cron-secret comme sync-bank. Non active par defaut.
