# Supabase — acces et chiffrement

Le schema est applique directement au projet (SQL Editor). Le depot ne versionne
plus de migrations : la source de verite du schema est la base de production.

## Reglages projet attendus

- Data API : activee (utilisee par supabase-js dans les Edge Functions ; le front
  ne s'en sert QUE pour l'Auth et le Realtime, jamais pour lire les tables).
- Automatically expose new tables : desactivee (aucun acces client direct aux tables).
- Automatic RLS : activee (filet de securite ; le schema active deja RLS partout).

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

## Secrets Edge Functions a configurer (dashboard > Edge Functions > Secrets)

- `ENCRYPTION_KEY` : 32 bytes base64 (chiffrement AES-256-GCM)
- `ALLOWED_USER_EMAILS` : emails autorises, separes par des virgules (OBLIGATOIRE, fail-closed)
- `ALLOWED_ORIGINS` : origines web autorisees pour le CORS (ex. URL GitHub Pages du projet)
- `ENABLE_BANKING_APP_ID` / `ENABLE_BANKING_PRIVATE_KEY` : app Enable Banking (JWT RS256)

Desactiver les inscriptions : Authentication > Sign In / Up > "Allow new users to
sign up" = OFF (compte unique cree a la main).

## Edge Function /api

Endpoint unique a actions typees (POST JSON `{ action, params }`, JWT obligatoire).
Actions : bootstrap, getBudgetMonth, getTransactions, getReports, addTransaction,
categorizeTransaction, setAssigned, createAccount, seedDefaults. Dechiffrement en
memoire, calculs via packages/engine, aucune donnee metier dans les logs.

Signal Realtime : broadcast vide sur le topic prive `changes:<user_id>`, deduplique
par transaction. Le front s'abonne ainsi :

    supabase.channel(`changes:${userId}`, { config: { private: true } })
      .on('broadcast', { event: 'db-change' }, invalidateQueries)
      .subscribe()

(sans `private: true`, le join du canal prive est refuse silencieusement)
