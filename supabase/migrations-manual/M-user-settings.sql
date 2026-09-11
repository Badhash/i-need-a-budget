-- =====================================================================
-- REF M — Reglages utilisateur chiffres (mois de depart du budget)
-- =====================================================================
--
-- Une ligne par utilisateur (PK user_id), payload chiffre comme les autres
-- tables : { budgetStartMonth: 'YYYY-MM' | null }. Sert la fonction
-- « Nouveau budget » : tout l'historique anterieur a ce mois est gele et
-- reduit a un solde de depart verse au Pret a assigner (voir packages/engine).
--
-- Ecriture : upsert direct en hex (comme les tables d'agregats, hors RPC).
-- Lecture : computed column enc_b64 (transport base64, REF D).
-- Le code TOLERE l'absence de la table (aucun mois de depart = comportement
-- historique) : appliquer ce script pour activer la fonction.
--
-- Script IDEMPOTENT : a coller tel quel dans le SQL Editor Supabase.
-- =====================================================================

create table if not exists public.user_settings (
  user_id     uuid        primary key references auth.users (id) on delete cascade,
  enc_payload bytea       not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.user_settings enable row level security;
revoke all on public.user_settings from anon, authenticated;

create or replace function public.enc_b64(public.user_settings) returns text
language sql stable as $f$
  select translate(encode($1.enc_payload, 'base64'), E'\n', '')
$f$;
grant execute on function public.enc_b64(public.user_settings) to service_role;

notify pgrst, 'reload schema';
