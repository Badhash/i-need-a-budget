-- REF H : split de transactions.enc_payload en deux colonnes chiffrees
-- (COMPOSE avec REF D : transport base64)
-- ---------------------------------------------------------------------------
-- Ce script se COMPOSE avec D-transport-base64.sql (deja applique en prod) :
--   - il AJOUTE les computed columns base64 `enc_core_b64` / `enc_text_b64` sur
--     transactions (memes que `enc_b64` de D, mais sur enc_core / enc_text) ;
--   - il RE-CREE les RPC `enc_insert` / `enc_update` de D en ajoutant 'enc_core'
--     et 'enc_text' a leurs listes blanches de colonnes, base64-decodees comme
--     enc_payload (decode(...,'base64')).
-- ORDRE DE DEPLOIEMENT : appliquer ce SQL AVANT de deployer les Edge Functions
-- de cette revision (lectures via enc_core_b64/enc_text_b64, ecritures via les
-- RPC etendues), PUIS lancer le backfill migrateSplitPayload.
-- ---------------------------------------------------------------------------
-- Objectif (optimisation egress Supabase free tier) :
--   enc_core  = champs legers {accountId, categoryId, bookingDate, bookingMonth,
--               amount, transferGroupId}, lus par le moteur budget, les rapports,
--               le bootstrap et le calcul des soldes.
--   enc_text  = champs lourds {label, counterparty, notes}, lus uniquement par la
--               liste des transactions et les top-marchands des rapports.
-- Les deux colonnes restent CHIFFREES (AES-256-GCM) : zero champ metier en clair.
-- Chaque ciphertext est lie par AAD a [table, colonne, userId] (voir packages/crypto,
-- contextes ['transactions','core',userId] / ['transactions','text',userId]) : un
-- ciphertext recopie d'une colonne a l'autre ne se dechiffre pas.
--
-- Ce script est IDEMPOTENT : il peut etre rejoue sans effet de bord.
-- A APPLIQUER dans le SQL Editor (schema non versionne, source de verite = prod).
-- ---------------------------------------------------------------------------

-- 1) Nouvelles colonnes chiffrees (NULL par defaut : les lignes existantes n'ont
--    encore que enc_payload et seront rechiffrees par le backfill applicatif).
alter table public.transactions add column if not exists enc_core bytea;
alter table public.transactions add column if not exists enc_text bytea;

-- 2) enc_payload devient NULLABLE : les NOUVELLES lignes n'ecrivent plus que
--    enc_core + enc_text. Sans cela, tout insert scinde violerait le NOT NULL.
alter table public.transactions alter column enc_payload drop not null;

-- 3) Garde-fou : une ligne doit toujours porter au moins UN payload dechiffrable,
--    soit la forme scindee (enc_core), soit la forme legacy (enc_payload). Empeche
--    une ligne totalement vide (aucun moyen de la dechiffrer).
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'transactions_payload_present'
  ) then
    alter table public.transactions
      add constraint transactions_payload_present
      check (enc_core is not null or enc_payload is not null);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 4) TRANSPORT BASE64 (REF D) POUR enc_core / enc_text
-- ---------------------------------------------------------------------------
-- Computed columns PostgREST : exposent enc_core / enc_text en base64 (comme
-- enc_b64 de D pour enc_payload), selectionnees via
--   .select('id, enc_core:enc_core_b64, enc_text:enc_text_b64, ...').
-- translate(..., E'\n', '') retire les sauts de ligne RFC 2045 (voir D).
create or replace function public.enc_core_b64(public.transactions)
  returns text language sql stable as $f$
    select translate(encode($1.enc_core, 'base64'), E'\n', '')
  $f$;
grant execute on function public.enc_core_b64(public.transactions) to service_role;

create or replace function public.enc_text_b64(public.transactions)
  returns text language sql stable as $f$
    select translate(encode($1.enc_text, 'base64'), E'\n', '')
  $f$;
grant execute on function public.enc_text_b64(public.transactions) to service_role;

-- RE-CREATION des RPC d'ecriture de D en AJOUTANT enc_core / enc_text a la
-- liste blanche des colonnes, base64-decodees comme enc_payload. Le reste est
-- IDENTIQUE a D-transport-base64.sql (quote_literal, user_id::uuid, ON CONFLICT).
create or replace function public.enc_insert(
  p_table text,
  p_rows jsonb,
  p_conflict text default null
) returns uuid[]
language plpgsql
as $$
declare
  allowed_tables constant text[] := array[
    'accounts','transactions','category_groups','categories',
    'assignments','targets','rules','bank_connections','sync_logs'
  ];
  allowed_cols constant text[] := array[
    'user_id','enc_payload','enc_core','enc_text','month_idx','tx_hash','assign_idx','target_idx'
  ];
  rec jsonb;
  k text;
  col_list text;
  val_list text;
  set_list text;
  conflict_cols text[];
  conflict_sql text;
  sql text;
  new_id uuid;
  ids uuid[] := array[]::uuid[];
begin
  if not (p_table = any(allowed_tables)) then
    raise exception 'table non autorisee: %', p_table;
  end if;

  if p_conflict is not null then
    conflict_cols := string_to_array(replace(p_conflict, ' ', ''), ',');
    select string_agg(quote_ident(c), ', ')
      into conflict_sql
      from unnest(conflict_cols) as c;
  end if;

  for rec in select value from jsonb_array_elements(p_rows) loop
    col_list := '';
    val_list := '';
    set_list := '';
    for k in select jsonb_object_keys(rec) loop
      if not (k = any(allowed_cols)) then
        raise exception 'colonne non autorisee: %', k;
      end if;
      if col_list <> '' then
        col_list := col_list || ', ';
        val_list := val_list || ', ';
      end if;
      col_list := col_list || quote_ident(k);
      if rec->>k is null then
        val_list := val_list || 'NULL';
      elsif k in ('enc_payload', 'enc_core', 'enc_text') then
        val_list := val_list || 'decode(' || quote_literal(rec->>k) || ', ' || quote_literal('base64') || ')';
      elsif k = 'user_id' then
        val_list := val_list || quote_literal(rec->>k) || '::uuid';
      else
        val_list := val_list || quote_literal(rec->>k);
      end if;
      if p_conflict is not null and not (k = any(conflict_cols)) then
        if set_list <> '' then set_list := set_list || ', '; end if;
        set_list := set_list || quote_ident(k) || ' = excluded.' || quote_ident(k);
      end if;
    end loop;

    sql := 'insert into public.' || quote_ident(p_table)
        || ' (' || col_list || ') values (' || val_list || ')';
    if p_conflict is not null then
      if set_list = '' then
        sql := sql || ' on conflict (' || conflict_sql || ') do nothing';
      else
        sql := sql || ' on conflict (' || conflict_sql || ') do update set ' || set_list;
      end if;
    end if;
    sql := sql || ' returning id';

    execute sql into new_id;
    ids := array_append(ids, new_id);
  end loop;

  return ids;
end;
$$;

create or replace function public.enc_update(
  p_table text,
  p_user uuid,
  p_id uuid,
  p_row jsonb
) returns void
language plpgsql
as $$
declare
  allowed_tables constant text[] := array[
    'accounts','transactions','category_groups','categories',
    'assignments','targets','rules','bank_connections','sync_logs'
  ];
  allowed_cols constant text[] := array['enc_payload','enc_core','enc_text','month_idx','tx_hash'];
  k text;
  set_list text := '';
  sql text;
begin
  if not (p_table = any(allowed_tables)) then
    raise exception 'table non autorisee: %', p_table;
  end if;

  for k in select jsonb_object_keys(p_row) loop
    if not (k = any(allowed_cols)) then
      raise exception 'colonne non autorisee: %', k;
    end if;
    if set_list <> '' then set_list := set_list || ', '; end if;
    if p_row->>k is null then
      set_list := set_list || quote_ident(k) || ' = NULL';
    elsif k in ('enc_payload', 'enc_core', 'enc_text') then
      set_list := set_list || quote_ident(k) || ' = decode(' || quote_literal(p_row->>k) || ', ' || quote_literal('base64') || ')';
    else
      set_list := set_list || quote_ident(k) || ' = ' || quote_literal(p_row->>k);
    end if;
  end loop;

  if set_list = '' then
    return;
  end if;

  sql := 'update public.' || quote_ident(p_table) || ' set ' || set_list
      || ' where user_id = ' || quote_literal(p_user::text) || '::uuid'
      || ' and id = ' || quote_literal(p_id::text) || '::uuid';
  execute sql;
end;
$$;

-- Privileges : identiques a D (seul service_role appelle ces RPC).
revoke all on function public.enc_insert(text, jsonb, text) from public;
revoke all on function public.enc_update(text, uuid, uuid, jsonb) from public;
grant execute on function public.enc_insert(text, jsonb, text) to service_role;
grant execute on function public.enc_update(text, uuid, uuid, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- BACKFILL (rechiffrement des lignes existantes)
-- ---------------------------------------------------------------------------
-- Le rechiffrement NE PEUT PAS se faire en SQL : la cle ENCRYPTION_KEY n'existe
-- que dans les Edge Functions. Il est realise par l'action serveur
--   POST /functions/v1/api  { "action": "migrateSplitPayload" }
-- (JWT utilisateur), qui traite les lignes par lots de 200 : dechiffre l'ancien
-- enc_payload, reecrit enc_core + enc_text et remet enc_payload a NULL, sans
-- toucher month_idx ni tx_hash. Idempotente : rappeler l'action ne retouche
-- aucune ligne deja migree (filtre enc_core IS NULL). Retourne { migrated }.
--
-- Verification de l'avancement (nombre de lignes encore en forme legacy) :
--   select count(*) from public.transactions
--   where enc_core is null and enc_payload is not null;
--
-- ---------------------------------------------------------------------------
-- BASCULE FINALE (OPTIONNELLE, une fois migrated == 0 et le recul suffisant)
-- ---------------------------------------------------------------------------
-- Quand plus aucune ligne legacy ne subsiste, on peut durcir le schema et
-- liberer le stockage. NE PAS jouer tant que du code lisant enc_payload en
-- fallback est encore deploye.
--
--   alter table public.transactions
--     drop constraint if exists transactions_payload_present;
--   alter table public.transactions
--     add constraint transactions_core_present check (enc_core is not null);
--   alter table public.transactions drop column enc_payload;
--
-- (laisse en commentaire : bascule manuelle et differee, pas dans ce passage)

-- Recharge le cache de schema PostgREST (computed columns + RPC modifiees).
notify pgrst, 'reload schema';
