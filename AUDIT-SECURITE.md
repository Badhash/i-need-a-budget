# Audit de sécurité — 24 novembre 2026

Revue en boîte blanche de tout le dépôt : front, Edge Functions, crypto, SQL, CI,
dépendances et historique git. Complète `AUDIT.md` (audit général du code), sans le
remplacer. Sévérité : Critique, Élevé, Moyen, Faible, Info. Les scores CVSS 3.1 sont
indicatifs.

## 1. Résumé

- **Aucune faille critique ni élevée.** Pas de contournement d'authentification, pas
  d'accès aux données d'un autre utilisateur, pas d'injection, pas de porte dérobée,
  pas d'identifiant en dur.
- **Aucun secret dans le dépôt ni dans son historique** (383 commits, toutes les
  branches).
- **Chiffrement en base sain** : une copie de la base seule ne permet de lire aucune
  donnée métier. Sa limite est décrite au § 4 : il ne protège pas d'une compromission
  en écriture de la base ni du compte Supabase.
- 6 constats moyens, 18 faibles, 10 informations. Sur les 24 premiers : **10 corrigés
  dans ce lot**, 1 en partie, 2 par un script SQL à appliquer, 11 ouverts qui demandent
  une décision ou un réglage hors dépôt (§ 6).
- Les trois risques qui restent, par ordre d'importance : le second facteur n'est pas
  exigé par défaut (S-02), la branche `main` déploie le code qui lit la clé sans
  protection (S-03), l'origine `github.io` est partagée avec les autres sites du compte
  (S-01).

## 2. Méthode et vérifications

| Vérification | Résultat |
|---|---|
| Secrets dans l'historique complet (JWT, clés privées, jetons Supabase/GitHub/AWS, clés base64 et hex, emails, IBAN, en-têtes d'autorisation) | Rien. Seul IBAN trouvé : fictif, dans les données de démo, hors du bundle de production |
| Lecture intégrale des deux Edge Functions, de la crypto, du SQL, des workflows, des fichiers sensibles du front | Constats ci-dessous |
| Injection SQL sur `enc_insert` / `enc_update` (table, colonne, valeur et clause de conflit piégées) | Rejetée dans les quatre cas, testée sur un Postgres local reconstruit depuis les scripts |
| Droits réels des rôles `anon` / `authenticated` (même Postgres local) | Tables et RPC refusées ; colonnes calculées exécutables via `public` (S-14, corrigé) |
| `npm audit` sur les trois lockfiles et sur `supabase-js` 2.119.0 (Edge Functions) | 0 vulnérabilité après mise à jour (20 alertes sur 9 paquets avant, toutes dans l'outillage de dev) |
| CSP dans un vrai navigateur : 7 pages × desktop et mobile × clair et sombre, ouverture d'un dialogue | 0 violation ; script inline, `eval`, script et connexion vers un hôte tiers bloqués |
| Service worker : retour bancaire `?code=…&state=…` | Absent du cache après correction, repli hors ligne fonctionnel |
| Tests moteur (48) et crypto (44), `deno check`, build du front | Verts |

Non vérifiable depuis le dépôt : l'état réel de la base de production et des réglages
Supabase et GitHub. Le script `Q-controle-securite.sql` couvre la base (§ 6).

## 3. Constats

### Moyen

| ID | Constat | Où | Statut |
|---|---|---|---|
| S-01 (6,8) | **Origine partagée.** Tous les sites GitHub Pages du compte partagent l'origine `<compte>.github.io`. Une faille sur n'importe lequel donne accès au jeton de session (`localStorage`) et au cache du service worker de cette app, et passe le CORS. | `app/src/lib/supabase.ts:51`, `app/public/sw.js` | Ouvert — domaine dédié à décider |
| S-02 (6,5) | **Second facteur non exigé par défaut.** Sans le secret `REQUIRE_MFA=1`, un compte sans TOTP enrôlé s'ouvre au mot de passe seul, et celui qui le connaît peut enrôler son propre facteur. | `supabase/functions/api/mfa.ts:40-42` | Ouvert — réglage (§ 6) |
| S-03 (6,6) | **Chaîne de déploiement.** Un push sur `main` déploie les Edge Functions, qui lisent `ENCRYPTION_KEY` et la clé `service_role`. `main` n'est pas protégée ; les actions GitHub et la CLI Supabase suivaient des références mobiles (`@v4`, branche `v1`, `latest`) : une publication compromise s'exécutait avec le jeton de compte Supabase. | `.github/workflows/*.yml` | Partiel — épinglage fait, protection de `main` à activer |
| S-04 (4,7) | **Pas de Content-Security-Policy.** Une dépendance compromise ou un script injecté pouvait envoyer le jeton et le budget déchiffré vers n'importe quel hôte. | `app/vite.config.ts:39` | Corrigé |
| S-05 (5,5) | **Sauvegardes en clair.** L'export écrit tout le budget déchiffré dans un fichier (Téléchargements, feuille de partage iOS, donc potentiellement iCloud). Une sauvegarde est aussi écrite avant chaque import. | `app/src/components/settings/data/download.ts:26` | Ouvert — phrase de passe à décider |
| S-06 (4,9) | **Limite du chiffrement en base** (conception). Voir § 4. | — | Risque résiduel à connaître |

### Faible

| ID | Constat | Où | Statut |
|---|---|---|---|
| S-07 | Outillage de dev vulnérable : vite 5.4.21 (8 avis, serveur de dev), vitest 2.1.9 et tinypool (exécution de code via l'interface de test), esbuild, postcss. Aucun n'atteint le bundle de production. | lockfiles | Corrigé (vite 6.4.6, vitest 4.1.12) |
| S-08 | `sync-bank` : le `state` signé du consentement était facultatif côté serveur, il suffisait de l'omettre. | `sync-bank/index.ts:1959` | Corrigé |
| S-09 | `sync-bank` : une origine inconnue recevait la première origine configurée, ou `null` (iframe sandbox, `file://`). | `sync-bank/index.ts:193` | Corrigé |
| S-10 | `sync-bank` (`verify_jwt = false`) : toute requête anonyme coûtait un appel au service Auth. | `sync-bank/index.ts:2298` | Corrigé |
| S-11 | `sync-bank` : l'URL de retour fournie par le client partait telle quelle vers la banque quand le secret n'est pas posé. | `sync-bank/index.ts:1827` | Corrigé (origine de l'app exigée) |
| S-12 | `sync-bank` : montants et contrepartie renvoyés par l'agrégateur sans borne. | `sync-bank/index.ts:626` | Corrigé |
| S-13 | Secret d'appel de la synchro en clair dans `cron.job` (script P non appliqué) ; le README recommandait encore cette méthode. | `sync-bank/README.md` | README corrigé, script P à appliquer |
| S-14 | Le script O ne retirait pas les droits des colonnes calculées : ils viennent de `public`, pas de `anon` / `authenticated`. Sans impact (ces fonctions n'encodent que la ligne reçue). | `migrations-manual/O-revoke-rpc-execute.sql` | Script révisé, à rejouer |
| S-15 | Service worker : l'URL de retour bancaire (`code`, `state`) devenait une clé de cache, conservée jusqu'au déploiement suivant. | `app/public/sw.js:136` | Corrigé |
| S-16 | `/api` : deux requêtes d'agrégats sans filtre `user_id` (non exploitable, l'id venait d'une lecture filtrée) ; réponses sans `Cache-Control: no-store` ; un message d'exception brut renvoyé au client. | `api/aggregates.ts:342,359`, `api/index.ts:4163,1865` | Corrigé |
| S-17 | Workflows : le ping n'avait aucun bloc `permissions`, le job de build de Pages recevait le droit d'écriture Pages et le jeton OIDC. | `.github/workflows` | Corrigé |
| S-18 | Les 400 premiers caractères d'une erreur Enable Banking sont renvoyés à l'utilisateur connecté. | `sync-bank/index.ts:550` | Ouvert |
| S-19 | Le second facteur se désactive d'un appui, sans nouveau code. | `app/src/components/settings/MfaSection.tsx:116` | Ouvert |
| S-20 | Synchro manuelle sans limite de fréquence (quota d'accès bancaires). | `sync-bank/index.ts` | Ouvert (SYNC-06) |
| S-21 | Polices chargées depuis Google : adresse IP transmise à chaque lancement, intégrité non vérifiable. | `app/index.html:29-34` | Ouvert — auto-hébergement |
| S-22 | Pas de `deno.lock` : les dépendances transitives de `supabase-js` sont résolues au déploiement. | `supabase/functions` | Ouvert |
| S-23 | Après déconnexion, la sauvegarde d'un import abandonné reste en mémoire dans l'onglet. | `app/src/App.tsx:156-163` | Ouvert |
| S-24 | Export et effacement complets sans nouvelle vérification : un jeton volé suffit pendant sa durée de vie (1 h). | `api/index.ts` (`exportData`, `importReplaceBegin`, `newBudget`) | Ouvert |

### Info

- L'autorisation repose sur une liste d'emails, sans contrôle de `email_confirmed_at`.
  Sans effet tant que le compte existe et que l'inscription est fermée.
- `http://localhost:5173` et `:4173` restent autorisés en CORS en production. Sans gain
  pour un attaquant : le jeton vit sous l'origine de l'app.
- Le repli de lecture `enc_payload` (ancien format) est maintenu : quelqu'un qui écrit
  en base sans la clé peut faire revenir une ligne à son contenu d'avant migration.
- Métadonnées lisibles en base, assumées : nombre de lignes, horodatages, longueur des
  chiffrés (pas de bourrage), regroupements par mois et par tiers, compteurs `rev`.
- Pas de rotation de clé prévue : l'enveloppe porte une version de format, pas
  d'identifiant de clé.
- Le script J crée une colonne `transactions.account_idx` qu'aucun code n'écrit.
- Le secret cron n'a pas de longueur minimale imposée (32 octets aléatoires conseillés).
- Détournement de clic : GitHub Pages n'envoie aucun en-tête, `frame-ancestors` est
  ignoré en balise meta. Risque faible, le stockage d'un cadre tiers est cloisonné par
  les navigateurs récents.
- Dépôt public : les commentaires nomment la banque utilisée, et les messages de commit
  portent des liens de session `claude.ai` (privés par défaut).
- `signOut()` ferme toutes les sessions : comportement favorable, à garder.

## 4. Chiffrement en base

**Ce qui est en place, et correct :**

- AES-256-GCM, IV aléatoire de 96 bits à chaque écriture, enveloppe versionnée.
- Deux sous-clés dérivées par HKDF-SHA256 d'une clé de 32 octets : chiffrement et index.
  La clé maîtresse est importée non extractible et son tampon effacé.
- Chaque chiffré est lié à sa table, à son utilisateur et à sa colonne (AAD) : un
  chiffré recopié ailleurs ne se déchiffre pas.
- Index aveugles en HMAC-SHA256 complet, domaines séparés, identifiant utilisateur
  inclus. Aucun champ métier en clair, y compris les sessions bancaires et les IBAN.
- La clé ne vit que dans les secrets des Edge Functions. Elle n'est ni dans la base, ni
  dans le dépôt, ni dans le front, ni dans les journaux.
- En transit : TLS partout ; signal Realtime sans contenu ; réponse du cron réduite à des
  compteurs.
- Volume : une clé unique reste très en dessous de la limite de 2^32 chiffrements à IV
  aléatoire.

**Ce que ça protège :** une fuite de la base en lecture (sauvegarde, export, injection
SQL, mot de passe Postgres en lecture). L'attaquant voit des enveloppes opaques.

**Ce que ça ne protège pas (S-06) :**

1. **Compromission en écriture** (clé `service_role`, mot de passe Postgres, compte
   Supabase). Les comptes et le second facteur vivent dans la même base : l'attaquant
   remplace le mot de passe, retire le TOTP, se connecte et laisse `/api` déchiffrer.
2. **Lecture seule + mot de passe faible.** Le hash du mot de passe et le secret TOTP
   sont dans la base. La confidentialité repose alors sur la robustesse du mot de
   passe : il doit être long, aléatoire et unique.
3. **Compte Supabase ou GitHub compromis.** Le premier lit les secrets des fonctions, le
   second déploie un code qui les exfiltre (S-03).

Ce n'est pas un chiffrement de bout en bout : le serveur déchiffre. L'interface le dit
correctement (« chiffré côté serveur »).

## 5. Dépendances et menaces actuelles

- **Exécution en production** (React 18.3.1, supabase-js 2.110.2 côté front et 2.119.0
  côté fonctions, TanStack, Recharts 2.15.4, lodash 4.18.1) : aucun avis connu au
  24 novembre 2026.
- La faille d'exécution de code des React Server Components (CVE-2025-55182) ne concerne
  pas ce projet : React 18, rendu client uniquement.
- **Chaîne d'approvisionnement npm** : lockfiles avec empreintes, tout vient de
  `registry.npmjs.org`, installation par `npm ci`. Deux paquets seulement ont un script
  d'installation (`esbuild`, `fsevents`).
- Recharts 2.x n'est plus maintenu (pas d'avis ouvert). Migration vers la v3 à prévoir.
- Dependabot est ajouté (mensuel, groupé) : sans lui, les actions épinglées par SHA ne
  recevraient plus de correctifs.

## 6. Reste à faire hors dépôt

Par ordre de priorité. Aucun point ne bloque l'usage.

1. **Supabase, SQL Editor** : coller `O-revoke-rpc-execute.sql`, puis
   `P-cron-secret-vault.sql`, puis `Q-controle-securite.sql`. Ce dernier répond `OK` ou
   `A CORRIGER` ligne par ligne. Faire tourner le secret cron ensuite.
2. **Second facteur** : l'enrôler dans Réglages, puis poser le secret `REQUIRE_MFA=1` sur
   les Edge Functions. Pas avant : sans TOTP enrôlé, l'accès serait refusé.
3. **GitHub** : protéger `main` (statut « Tests et typecheck » requis), activer le
   secret scanning avec push protection, vérifier que le compte a un second facteur.
   Option plus stricte : ranger les secrets de déploiement dans un environnement avec
   validation manuelle.
4. **Supabase, Authentication** : inscription fermée, mot de passe long et unique.
5. **Décisions** : domaine dédié (S-01), sauvegardes protégées par phrase de passe
   (S-05), polices auto-hébergées (S-21).

## 7. Correctifs de ce lot

| Zone | Contenu |
|---|---|
| CI | Actions épinglées par SHA de commit, CLI Supabase 3.3.0 et Deno 2.9.6 figés, permissions réduites au nécessaire, Dependabot |
| `sync-bank` | `state` obligatoire, CORS sans repli, pré-filtre du jeton, URL de retour contrôlée, montants bornés, réponses `no-store` |
| `/api` | Filtre `user_id` sur les écritures d'agrégats, réponses `no-store` et `nosniff`, message d'erreur statique |
| Front | CSP générée au build (empreinte des scripts inline recalculée), service worker sans `code` / `state` en cache, URL de consentement en `https` seulement |
| Dépendances | vite 6.4.6, vitest 4.1.12 : `npm audit` à 0 sur les trois lockfiles |
| SQL | Script O révisé, script de contrôle Q, README de `sync-bank` aligné sur Vault |

Note d'exploitation : `npm install` plante sur vitest 4 avec npm 10 (bogue de résolution
des dépendances paires). `npm ci` fonctionne ; pour modifier les dépendances de
`packages/*`, utiliser `npx npm@11 install`.
