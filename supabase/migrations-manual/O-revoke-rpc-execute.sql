-- =============================================================================
-- O — Droits d'execution des RPC enc_* : retrait explicite a anon/authenticated
-- A APPLIQUER dans le SQL Editor (aucune dependance de code, sans risque).
-- =============================================================================
--
-- Les scripts D et H font `revoke all on function ... from public`. Sur
-- Supabase, les privileges par defaut du schema public accordent EXECUTE
-- NOMMEMENT aux roles anon et authenticated : un revoke sur `public` ne les
-- retire pas. Les fonctions sont SECURITY INVOKER et les tables sont revoquees,
-- donc rien n'est exploitable en l'etat, mais le filet « service_role
-- uniquement » annonce n'etait pas garanti par les scripts.
--
-- Idempotent : rejouable sans effet de bord.

revoke execute on function public.enc_insert(text, jsonb, text) from anon, authenticated;
revoke execute on function public.enc_update(text, uuid, uuid, jsonb) from anon, authenticated;
revoke execute on function public.enc_core_b64(public.transactions) from anon, authenticated;
revoke execute on function public.enc_text_b64(public.transactions) from anon, authenticated;

-- Colonnes calculees enc_b64(<table>) : une par table, retirees si elles existent.
do $$
declare
  f record;
begin
  for f in
    select p.oid::regprocedure as signature
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.proname = 'enc_b64'
  loop
    execute format('revoke execute on function %s from anon, authenticated;', f.signature);
  end loop;
end;
$$;

-- -----------------------------------------------------------------------------
-- Verifications (lecture seule). Le schema de base n'etant pas versionne, ces
-- requetes confirment l'etat reel de la production.
-- -----------------------------------------------------------------------------

-- 1. Attendu : false, false.
--   select has_function_privilege('anon', 'public.enc_insert(text,jsonb,text)', 'execute'),
--          has_function_privilege('authenticated', 'public.enc_update(text,uuid,uuid,jsonb)', 'execute');

-- 2. Attendu sur CHAQUE table : relrowsecurity = true, anon_select = false,
--    auth_any = false.
--   select c.relname, c.relrowsecurity,
--          (select count(*) from pg_policy p where p.polrelid = c.oid) as policies,
--          has_table_privilege('anon', c.oid, 'select') as anon_select,
--          has_table_privilege('authenticated', c.oid, 'select,insert,update,delete') as auth_any
--   from pg_class c
--   where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
--   order by c.relname;

-- 3. Index attendus : unique partiel (user_id, tx_hash) et (user_id, month_idx)
--    sur transactions ; (user_id, run_at desc) sur sync_logs.
--   select tablename, indexdef from pg_indexes
--   where schemaname = 'public' and tablename in ('transactions', 'sync_logs');

-- 4. Policy Realtime du topic prive changes:<user_id>.
--   select polname, pg_get_expr(polqual, polrelid)
--   from pg_policy where polrelid = 'realtime.messages'::regclass;

-- 5. Fonctions de trigger : search_path fixe attendu (proconfig non nul).
--   select t.tgrelid::regclass, t.tgname, p.prosecdef, p.proconfig
--   from pg_trigger t join pg_proc p on p.oid = t.tgfoid
--   where not t.tgisinternal;
