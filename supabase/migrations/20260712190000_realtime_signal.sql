-- Signal Realtime SANS payload sensible (CLAUDE.md, architecture de
-- chiffrement) : chaque ecriture emet un broadcast vide sur le topic prive
-- 'changes:<user_id>'. A reception, le front invalide ses queries TanStack
-- et refetch via l'Edge Function /api. Aucune donnee metier ne transite.

create or replace function public.notify_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := coalesce(new.user_id, old.user_id);
begin
  begin
    -- Deduplication par transaction : un import de 50 lignes emet UN seul
    -- broadcast (set_config local=true est remis a zero en fin de transaction).
    if current_setting('inab.rt_notified', true) is distinct from uid::text then
      perform set_config('inab.rt_notified', uid::text, true);
      perform realtime.send('{}'::jsonb, 'db-change', 'changes:' || uid::text, true);
    end if;
  exception when others then
    -- le signal est best effort : ne jamais bloquer une ecriture
    null;
  end;
  return coalesce(new, old);
end;
$$;

create trigger notify_change after insert or update or delete on public.accounts
  for each row execute function public.notify_change();
create trigger notify_change after insert or update or delete on public.category_groups
  for each row execute function public.notify_change();
create trigger notify_change after insert or update or delete on public.categories
  for each row execute function public.notify_change();
create trigger notify_change after insert or update or delete on public.transactions
  for each row execute function public.notify_change();
create trigger notify_change after insert or update or delete on public.assignments
  for each row execute function public.notify_change();
create trigger notify_change after insert or update or delete on public.targets
  for each row execute function public.notify_change();
create trigger notify_change after insert or update or delete on public.rules
  for each row execute function public.notify_change();
create trigger notify_change after insert or update or delete on public.bank_connections
  for each row execute function public.notify_change();
create trigger notify_change after insert or update or delete on public.sync_logs
  for each row execute function public.notify_change();

-- Reception : un utilisateur authentifie ne recoit que son propre topic.
create policy "receive own changes" on realtime.messages
  for select to authenticated
  using (
    realtime.messages.extension = 'broadcast'
    and realtime.topic() = 'changes:' || (select auth.uid()::text)
  );
