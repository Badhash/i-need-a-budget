-- REF J — Index aveugle account_idx sur transactions (optimisation egress).
--
-- Schema NON versionne : ce script est la reference a appliquer A LA MAIN dans
-- le SQL Editor Supabase (source de verite = base de production). Idempotent :
-- rejouable sans effet de bord.
--
-- account_idx = HMAC(k_idx, 'tx-account' || user_id || account_id), calcule cote
-- Edge Function (packages/crypto : txAccountIdx). Sortie base64url stockee en
-- TEXT, comme month_idx et tx_hash (ne PAS declarer bytea : txAccountIdx rend
-- une chaine, un bytea imposerait un encodage \x et casserait toute relecture
-- JS). Domaine distinct de month_idx et tx_hash. Permet de cibler les
-- transactions d'un compte (reconcile, soldes) sans charger tout l'historique.
-- Fuite residuelle assumee : egalite et frequence (regroupement des lignes d'un
-- meme compte, sans reveler lequel).
--
-- NULLABLE a dessein : les lignes anterieures a REF J restent NULL jusqu'au
-- backfill (action /api backfillAccountIdx). Le code retombe sur le chargement
-- complet tant qu'il subsiste des lignes NULL (fallback anti-backfill).

-- 1. Colonne (nullable, pas de valeur par defaut). TEXT : coherent avec
--    month_idx / tx_hash, la valeur inseree est une chaine base64url.
alter table public.transactions
  add column if not exists account_idx text;

-- 2. Index partiel (ignore les NULL) pour les filtres `account_idx in (...)`.
create index if not exists transactions_account_idx
  on public.transactions (account_idx)
  where account_idx is not null;

-- 3. Verification post-backfill (informatif) : doit renvoyer 0 une fois l'action
--    backfillAccountIdx executee pour chaque utilisateur.
-- select count(*) from public.transactions where account_idx is null;
