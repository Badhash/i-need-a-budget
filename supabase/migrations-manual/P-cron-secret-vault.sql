-- =============================================================================
-- P — Secret d'appel de sync-bank dans Supabase Vault (au lieu de cron.job)
-- A APPLIQUER dans le SQL Editor. Remplace les jobs crees par G-cron-2x.sql.
-- =============================================================================
--
-- G-cron-2x.sql ecrit le secret partage x-cron-secret EN CLAIR dans la commande
-- du job : il est stocke dans cron.job.command et recopie dans
-- cron.job_run_details.command a chaque execution. Toute personne qui lit la
-- base ou une sauvegarde peut alors declencher la synchro de tous les
-- utilisateurs (et epuiser le quota d'acces bancaires sans presence
-- utilisateur). Ici le job lit le secret dans Vault au moment de l'appel.
--
-- Prerequis : extensions pg_cron, pg_net et supabase_vault activees.
-- Remplacer <PROJECT_REF> et <SYNC_CRON_SECRET> (valeur du secret de la
-- fonction). Ne PAS commiter ce fichier avec de vraies valeurs.
--
-- Rotation du secret : changer le secret de la fonction dans le dashboard,
-- puis executer uniquement
--   select vault.update_secret(
--     (select id from vault.secrets where name = 'sync_cron_secret'),
--     '<NOUVEAU_SECRET>');

-- 1. Secret dans Vault (une seule fois ; voir la rotation ci-dessus ensuite).
select vault.create_secret('<SYNC_CRON_SECRET>', 'sync_cron_secret')
where not exists (select 1 from vault.secrets where name = 'sync_cron_secret');

-- 2. Retrait de TOUS les jobs sync-bank existants (anciens 3x/jour compris).
do $$
declare
  j record;
begin
  for j in select jobname from cron.job where jobname like 'sync-bank-%' loop
    perform cron.unschedule(j.jobname);
  end loop;
end;
$$;

-- 3. Re-creation des deux jobs, le secret etant lu dans Vault a l'execution.

-- 08:00 Europe/Paris (heure d'ete = 06:00 UTC ; hiver : 07:00 UTC).
select cron.schedule(
  'sync-bank-matin-2x',
  '0 6 * * *',
  $$
  select net.http_post(
    url     := 'https://<PROJECT_REF>.functions.supabase.co/sync-bank',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'sync_cron_secret')
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
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'sync_cron_secret')
    ),
    body    := jsonb_build_object('action', 'sync')
  );
  $$
);

-- 4. L'historique des executions contient encore l'ancien secret en clair.
delete from cron.job_run_details;

-- Verification : exactement deux jobs, dont la commande ne contient plus le
-- secret.
--   select jobname, schedule, command from cron.job where jobname like 'sync-bank-%';
--
-- Puis, par prudence, faire tourner le secret (il a ete stocke en clair) : voir
-- « Rotation du secret » en tete de fichier.
