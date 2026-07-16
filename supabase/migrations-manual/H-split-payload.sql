-- REF H : split de transactions.enc_payload en deux colonnes chiffrees
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
