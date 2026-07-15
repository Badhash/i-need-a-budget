# Edge Function sync-bank (Enable Banking)

> NON TESTE — implementation conforme a la doc Enable Banking, a valider une fois
> l'app Enable Banking approuvee (production restreinte). Chaque hypothese sur la
> forme des reponses de l'API EB est commentee "HYP EB" dans `index.ts`.

Synchronisation bancaire PSD2 via Enable Banking. Endpoint unique
`POST /functions/v1/sync-bank` avec un corps `{ action, params }`.

`verify_jwt = false` cote plateforme (voir `supabase/config.toml`) : la fonction
verifie a la main l'identite. Deux modes d'appel :

- Mode utilisateur : header `Authorization: Bearer <JWT Supabase>`. Le JWT est
  valide (`auth.getUser`) puis l'email est confronte a l'allowlist
  `ALLOWED_USER_EMAILS`. Agit uniquement sur cet utilisateur.
- Mode cron : header `x-cron-secret: <SYNC_CRON_SECRET>` (non vide). Agit sur
  TOUS les utilisateurs ayant au moins une connexion bancaire. Utilise par
  pg_cron / pg_net (voir plus bas).

## Actions

- `startAuth { redirectUrl?, aspspName? }` (utilisateur) -> `{ url }`
  Construit le JWT RS256 EB, ouvre une session d'autorisation PSD2 et renvoie
  l'URL de redirection vers la banque. `redirectUrl` et `aspspName` retombent sur
  les secrets `ENABLE_BANKING_REDIRECT_URL` / `ENABLE_BANKING_ASPSP_NAME` si
  omis.
- `finalizeAuth { code }` (utilisateur) -> `{ ok: true, connectionId }`
  Echange le `code` renvoye par la banque contre une session EB, puis chiffre et
  insere la `bank_connection` (session_id, comptes EB, `valid_until`).
- `sync { sinceDays? }` (utilisateur ou cron) -> `{ imported }`
  Poll des transactions depuis la derniere sync (ou la date d'activation de la
  connexion ; `sinceDays` force une fenetre plus profonde pour l'import initial,
  plafonnee a ~730 jours), mapping, dedup (`tx_hash`), categorisation par regles,
  insertion chiffree, appariement des prelevements carte a debit differe,
  journalisation dans `sync_logs`.
- `reconcile {}` (utilisateur ou cron) -> recale le solde d'ouverture de chaque
  compte lie pour que le solde local corresponde au solde reel Enable Banking.
  Enchaine automatiquement apres un `sync` declenche avec `sinceDays`.

## Secrets Edge a configurer (dashboard Supabase > Edge Functions > Secrets)

Specifiques a sync-bank :

- `ENABLE_BANKING_APP_ID` — identifiant de l'application EB (utilise comme `kid`
  du JWT RS256).
- `ENABLE_BANKING_PRIVATE_KEY` — cle privee EB au format PEM PKCS8
  (`-----BEGIN PRIVATE KEY-----`). Sert a signer le JWT (RSASSA-PKCS1-v1_5
  SHA-256).
- `ENABLE_BANKING_ASPSP_NAME` — nom de l'ASPSP (banque) tel qu'attendu par EB.
- `ENABLE_BANKING_REDIRECT_URL` — URL de retour du flow de consentement (page du
  front qui recueille le `code`).
- `SYNC_CRON_SECRET` — secret partage pour le declenchement pg_cron. Doit etre
  long et aleatoire. Si absent/vide, le mode cron est desactive (fail-closed).

Secrets partages deja requis par l'ensemble des Edge Functions :

- `ENCRYPTION_KEY` — cle maitre (32 octets base64), source du chiffrement.
- `ALLOWED_USER_EMAILS` — allowlist mono-utilisateur (fail-closed).
- `ALLOWED_ORIGINS` — origines CORS autorisees (facultatif hors localhost).
- `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` — injectes
  automatiquement par la plateforme, mais requis par la fonction.

Ne jamais committer ces valeurs. La cle `ENCRYPTION_KEY` doit AUSSI etre
sauvegardee hors Supabase par l'utilisateur (gestionnaire de mots de passe).

## Planification pg_cron + pg_net

A coller dans le SQL Editor du dashboard. Planifie trois syncs par jour a
07:30 / 12:30 / 19:30 Europe/Paris.

IMPORTANT (decalage DST) : par defaut pg_cron s'execute en UTC. Les heures ci-
dessous sont donnees pour l'heure d'ETE de Paris (UTC+2) : 07:30 -> 05:30 UTC,
12:30 -> 10:30 UTC, 19:30 -> 17:30 UTC. En hiver (Paris UTC+1) il faut AJOUTER
1h a chaque heure UTC (06:30 / 11:30 / 18:30 UTC), ou bien fixer une fois pour
toutes `cron.timezone = 'Europe/Paris'` dans la configuration Postgres et
exprimer le cron directement en heure locale.

```sql
-- Extensions (une seule fois par projet).
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Remplacer <PROJECT_REF> par la ref du projet et <SYNC_CRON_SECRET> par le
-- secret configure cote Edge Function. Ne PAS committer ce SQL rempli.

-- 07:30 Europe/Paris (heure d'ete = 05:30 UTC ; hiver : 06:30 UTC)
select cron.schedule(
  'sync-bank-matin',
  '30 5 * * *',
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

-- 12:30 Europe/Paris (ete = 10:30 UTC ; hiver : 11:30 UTC)
select cron.schedule(
  'sync-bank-midi',
  '30 10 * * *',
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

-- 19:30 Europe/Paris (ete = 17:30 UTC ; hiver : 18:30 UTC)
select cron.schedule(
  'sync-bank-soir',
  '30 17 * * *',
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
```

Pour retirer un job : `select cron.unschedule('sync-bank-matin');` (idem midi /
soir).

## Flow de consentement (cote front)

1. L'utilisateur clique sur "Connecter ma banque". Le front appelle
   `startAuth { redirectUrl }` et recoit `{ url }`.
2. Redirection du navigateur vers `url` (page de la banque, authentification
   forte PSD2).
3. La banque redirige vers `redirectUrl` avec un parametre `code` (et le `state`
   d'origine).
4. Le front recupere le `code` et appelle `finalizeAuth { code }`. La
   `bank_connection` est creee (chiffree) avec `valid_until` a 180 jours.
5. L'utilisateur lie ensuite chaque compte EB (`uid`) a un compte interne en
   renseignant `providerAccountUid` (cote Edge Function `/api`). Sans liaison, un
   compte EB est ignore par `sync`.

## Re-consentement (expiration a 180 jours)

Les sessions EB expirent au bout de 180 jours (`valid_until`). Le front doit
afficher une banniere de re-consentement des J-14 avant l'expiration (comparer
`valid_until` de la connexion, expose par l'action `/api getBankConnections`,
statut `expiring`), avec un bouton "Reconnecter" qui relance le flow ci-dessus
(`startAuth` -> redirection -> `finalizeAuth`). Une session expiree passe au
statut `expired` et sa `sessionState` doit etre remise a `active` par un nouveau
`finalizeAuth`.

## Dedup et incrementalite

- `tx_hash = HMAC(compte interne + booking_date + montant centimes + libelle
  normalise)` (cf. `packages/crypto`, `txHashIdx`). Les transactions dont le hash
  existe deja (en base ou deja inserees dans le meme run) sont ignorees.
- Date de depart d'un poll : derniere sync (`sync_logs.run_at`, en clair) moins
  7 jours de recouvrement, bornee a la date d'activation de la connexion
  (`bank_connections.created_at`). Jamais avant l'activation : seules les
  transactions posterieures sont importees (le solde d'ouverture est saisi
  manuellement). Le recouvrement volontaire ne coute que de la bande passante,
  la dedup garantit la justesse.
