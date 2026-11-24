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

- `startAuth { redirectUrl?, aspspName? }` (utilisateur) -> `{ url, state }`
  Construit le JWT RS256 EB, ouvre une session d'autorisation PSD2 et renvoie
  l'URL de redirection vers la banque. L'URL de retour est celle du secret
  `ENABLE_BANKING_REDIRECT_URL` ; a defaut, le `redirectUrl` du front n'est
  accepte que si son origine figure dans `ALLOWED_ORIGINS`. `aspspName` retombe
  sur le secret `ENABLE_BANKING_ASPSP_NAME` s'il est omis.
- `finalizeAuth { code, state }` (utilisateur) -> `{ ok: true, connectionId }`
  Verifie le `state` (OBLIGATOIRE : signe HMAC, lie a l'utilisateur, valable
  1 h), echange le `code` renvoye par la banque contre une session EB, puis
  chiffre et insere la `bank_connection` (session_id, comptes EB, `valid_until`).
- `sync { sinceDays? }` (utilisateur ou cron) -> `{ imported }`
  Poll des transactions depuis la derniere sync (ou la date d'activation de la
  connexion ; `sinceDays` force une fenetre plus profonde pour l'import initial,
  plafonnee a ~730 jours), mapping, dedup (`tx_hash`), categorisation par regles,
  insertion chiffree, appariement des prelevements carte a debit differe,
  journalisation dans `sync_logs`. Appariement entre un compte budget et un
  compte de suivi (transfert croise, regle YNAB) : la moitie cote budget garde
  la categorie posee a l'import ; entre deux comptes budget, transfert neutre
  sans categorie. Un compte clos n'est plus synchronise.
- `reconcile {}` (utilisateur ou cron) -> recale le solde d'ouverture de chaque
  compte lie (hors comptes clos) pour que le solde local corresponde au solde
  reel Enable Banking. Enchaine automatiquement apres un `sync` declenche avec
  `sinceDays`.

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

Deux syncs par jour (matin et soir, heure de Paris). Le script de reference est
`supabase/migrations-manual/P-cron-secret-vault.sql` : il range le secret
partage dans Supabase Vault et le job le lit au moment de l'appel.

Ne PAS ecrire le secret en dur dans la commande du job (ancienne methode de ce
README et de `G-cron-2x.sql`) : il resterait en clair dans `cron.job` et dans
`cron.job_run_details`, lisible par quiconque lit la base ou une sauvegarde.

Le secret `SYNC_CRON_SECRET` doit etre long et aleatoire (32 octets ou plus,
par exemple `openssl rand -base64 32`). Rotation : voir l'en-tete du script P.

Decalage heure d'ete / hiver : pg_cron s'execute en UTC, les horaires du script
sont donnes pour l'heure d'ete de Paris (une heure plus tot en hiver).

Pour retirer un job : `select cron.unschedule('sync-bank-matin-2x');` (idem
`sync-bank-soir-2x`).

## Flow de consentement (cote front)

1. L'utilisateur clique sur "Connecter ma banque". Le front appelle
   `startAuth { redirectUrl }` et recoit `{ url }`.
2. Redirection du navigateur vers `url` (page de la banque, authentification
   forte PSD2).
3. La banque redirige vers `redirectUrl` avec un parametre `code` et le `state`
   d'origine.
4. Le front recupere `code` et `state` et appelle `finalizeAuth { code, state }`
   (un retour sans `state` est refuse). La `bank_connection` est creee
   (chiffree) avec `valid_until` a 90 jours.
5. L'utilisateur lie ensuite chaque compte EB (`uid`) a un compte interne en
   renseignant `providerAccountUid` (cote Edge Function `/api`). Sans liaison, un
   compte EB est ignore par `sync`.

## Re-consentement (expiration a 90 jours)

Les sessions EB expirent au bout de 90 jours (`valid_until`). Le front doit
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
