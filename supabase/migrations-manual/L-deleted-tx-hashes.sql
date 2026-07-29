-- =====================================================================
-- REF L — Tombstones de dedup pour les imports bancaires supprimes
-- =====================================================================
--
-- Probleme corrige : supprimer une transaction IMPORTEE (tx_hash non NULL)
-- effacait son hash avec la ligne ; au run suivant, sync-bank ne voyait plus
-- le hash en base et REINSERAIT la transaction (suppression silencieusement
-- annulee sous 12 h). Cette table conserve les hashes supprimes ; sync-bank
-- les ajoute a son ensemble de dedup (loadSeenHashesWindow).
--
-- Contenu : uniquement des HMAC opaques (index aveugles) — aucune donnee en
-- clair. Volume negligeable (un hash par suppression manuelle).
--
-- Script IDEMPOTENT : a coller tel quel dans le SQL Editor Supabase.
-- Le code (deploye avec ce commit) TOLERE l'absence de la table : tant que ce
-- script n'est pas applique, le comportement reste celui d'avant.
-- =====================================================================

create table if not exists public.deleted_tx_hashes (
  user_id    uuid        not null references auth.users (id) on delete cascade,
  tx_hash    text        not null,
  created_at timestamptz not null default now(),
  primary key (user_id, tx_hash)
);

alter table public.deleted_tx_hashes enable row level security;

-- Acces service_role uniquement (comme les autres tables : le front ne lit
-- jamais les tables directement). Pas de policy = aucun acces anon/authenticated.
revoke all on public.deleted_tx_hashes from anon, authenticated;

notify pgrst, 'reload schema';
