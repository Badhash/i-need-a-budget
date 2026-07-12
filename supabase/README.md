# Supabase — schema et deploiement

Le schema est versionne dans `/supabase/migrations` (jamais de modification
manuelle via le dashboard). L'integration GitHub du projet Supabase INAB
deploie automatiquement les nouvelles migrations a chaque push sur `main`.

## Reglages projet attendus

- Data API : activee (utilisee par supabase-js dans les Edge Functions et le ping quotidien)
- Automatically expose new tables : desactivee (aucun acces client direct aux tables)
- Automatic RLS : activee (filet de securite ; les migrations activent deja RLS explicitement)

## Modele d'acces et de chiffrement

- Zero champ metier en clair : chaque table est une enveloppe opaque
  (id, user_id, enc_payload AES-256-GCM, created_at) plus des index aveugles
  HMAC-SHA256 (month_idx, tx_hash, assign_idx, target_idx) pour les requetes.
- Sous-cles derivees de ENCRYPTION_KEY via HKDF : k_enc (payloads) et k_idx (index).
- References entre entites dans le payload chiffre ; integrite verifiee par /api.
- Le front n'accede JAMAIS aux tables : uniquement Auth + Realtime (signal sans payload).
- Toute lecture/ecriture passe par l'Edge Function `/api` (service role, dechiffrement en memoire).
- RLS par user_id sur toutes les tables en defense en profondeur.
- `anon` et `authenticated` n'ont aucun privilege sur les tables.
- Metadonnees residuelles assumees : nombre de lignes, horodatages, identifiants.

## Secrets Edge Functions a configurer (dashboard > Edge Functions > Secrets)

- `ENCRYPTION_KEY` : 32 bytes base64 (chiffrement AES-256-GCM)
- `ALLOWED_USER_EMAILS` : emails autorises, separes par des virgules (app
  mono-utilisateur : fortement recommande, refuse tout autre compte du projet)
- `ENABLE_BANKING_APP_ID` : identifiant de l'application Enable Banking
- `ENABLE_BANKING_PRIVATE_KEY` : cle privee RSA de l'application (JWT RS256)

Desactiver aussi les inscriptions : dashboard > Authentication > Sign In /
Up > "Allow new users to sign up" = OFF (le compte unique est cree a la main).

## Edge Function /api

Endpoint unique a actions typees (POST JSON `{ action, params }`, JWT
utilisateur obligatoire). Actions : `bootstrap`, `getBudgetMonth`,
`getTransactions`, `getReports`, `addTransaction`, `categorizeTransaction`,
`setAssigned`, `createAccount`, `seedDefaults`. Dechiffrement en memoire,
calculs via packages/engine, aucune donnee metier dans les logs.

Le signal Realtime est emis par trigger Postgres (broadcast vide sur le
topic prive `changes:<user_id>`, deduplique par transaction) ; le front
invalide ses queries a reception. Contrat d'abonnement exact :

```ts
supabase.channel(`changes:${userId}`, { config: { private: true } })
  .on('broadcast', { event: 'db-change' }, invalidateQueries)
  .subscribe()
```
(sans `private: true`, le join du canal prive est refuse silencieusement)

## CLI (optionnel, si deploiement manuel)

```bash
supabase link --project-ref <ref-du-projet>
supabase db push
```
