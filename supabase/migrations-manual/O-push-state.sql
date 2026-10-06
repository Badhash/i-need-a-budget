-- =====================================================================
-- REF O — Notifications push (abonnements, preferences, anti-doublon)
-- =====================================================================
--
-- Une ligne par utilisateur (PK user_id), payload chiffre comme les autres
-- tables : { subscriptions: [{endpoint, p256dh, auth, device, createdAt}],
-- prefs: {imports, income, overspent, monthStart, consent, syncError},
-- sent: {...memoire de ce qui a deja ete notifie} }.
-- Module : supabase/functions/api/push.ts (partage /api et sync-bank).
--
-- Ecriture : upsert direct en hex (comme user_settings, hors RPC).
-- Lecture : computed column enc_b64 (transport base64, REF D).
-- Pas de trigger Realtime : cette table ne porte aucune donnee de budget.
-- Le code TOLERE l'absence de la table (aucune notification) : appliquer ce
-- script pour activer la fonction.
--
-- Script IDEMPOTENT : a coller tel quel dans le SQL Editor Supabase.
-- =====================================================================

create table if not exists public.push_state (
  user_id     uuid        primary key references auth.users (id) on delete cascade,
  enc_payload bytea       not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.push_state enable row level security;
revoke all on public.push_state from anon, authenticated;

create or replace function public.enc_b64(public.push_state) returns text
language sql stable as $f$
  select translate(encode($1.enc_payload, 'base64'), E'\n', '')
$f$;
grant execute on function public.enc_b64(public.push_state) to service_role;

notify pgrst, 'reload schema';
