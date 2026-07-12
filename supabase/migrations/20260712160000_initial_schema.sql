-- Schema initial — decision "TOUT CHIFFRE" (CLAUDE.md).
--
-- Chaque table est une enveloppe opaque : (id, user_id, enc_payload, created_at).
-- enc_payload = JSON metier complet chiffre en AES-256-GCM par l'Edge Function.
-- Aucun champ metier en clair. Les requetes qui necessitaient un champ en
-- clair utilisent des INDEX AVEUGLES : HMAC-SHA256 keye (cle derivee de
-- ENCRYPTION_KEY via HKDF), opaque en base, calculable uniquement cote
-- Edge Function.
--
--   transactions.month_idx  = HMAC(k_idx, 'tx-month' || user_id || 'YYYY-MM')
--   transactions.tx_hash    = HMAC(k_idx, 'tx' || user_id || account + date + montant + libelle normalise)
--   assignments.assign_idx  = HMAC(k_idx, 'assign' || user_id || category_id || 'YYYY-MM')
--   assignments.month_idx   = HMAC(k_idx, 'assign-month' || user_id || 'YYYY-MM')
--   targets.target_idx      = HMAC(k_idx, 'target' || user_id || category_id)
--
-- Fuite residuelle assumee des index aveugles : egalite et frequence (les
-- lignes d'un meme mois se regroupent, sans reveler lequel). Les domaines
-- sont separes par table pour ne pas relier transactions et assignments.
--
-- Les references entre entites (account_id, category_id, transfer_group_id...)
-- vivent DANS le payload chiffre ; l'integrite referentielle est verifiee par
-- l'Edge Function /api. Metadonnees residuelles assumees et documentees :
-- nombre de lignes, horodatages, identifiants aleatoires.
--
-- RLS par user_id partout (defense en profondeur : aucun acces client direct,
-- tout passe par /api en service role).

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  enc_payload bytea not null,
  created_at timestamptz not null default now()
);

create table public.category_groups (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  enc_payload bytea not null,
  created_at timestamptz not null default now()
);

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  enc_payload bytea not null,
  created_at timestamptz not null default now()
);

create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  month_idx text not null,
  -- null = saisie manuelle : la dedup ne s'applique qu'aux imports bancaires
  -- (deux depenses manuelles identiques le meme jour sont legitimes)
  tx_hash text,
  enc_payload bytea not null,
  created_at timestamptz not null default now()
);

create unique index transactions_user_txhash_uniq
  on public.transactions (user_id, tx_hash)
  where tx_hash is not null;

create table public.assignments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  assign_idx text not null,
  month_idx text not null,
  enc_payload bytea not null,
  created_at timestamptz not null default now(),
  unique (user_id, assign_idx)
);

create table public.targets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  target_idx text not null,
  enc_payload bytea not null,
  created_at timestamptz not null default now(),
  unique (user_id, target_idx)
);

create table public.rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  enc_payload bytea not null,
  created_at timestamptz not null default now()
);

create table public.bank_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  enc_payload bytea not null,
  created_at timestamptz not null default now()
);

create table public.sync_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  enc_payload bytea not null,
  run_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Index
-- ---------------------------------------------------------------------------

create index accounts_user_idx on public.accounts (user_id);
create index category_groups_user_idx on public.category_groups (user_id);
create index categories_user_idx on public.categories (user_id);
create index transactions_user_month_idx on public.transactions (user_id, month_idx);
create index assignments_user_month_idx on public.assignments (user_id, month_idx);
create index targets_user_idx on public.targets (user_id);
create index rules_user_idx on public.rules (user_id);
create index bank_connections_user_idx on public.bank_connections (user_id);
create index sync_logs_user_run_idx on public.sync_logs (user_id, run_at desc);

-- ---------------------------------------------------------------------------
-- RLS : policies limitees au user_id sur chaque table
-- ---------------------------------------------------------------------------

alter table public.accounts enable row level security;
alter table public.category_groups enable row level security;
alter table public.categories enable row level security;
alter table public.transactions enable row level security;
alter table public.assignments enable row level security;
alter table public.targets enable row level security;
alter table public.rules enable row level security;
alter table public.bank_connections enable row level security;
alter table public.sync_logs enable row level security;

create policy "own rows" on public.accounts
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own rows" on public.category_groups
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own rows" on public.categories
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own rows" on public.transactions
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own rows" on public.assignments
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own rows" on public.targets
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own rows" on public.rules
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own rows" on public.bank_connections
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own rows" on public.sync_logs
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Privileges : aucun acces client direct. Seul service_role (Edge Functions)
-- peut toucher les tables ; anon et authenticated n'ont aucun droit dessus.
-- Les default privileges sont aussi revoques pour que les tables des
-- migrations FUTURES ne soient jamais re-exposees automatiquement, quel que
-- soit le reglage projet ("Automatically expose new tables").
-- ---------------------------------------------------------------------------

revoke all on public.accounts, public.category_groups, public.categories,
  public.transactions, public.assignments, public.targets, public.rules,
  public.bank_connections, public.sync_logs from anon, authenticated;

alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke all on functions from anon, authenticated;

grant usage on schema public to service_role;
grant all on public.accounts, public.category_groups, public.categories,
  public.transactions, public.assignments, public.targets, public.rules,
  public.bank_connections, public.sync_logs to service_role;
