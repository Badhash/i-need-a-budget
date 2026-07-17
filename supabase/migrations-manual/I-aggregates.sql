-- =====================================================================
-- REF I — Agregats chiffres pre-calcules (optimisation egress free tier)
-- =====================================================================
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
-- soldes, categories, mois vivent UNIQUEMENT dans enc_payload chiffre
-- AES-256-GCM. La colonne `rev` est un compteur de version technique (CAS),
-- PAS une donnee metier -> en clair, comme created_at. Fuite residuelle
-- assumee : rev revele un volume d'ecritures par ligne d'agregat, built_at un
-- horodatage de reconstruction (equivalents des horodatages deja en clair).
--
-- ORDRE DE DEPLOIEMENT : appliquer ce SQL PUIS deployer le code. Le code est
-- tolerant dans les deux sens (marqueur absent / tables absentes = agregats
-- inactifs, fallback calcul complet), mais l'ordre SQL-d'abord evite des
-- tentatives de reconstruction vouees a l'echec a chaque ouverture de l'app.
-- BACKFILL : AUCUNE action manuelle. A la premiere ouverture de l'app apres le
-- deploiement, bootstrapFull detecte le marqueur absent et reconstruit les
-- agregats en arriere-plan a partir des donnees deja chargees.
--
-- Script IDEMPOTENT : rejouable sans effet de bord dans le SQL Editor.
-- Schema NON versionne : source de verite = base de production.

-- Concurrence : les agregats sont maintenus par read-modify-write cote Edge
-- Function (valeur chiffree -> pas d'increment atomique SQL possible). Pour
-- eviter les pertes de mises a jour silencieuses sous ecritures concurrentes,
-- chaque table porte une colonne `rev` : l'Edge Function fait un UPDATE
-- conditionnel `where id = ? and rev = ?` et re-essaie sur echec
-- (compare-and-swap). Sur aggregate_state, `rev` sert aussi de FENCE : toute
-- maintenance l'incremente, et un recompute ne marque l'etat "pret" que si rev
-- n'a pas bouge pendant la reconstruction.

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
--    enc_payload = { version, status: 'ready' | 'building' } (chiffre).
--    Lectures rapides /api ACTIVES seulement si status = 'ready' a la bonne
--    version. Absence / 'building' / version obsolete = fallback calcul
--    complet. C'est le KILL-SWITCH : supprimer cette ligne desactive les
--    agregats sans rien casser. `rev` = fence CAS (voir en-tete).
-- ---------------------------------------------------------------------------
create table if not exists public.aggregate_state (
  user_id     uuid        primary key references auth.users (id) on delete cascade,
  enc_payload bytea       not null,
  rev         bigint      not null default 0,
  built_at    timestamptz not null default now()
);
alter table public.aggregate_state add column if not exists rev bigint not null default 0;

-- ---------------------------------------------------------------------------
-- 5. Transport base64 en LECTURE (composition REF D) : computed columns
--    PostgREST enc_b64 par table, comme les tables existantes. Les lectures
--    /api selectionnent `enc_payload:enc_b64` (-33% vs hex). Les ECRITURES de
--    ces tables restent en litteral hex direct (les CAS conditionnels sur rev
--    ne passent pas par les RPC enc_insert/enc_update ; l'ingress n'est pas
--    facture).
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
  tables constant text[] := array[
    'account_balances','month_rollups','uncat_counts','aggregate_state'
  ];
begin
  foreach t in array tables loop
    execute format(
      'create or replace function public.enc_b64(%I) returns text '
      || 'language sql stable as $f$ '
      || 'select translate(encode($1.enc_payload, %L), E''\n'', '''') $f$;',
      t, 'base64'
    );
    execute format('grant execute on function public.enc_b64(public.%I) to service_role;', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- RLS : filtre par user_id (defense en profondeur). L'acces reel se fait en
-- service role via l'Edge Function (bypass RLS). anon / authenticated : aucun
-- privilege direct, comme sur les autres tables.
-- ---------------------------------------------------------------------------
alter table public.account_balances enable row level security;
alter table public.month_rollups    enable row level security;
alter table public.uncat_counts     enable row level security;
alter table public.aggregate_state  enable row level security;

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
revoke all on public.uncat_counts     from anon, authenticated;
revoke all on public.aggregate_state  from anon, authenticated;

-- Recharge le cache de schema PostgREST (sinon tables / computed columns
-- absentes pour l'Edge Function jusqu'au prochain reload).
notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- Filets de securite integres (aucune action requise ici) :
--   * Toute erreur de maintenance invalide le marqueur -> fallback calcul
--     complet, jamais de chiffre faux fige.
--   * sync-bank remet les agregats a la verite (recompute complet) apres
--     chaque import et chaque reconciliation de solde.
--   * bootstrapFull reconstruit automatiquement des que le marqueur est
--     absent / non-pret, a chaque ouverture de l'app.
-- ---------------------------------------------------------------------------
