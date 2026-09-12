-- =====================================================================
-- REF N — Memoire de tiers chiffree (payee_memory)
-- =====================================================================
--
-- Une ligne par (utilisateur, tiers). Le tiers est identifie par un index
-- aveugle payee_idx = HMAC('payee', user_id, payeeKey(libelle)) — la cle de
-- tiers est derivee du libelle bancaire (packages/crypto/src/payee.ts). Le
-- payload chiffre (AAD ['payee_memory', user_id]) contient :
--   { key: string, categoryId: string, history: string[] }
-- history = les 3 dernieres categories choisies (plus recente en tete) ;
-- categoryId = categorie par defaut (regle « 2 des 3 dernieres concordent »).
--
-- Usage : chaque categorisation manuelle apprend le tiers ; sync-bank et
-- applyRulesToUncategorized l'utilisent en repli des regles pour que les
-- imports arrivent deja categorises (facon YNAB).
--
-- Ecriture : upsert direct en hex (comme user_settings, hors RPC).
-- Lecture : computed column enc_b64 (transport base64, REF D).
-- Le code TOLERE l'absence de la table (memoire vide, apprentissage ignore) :
-- appliquer ce script pour activer la fonction.
--
-- Script IDEMPOTENT : a coller tel quel dans le SQL Editor Supabase.
-- =====================================================================

create table if not exists public.payee_memory (
  id          uuid        primary key default gen_random_uuid(),
  user_id     uuid        not null references auth.users (id) on delete cascade,
  payee_idx   text        not null,
  enc_payload bytea       not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (user_id, payee_idx)
);

alter table public.payee_memory enable row level security;
revoke all on public.payee_memory from anon, authenticated;

create or replace function public.enc_b64(public.payee_memory) returns text
language sql stable as $f$
  select translate(encode($1.enc_payload, 'base64'), E'\n', '')
$f$;
grant execute on function public.enc_b64(public.payee_memory) to service_role;

notify pgrst, 'reload schema';
