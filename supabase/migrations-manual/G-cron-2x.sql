-- REF G — Optimisation Supabase free tier : sync-bank 2x/jour au lieu de 3x.
--
-- Objectif : reduire d'un tiers le nombre d'invocations Edge Function et de
-- requetes vers Enable Banking, en passant de 3 syncs quotidiennes
-- (07:30 / 12:30 / 19:30) a 2 (08:00 / 20:00 Europe/Paris).
--
-- APPLICATION (non versionnee — a coller telle quelle dans le SQL Editor du
-- dashboard Supabase, source de verite du schema). Ce script est IDEMPOTENT :
--   1. supprime les trois anciens jobs (matin / midi / soir) s'ils existent ;
--   2. supprime les deux nouveaux jobs s'ils existent deja (re-execution sure) ;
--   3. re-cree les deux jobs a 08:00 et 20:00.
-- Remplacer <PROJECT_REF> et <SYNC_CRON_SECRET> AVANT execution. Ne PAS
-- committer ce SQL rempli (le secret ne doit jamais toucher le depot).
--
-- DST (heure d'ete/hiver) : par defaut pg_cron s'execute en UTC. Les heures UTC
-- ci-dessous valent pour l'heure d'ETE de Paris (UTC+2) :
--   08:00 Paris -> 06:00 UTC ; 20:00 Paris -> 18:00 UTC.
-- En hiver (Paris UTC+1), AJOUTER 1h a chaque heure UTC (07:00 / 19:00 UTC),
-- OU fixer une fois pour toutes `cron.timezone = 'Europe/Paris'` dans la
-- configuration Postgres et exprimer le cron en heure locale (08:00 / 20:00).

-- Extensions (au cas ou — sans effet si deja presentes).
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- 1. Retrait des anciens jobs 3x/jour (idempotent : ignore l'absence).
do $$
declare
  job text;
begin
  foreach job in array array[
    'sync-bank-matin',
    'sync-bank-midi',
    'sync-bank-soir'
  ]
  loop
    if exists (select 1 from cron.job where jobname = job) then
      perform cron.unschedule(job);
    end if;
  end loop;
end;
$$;

-- 2. Retrait des nouveaux jobs s'ils existaient deja (re-execution sure).
do $$
declare
  job text;
begin
  foreach job in array array[
    'sync-bank-matin-2x',
    'sync-bank-soir-2x'
  ]
  loop
    if exists (select 1 from cron.job where jobname = job) then
      perform cron.unschedule(job);
    end if;
  end loop;
end;
$$;

-- 3. Re-creation des deux jobs.

-- 08:00 Europe/Paris (heure d'ete = 06:00 UTC ; hiver : 07:00 UTC).
select cron.schedule(
  'sync-bank-matin-2x',
  '0 6 * * *',
  $$
  select net.http_post(
    url     := 'https://<PROJECT_REF>.functions.supabase.co/sync-bank',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', '<SYNC_CRON_SECRET>'
    ),
    body    := jsonb_build_object('action', 'sync')
  );
  $$
);

-- 20:00 Europe/Paris (heure d'ete = 18:00 UTC ; hiver : 19:00 UTC).
select cron.schedule(
  'sync-bank-soir-2x',
  '0 18 * * *',
  $$
  select net.http_post(
    url     := 'https://<PROJECT_REF>.functions.supabase.co/sync-bank',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', '<SYNC_CRON_SECRET>'
    ),
    body    := jsonb_build_object('action', 'sync')
  );
  $$
);

-- Verification : doit renvoyer exactement les deux jobs *-2x.
--   select jobname, schedule from cron.job where jobname like 'sync-bank-%';
--
-- Retrait complet (si besoin) :
--   select cron.unschedule('sync-bank-matin-2x');
--   select cron.unschedule('sync-bank-soir-2x');
