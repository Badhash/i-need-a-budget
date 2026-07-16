-- =====================================================================
-- REF D — Transport base64 de enc_payload (optimisation egress free tier)
-- =====================================================================
--
-- Objectif : reduire de ~33% le volume du trafic chiffre. PostgREST renvoie
-- les colonnes bytea en hexadecimal (\x..., 2 caracteres/octet). En exposant
-- encode(enc_payload,'base64') en LECTURE (computed columns) et en acceptant
-- decode(:b64,'base64') en ECRITURE (RPC), on passe a ~1,33 caractere/octet.
-- Le ciphertext STOCKE reste identique : seul l'encodage de transport change.
--
-- Script IDEMPOTENT : a coller tel quel dans le SQL Editor Supabase.
-- Le schema n'est pas versionne (source de verite = base de production).
--
-- IMPORTANT : tant que ce script n'est PAS applique, les Edge Functions /api
-- et sync-bank de cette revision NE SONT PAS DEPLOYABLES :
--   - les lectures selectionnent la computed column `enc_b64` (400 sinon) ;
--   - les ecritures appellent les RPC enc_insert / enc_update (404 sinon).
-- Appliquer ce SQL AVANT de deployer les fonctions.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) LECTURE — computed columns PostgREST : enc_b64 par table
--    Selectionnees cote client via `.select('id, enc_payload:enc_b64')`.
--    Surchargees par type composite (une fonction enc_b64 par table).
-- ---------------------------------------------------------------------
do $$
declare
  t text;
  tables constant text[] := array[
    'accounts','transactions','category_groups','categories',
    'assignments','targets','rules','bank_connections','sync_logs'
  ];
begin
  foreach t in array tables loop
    -- translate(..., E'\n', '') : encode(...,'base64') suit la RFC 2045 et insere
    -- un saut de ligne tous les 76 caracteres. On les retire cote serveur (le
    -- decodeur bytea les tolererait mais pas notre validation client, et ca
    -- economise aussi l'egress de ces \n).
    execute format(
      'create or replace function public.enc_b64(%I) returns text '
      || 'language sql stable as $f$ '
      || 'select translate(encode($1.enc_payload, %L), E''\n'', '''') $f$;',
      t, 'base64'
    );
    execute format('grant execute on function public.enc_b64(public.%I) to service_role;', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 2) ECRITURE — RPC generiques acceptant enc_payload en base64.
--    Colonnes et tables sur liste blanche ; valeurs passees par
--    quote_literal (pas d'injection). enc_payload decode en bytea via
--    decode(...,'base64'), user_id caste en uuid, index en text.
-- ---------------------------------------------------------------------

-- Insert / upsert (single ou batch). p_rows = tableau JSON d'objets dont
-- enc_payload est en base64. p_conflict = liste de colonnes (ex.
-- 'user_id,assign_idx') pour un ON CONFLICT DO UPDATE ; NULL pour un insert
-- simple. Retourne les ids inseres/mis a jour dans l'ordre.
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
    'user_id','enc_payload','month_idx','tx_hash','assign_idx','target_idx'
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
      elsif k = 'enc_payload' then
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

-- Update par id (une seule ligne). p_row = colonnes a mettre a jour, dont
-- enc_payload en base64. Filtre user_id + id (parite avec l'ancien
-- .update().eq('user_id').eq('id')).
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
  allowed_cols constant text[] := array['enc_payload','month_idx','tx_hash'];
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
    elsif k = 'enc_payload' then
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

-- Seul le service_role (Edge Functions) appelle ces RPC. anon / authenticated
-- n'ont aucun privilege (defense en profondeur, coherent avec les tables).
revoke all on function public.enc_insert(text, jsonb, text) from public;
revoke all on function public.enc_update(text, uuid, uuid, jsonb) from public;
grant execute on function public.enc_insert(text, jsonb, text) to service_role;
grant execute on function public.enc_update(text, uuid, uuid, jsonb) to service_role;

-- Recharge le cache de schema PostgREST (sinon computed columns / RPC absents).
notify pgrst, 'reload schema';
