-- REF F — Retention et volumetrie de sync_logs
--
-- But : borner la croissance de la table `sync_logs`. Un log est insere a chaque
-- run de sync-bank (~3/jour par cron). Seul le dernier statut `ok` par connexion
-- est utile a la logique (loadRecentSyncLogs lit desormais 50 lignes max) ; au-dela,
-- les vieux logs ne servent qu'a l'egress et a la taille DB du free tier.
--
-- run_at est stocke en clair (prevu par CLAUDE.md pour la retention), on peut donc
-- purger par date sans dechiffrement.
--
-- Ce script est IDEMPOTENT : rejouable sans effet de bord. Il (re)planifie un job
-- pg_cron quotidien qui supprime les logs de plus de 90 jours.
--
-- APPLICATION (SQL Editor du dashboard Supabase, une seule fois) :
--   1. Verifier que l'extension pg_cron est activee :
--        Dashboard > Database > Extensions > pg_cron = ON
--      (ou : create extension if not exists pg_cron;)
--   2. Coller l'integralite de ce fichier dans le SQL Editor et executer.
--   3. Verifier la planification :
--        select jobname, schedule, active from cron.job where jobname = 'purge-sync-logs';
--   4. (Optionnel) declencher une purge immediate pour vider l'existant :
--        delete from sync_logs where run_at < now() - interval '90 days';
--
-- Ne PAS appliquer ce SQL via un outil automatise : source de verite = base de prod.

-- Extension requise (no-op si deja presente).
create extension if not exists pg_cron;

-- Idempotence : retire une eventuelle planification precedente avant de recreer.
select cron.unschedule('purge-sync-logs')
where exists (select 1 from cron.job where jobname = 'purge-sync-logs');

-- Purge quotidienne a 03:15 UTC (heure creuse, hors fenetres de sync bancaire).
-- Retention : 90 jours glissants sur run_at (colonne en clair).
select cron.schedule(
  'purge-sync-logs',
  '15 3 * * *',
  $$ delete from sync_logs where run_at < now() - interval '90 days'; $$
);
