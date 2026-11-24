-- =============================================================================
-- Q — Controle de securite de la base (LECTURE SEULE, ne modifie rien)
-- A coller tel quel dans le SQL Editor. Une seule requete, une ligne par
-- controle : la colonne `resultat` vaut OK, A CORRIGER ou A VERIFIER.
-- =============================================================================
--
-- Le schema n'etant pas versionne, c'est le seul moyen de confirmer l'etat reel
-- de la production. Rejouable a volonte (apres chaque script SQL applique).
--
-- Ce que chaque ligne « A CORRIGER » appelle :
--   - RLS / droits d'une table            -> alter table ... enable row level
--                                            security ; revoke all on ... from
--                                            anon, authenticated
--   - fonction executable par anon/auth.  -> O-revoke-rpc-execute.sql
--   - secret cron en clair                -> P-cron-secret-vault.sql, puis
--                                            rotation du secret
--   - second facteur absent               -> l'enroler dans Reglages, puis poser
--                                            le secret REQUIRE_MFA=1
--   - plusieurs comptes                   -> fermer l'inscription (dashboard >
--                                            Authentication) et supprimer les
--                                            comptes inconnus

with
tables as (
  select c.oid, c.relname, c.relrowsecurity
  from pg_class c
  where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
),
-- Requetes sur des schemas facultatifs (cron, auth) : evaluees seulement si la
-- table existe, pour que le controle ne plante jamais.
dyn as (
  select
    case when to_regclass('cron.job') is null then null else
      (xpath('/row/n/text()', query_to_xml(
        $q$select count(*) as n from cron.job
           where command ilike '%x-cron-secret%'
             and command not ilike '%vault.decrypted_secrets%'$q$,
        false, true, '')))[1]::text::int
    end as cron_secret_en_clair,
    case when to_regclass('cron.job') is null then null else
      (xpath('/row/n/text()', query_to_xml(
        $q$select count(*) as n from cron.job where jobname like 'sync-bank-%'$q$,
        false, true, '')))[1]::text::int
    end as cron_jobs_sync,
    case when to_regclass('auth.mfa_factors') is null then null else
      (xpath('/row/n/text()', query_to_xml(
        $q$select count(*) as n from auth.mfa_factors where status = 'verified'$q$,
        false, true, '')))[1]::text::int
    end as facteurs_verifies,
    case when to_regclass('auth.users') is null then null else
      (xpath('/row/n/text()', query_to_xml(
        $q$select count(*) as n from auth.users$q$,
        false, true, '')))[1]::text::int
    end as comptes
),
checks(ordre, controle, etat, detail) as (
  select 1, 'RLS activee : ' || relname,
         case when relrowsecurity then 'OK' else 'A CORRIGER' end, ''
  from tables
  union all
  select 2, 'aucun droit anon / authenticated : ' || relname,
         case when has_table_privilege('anon', oid, 'select,insert,update,delete,truncate')
                or has_table_privilege('authenticated', oid, 'select,insert,update,delete,truncate')
              then 'A CORRIGER' else 'OK' end, ''
  from tables
  union all
  select 3, 'fonction reservee a service_role : ' || p.oid::regprocedure::text,
         case when has_function_privilege('anon', p.oid, 'execute')
                or has_function_privilege('authenticated', p.oid, 'execute')
              then 'A CORRIGER' else 'OK' end,
         'script O'
  from pg_proc p
  where p.pronamespace = 'public'::regnamespace
    -- Les fonctions de trigger et d'event trigger ne sont pas appelables
    -- directement (ex. rls_auto_enable(), posee par Supabase pour activer la
    -- RLS sur toute nouvelle table) : leur droit EXECUTE est sans effet.
    and p.prorettype not in ('trigger'::regtype, 'event_trigger'::regtype)
  union all
  select 4, 'search_path fixe (security definer) : ' || p.oid::regprocedure::text,
         case when exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')
              then 'OK' else 'A CORRIGER' end, ''
  from pg_proc p
  where p.pronamespace = 'public'::regnamespace and p.prosecdef
  union all
  select 5, 'Realtime : reception limitee au topic de l''utilisateur',
         case when to_regclass('realtime.messages') is null then 'A VERIFIER'
              when exists (
                select 1 from pg_policy pol
                where pol.polrelid = to_regclass('realtime.messages')
                  and pg_get_expr(pol.polqual, pol.polrelid) like '%changes:%'
                  and pg_get_expr(pol.polqual, pol.polrelid) like '%auth.uid()%'
              ) then 'OK' else 'A CORRIGER' end, ''
  union all
  select 6, 'Realtime : aucune policy d''emission pour anon / authenticated',
         case when to_regclass('realtime.messages') is null then 'A VERIFIER'
              when exists (
                select 1 from pg_policy pol
                where pol.polrelid = to_regclass('realtime.messages')
                  and pol.polcmd in ('a', 'w', '*')
              ) then 'A CORRIGER' else 'OK' end, ''
  union all
  select 7, 'secret cron hors de cron.job (Vault)',
         case when cron_secret_en_clair is null then 'A VERIFIER'
              when cron_secret_en_clair = 0 then 'OK' else 'A CORRIGER' end,
         'script P, puis rotation du secret'
  from dyn
  union all
  select 8, 'deux jobs sync-bank planifies',
         case when cron_jobs_sync is null then 'A VERIFIER'
              when cron_jobs_sync = 2 then 'OK' else 'A VERIFIER' end,
         case when cron_jobs_sync is null then 'pg_cron absent' else cron_jobs_sync || ' job(s)' end
  from dyn
  union all
  select 9, 'second facteur TOTP enrole',
         case when facteurs_verifies is null then 'A VERIFIER'
              when facteurs_verifies > 0 then 'OK' else 'A CORRIGER' end,
         'ensuite : secret REQUIRE_MFA=1 sur les Edge Functions'
  from dyn
  union all
  select 10, 'un seul compte utilisateur',
         case when comptes is null then 'A VERIFIER'
              when comptes = 1 then 'OK' else 'A VERIFIER' end,
         coalesce(comptes::text, '?') || ' compte(s) : inscription a fermer si > 1'
  from dyn
)
select etat as resultat, controle, detail
from checks
order by (etat = 'OK'), ordre, controle;
