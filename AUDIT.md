# Audit du code — novembre 2026

Revue complète du dépôt (front, Edge Functions, moteur, crypto, SQL, CI) : failles,
bugs et optimisations. Ce document liste **tous** les constats, ce qui a été corrigé
sur la branche `claude/fervent-euler-5e07sf`, et ce qui reste à faire.

## 1. Synthèse

- 120 constats distincts sur 11 zones (un même défaut signalé par deux relectures
  ne compte qu'une fois). Aucune faille critique : pas de contournement
  d'authentification, pas d'accès aux données d'un autre utilisateur, pas de fuite de
  données déchiffrées, primitives de chiffrement saines.
- 48 corrigés, 8 corrigés en partie, 2 couverts par un script SQL fourni à appliquer,
  62 ouverts : 4 de sévérité haute, 27 moyenne, 31 basse.
- Les trois problèmes les plus lourds étaient fonctionnels, pas des failles :
  1. **Synchro bancaire** : après un re-consentement, plus rien n'était importé, en
     silence ; deux opérations identiques le même jour n'en donnaient qu'une.
  2. **Egress** : un dialogue monté en permanence faisait retélécharger tout
     l'historique des transactions à chaque réconciliation, depuis n'importe quelle page.
  3. **Agrégats** : plusieurs chemins d'échec pouvaient laisser le marqueur « ready »
     sur des chiffres faux.

### Vérifications faites

| Vérification | Résultat |
|---|---|
| Tests du moteur (`packages/engine`) | 42 sur 42 |
| Tests de la crypto (`packages/crypto`) | 38 sur 38 (un test ajouté) |
| Typecheck `packages/crypto` | passait en échec sous TypeScript 5.9, corrigé |
| `deno check` des deux Edge Functions | 3 erreurs avant, 0 après |
| Typecheck et build du front | OK |
| `npm audit --omit=dev` (front) | 1 critique avant (`seroval`), 0 après |
| Workflow `ci.yml` sur GitHub | vert sur cette branche |
| App en mode démo dans un navigateur | 8 pages chargées (desktop et mobile), 0 erreur console ; assignation testée |

### Ce qui n'a pas pu être vérifié

- **La base de production.** Le schéma n'est pas versionné : RLS des 9 tables d'origine,
  droits, index, triggers Realtime et contenu de `cron.job` n'ont pas pu être contrôlés.
  Les requêtes de contrôle sont à la fin de `supabase/migrations-manual/O-revoke-rpc-execute.sql`.
- **Enable Banking en réel.** Les correctifs de la synchro sont typés et testés sur leur
  logique isolée, pas contre l'API de la banque. Le code d'origine marque lui-même ses
  hypothèses « HYP EB ».
- **Les Edge Functions déployées.** Rien n'a été déployé : les correctifs serveur
  prennent effet au prochain déploiement (fusion sur `main`).

## 2. Statut de la mise en production

Tout ce qui ne demande aucun accès à Supabase est sur `main`, **un commit par
correction** : chacune s'annule seule avec `git revert <commit>`. Les workflows
déploient au push : Pages pour le front, Edge Functions pour `/api` et `sync-bank`
(après les tests, voir `ci.yml`).

**Reste à faire dès que tu auras accès à Supabase** (rien n'est bloquant pour l'app) :

1. **Appliquer deux scripts dans le SQL Editor** (voir `RUNBOOK.md`) :
   `O-revoke-rpc-execute.sql` (droits des RPC), puis `P-cron-secret-vault.sql` (le
   secret d'appel de la synchro est aujourd'hui en clair dans `cron.job`). Faire
   tourner ce secret ensuite. Les deux fichiers sont dans le dépôt mais **ne sont pas
   appliqués**.
2. **Lancer les 5 requêtes de contrôle** de la fin du script O et comparer aux valeurs
   attendues indiquées en commentaire.
3. **Vérifier dans le dashboard Supabase** : inscription fermée (« Allow new users to
   sign up » désactivé), second facteur TOTP bien enrôlé sur ton compte,
   `ALLOWED_ORIGINS` renseigné (le correctif CORS suppose qu'il l'est, ce que
   l'app en production implique déjà).
4. **Après le premier run de synchro** : contrôler dans Réglages > Banque que les
   comptes sont toujours associés et qu'un import arrive.

## 3. Corrections livrées

Une correction = un commit. `git log --oneline` les liste, regroupées par portée :

| Portée | Contenu |
|---|---|
| `fix(crypto)`, `fix(sync-bank)`, `refactor(sync-bank)` | Rang d'occurrence du hash, isolation par compte, délai de 25 s, report des associations au re-consentement, journaux et réponse cron sans données |
| `fix(api)`, `feat(api)` | Agrégats (statut après la fence, invalidation jamais avalée, reconstruction planifiée, filet sur les 5xx), « Nouveau budget », seed, validations, CORS, clé anon, pagination, linkBankAccount, syncFrom |
| `fix(front)`, `perf(front)` | Lectures annulées relancées, egress de l'historique, saisie des montants, import YNAB, tri, banque, rapports, bundle, écran Budget (lots d'assignations, rollback, objectifs, feuilles mobiles) |
| `chore(ci)`, `chore(sql)` | CI de tests avant déploiement, scripts SQL de durcissement |
| `docs` | Ce document, `CLAUDE.md` |

## 4. Reste à faire, par priorité

### Priorité 1 — bugs qui faussent des données

| ID | Constat | Piste |
|---|---|---|
| API-LOG-05, UI-TX-01, FRONT-LIB-05 | « Annuler le virement » depuis le miroir supprime la saisie d'origine (saisie manuelle, paire importée de YNAB) et laisse le miroir en transaction fantôme. Le serveur prend `tx_hash` NULL pour « miroir synthétique » | Marquer le miroir à sa création (`synthetic` dans `enc_core`), supprimer la moitié marquée quel que soit le côté cliqué, délier sans supprimer quand il n'y a pas de marqueur. Exposer ce champ au front et ajouter « Annuler » au toast |
| API-SEC-02, FRONT-INF-01 | Aucune idempotence sur les créations : une réponse perdue (iPhone verrouillé juste après la validation) est rejouée 3 fois, d'où une transaction ou un compte en double | Envoyer l'UUID du `tempId` comme id de ligne, `on conflict (id) do nothing` dans `enc_insert`. Demande un script SQL et un drapeau `features` |
| CORE-03 | Un virement entre deux comptes budget à cheval sur le mois de départ fausse le Prêt à assigner de son montant, définitivement (prouvé : 280 000 ou 320 000 au lieu de 300 000) | Dans `computeBudget`, compter en inflow la moitié postérieure d'un groupe dont une moitié budget est antérieure au départ ; répliquer dans `aggRecompute` |
| CORE-02 | La maintenance des agrégats a lieu après l'écriture métier : un recompute concurrent (synchro pendant une catégorisation) peut compter un lot deux fois | Poser la fence avant la première écriture, ou passer le marqueur à `dirty` pendant l'écriture |
| SYNC-08 | Une ligne importée puis supprimée, renommée ou déplacée d'un mois peut être réimportée (la dédup lit l'état courant) | Conserver un `bankLabel` immuable, ajouter le hash des variantes aux tombstones |
| SET-IMP-01 | Import avec remplacement : après l'effacement, « Abandonner » libère la sauvegarde de sécurité sans confirmation ; aucun signal d'import incomplet après un rechargement | Confirmation, conserver la sauvegarde, drapeau persistant et bannière |
| REP-02 à REP-05 | Rapports : taux d'épargne du mois partiel comparé à des mois complets (« −678 % »), récurrence un mois sur deux affichée mensuelle, remboursements ignorés, virement vers l'épargne compté en dépense | Voir section 5, zone Rapports |

### Priorité 2 — egress (la contrainte d'exploitation)

| ID | Constat | Piste |
|---|---|---|
| API-LOG-02 | `listTransactions` renvoie tout l'historique, texte compris. Le correctif front empêche qu'il soit relu depuis toutes les pages, mais chaque réconciliation sur la page Transactions le relit en entier | Paramètre `months[]`, fusion dans le cache |
| API-LOG-03, EGR-01 | `bootstrapFull` calcule et transmet les rapports, que plus aucun composant ne lit ; `getReports` relit tout l'historique pour un mois | Retirer le champ côté serveur et le code mort (`lib/reports.ts`) |
| API-LOG-04, 14, SET-CAT-01, FRONT-LIB-07 | Annuler ou supprimer un virement, supprimer une catégorie, appliquer les règles : historique complet relu avec le texte | Lire `enc_core` d'abord, `enc_text` pour les seules lignes touchées |
| EGRESS-01 | Chaque run de synchro avec import relit tout l'historique ; un import d'historique le relit trois fois | Maintenance incrémentale pour les insertions simples |
| API-LOG-10, CORE-04 | 14 requêtes séquentielles par catégorisation, dont 4 sans effet (`replaceTx` retire puis rajoute le même solde) | Accumuler les deltas par cellule, `Promise.all` |
| UI-TRI-03 | Le tri déclenche `bootstrap` et `getBudgetMonth` à chaque carte (debounce de 1,2 s plus court que le rythme réel) | Debounce de 4 à 5 s, pas de `bootstrap` après une catégorisation pure |
| API-LOG-11 | `bootstrap` relit taxonomie et mémoire de tiers pour rafraîchir un solde et un compteur | Paramètre `scope: 'counters'` |

### Priorité 3 — décisions produit à prendre

| ID | Question |
|---|---|
| REP-05 | Un virement vers un compte de suivi rangé dans « Épargne » compte comme dépensé et fait tomber le taux d'épargne à 0 %. Indicateur à redéfinir ou à renommer |
| ZAK-01, ZAK-02 | Widget Zakat : assiette (tous les comptes, suivi et dettes compris), taux, nisab saisi à la main, date au 1er janvier, « Ta méthode (3 %) » qui ignore le nisab. Hypothèses codées en dur, à exposer en réglages |
| API-SEC-03 | Le second facteur n'est exigé que s'il est enrôlé. Un secret `REQUIRE_MFA=1` le rendrait obligatoire côté serveur |
| SET-CAT-03 | Supprimer une catégorie avec réaffectation déplace les transactions, pas les assignations ni les règles |

## 5. Liste complète des constats

Sévérité : H haute, M moyenne, B basse. Statut : **corrigé**, **partiel**,
**script** (SQL fourni, à appliquer), **ouvert**.

### API — sécurité (`supabase/functions/api`)

| ID | Sév. | Constat | Statut |
|---|---|---|---|
| API-SEC-01 | M | `seedDefaults` purgeait toute la taxonomie d'un budget utilisé ayant moins de 6 groupes ou 21 catégories | corrigé |
| API-SEC-02 | M | Créations sans idempotence, rejouées par la file réseau | ouvert |
| API-SEC-03 | B | Second facteur non exigé sans facteur enrôlé | ouvert (décision) |
| API-SEC-04, API-LOG-15 | B | `enc_update` ne signale pas une mise à jour de 0 ligne (écriture sur une ligne supprimée) | ouvert (SQL) |
| API-SEC-05 | B | La clé anon passait la vérification de la plateforme et coûtait un appel au service Auth | corrigé |
| API-SEC-06, SQL-02 | B | `revoke ... from public` ne retire pas les droits de `anon` et `authenticated` | script O |
| API-SEC-07 | B | Mois, dates et montants non bornés (« 9999-12 » : 96 000 mois déroulés ; « 2025-02-31 » accepté) | corrigé |
| API-SEC-08 | B | `linkBankAccount` ne vérifiait ni la connexion ni le compte bancaire | corrigé |
| API-SEC-09 | B | Origine de repli CORS « null », qui est celle des iframes sandbox | corrigé (localhost reste autorisé) |
| API-SEC-10 | B | `npm:@supabase/supabase-js@2` et CLI en version flottante | ouvert |
| — | B | Liste d'emails autorisés sans contrôle de `email_confirmed_at` | ouvert |

### API — logique et egress

| ID | Sév. | Constat | Statut |
|---|---|---|---|
| API-LOG-01 | H | Invariant « ready » cassé si le worker est tué en plein lot ou si l'invalidation échoue | partiel : invalidation jamais avalée, filet sur les 5xx, lots de plus de 25 lignes invalidés autour de leurs écritures |
| API-LOG-02 | H | `listTransactions` relit tout à chaque réconciliation | partiel (côté front) |
| API-LOG-03 | H | `getReports` relit tout l'historique pour un mois | ouvert |
| API-LOG-04 | M | Recherche d'un miroir de virement sur l'historique complet | ouvert |
| API-LOG-05 | M | « Annuler le virement » supprime la mauvaise moitié | ouvert |
| API-LOG-06, SET-NEW-01, CORE-09, SET-AGG-02 | M | « Nouveau budget » effaçait les assignations avant de poser le mois de départ ; pas de ré-invalidation après les imports | corrigé |
| API-LOG-07 | M | « Appliquer les règles » pouvait catégoriser le prélèvement de carte différée (compté deux fois) | corrigé |
| API-LOG-08, CORE-05 | M | Agrégats invalidés reconstruits seulement au lancement suivant | corrigé (reste : double lecture de `bootstrapFull`, colonnes inutiles) |
| API-LOG-09 | M | Mémoire de tiers tronquée au-delà de 1 000 lignes | corrigé |
| API-LOG-10, CORE-04 | M | Maintenance séquentielle, requêtes sans effet | ouvert |
| API-LOG-11 | M | `bootstrap` et `getBudgetMonth` renvoient plus que nécessaire | ouvert |
| API-LOG-12, CORE-11 | B | Cache de 3 s purgé avant l'écriture seulement | corrigé |
| API-LOG-13 | B | Suppression : tombstone en échec après l'écriture du miroir | corrigé |
| API-LOG-14 | B | Autres lectures complètes avec texte | ouvert |
| API-LOG-16 | B | `getTransactions` non paginé | corrigé |
| API-LOG-17 | B | `.in('id')` non découpé dans `deleteCategory`, pagination par offset, comparateurs de tri sans égalité, `getReports` ignore le mois de départ | ouvert |

### Moteur, crypto, agrégats

| ID | Sév. | Constat | Statut |
|---|---|---|---|
| CORE-01 | H | `aggBegin` lisait le statut avant la fence : maintenance sautée sous un marqueur redevenu « ready » (prouvé par simulation) | corrigé |
| CORE-02 | M | Maintenance après l'écriture métier : double comptage possible | ouvert |
| CORE-03 | M | Virement à cheval sur le mois de départ | ouvert |
| CORE-06 | B | `payeeKey` : clés trop génériques (« cheque », « echeance pret », « paris » pour C&A PARIS, vide pour H&M) | ouvert |
| CORE-07 | B | Garde « libellé complété » : 12 caractères mesurés préfixe carte compris ; un import resservi à l'identique pouvait absorber une autre opération | partiel (second point corrigé) |
| CORE-08, SYNC-02 | H | Deux opérations identiques le même jour : la seconde perdue | corrigé |
| CORE-10 | B | Une transaction dont la catégorie n'existe plus n'est comptée nulle part | ouvert |
| CORE-12 | B | Marqueur recréé à `rev` 0 : confusion possible avec une session ancienne | ouvert |

### Synchro bancaire, SQL, CI

| ID | Sév. | Constat | Statut |
|---|---|---|---|
| SYNC-01 | H | Re-consentement : nouveaux identifiants de compte non reportés, synchro « ok » à vide | corrigé (à confirmer au prochain re-consentement) |
| SYNC-03 | M | Un compte en échec bloquait tous les suivants | corrigé |
| SYNC-04 | M | Aucun délai sur les appels à la banque ; insertion ligne à ligne | partiel (délai de 25 s) |
| SYNC-05 | M | Compte associé après coup : opérations déjà dans son solde d'ouverture réimportées | corrigé (`syncFrom`) |
| SYNC-06 | M | Synchros manuelles sans en-têtes de présence utilisateur ni limite de fréquence | ouvert |
| SYNC-07 | M | Nom de la banque, du compte et corps d'erreur en clair dans la réponse cron et les journaux | corrigé |
| SYNC-08 | M | Dédup sur l'état courant des lignes | ouvert |
| SYNC-09 | B | Agrégats invalidés une seule fois par run | ouvert |
| SYNC-10 | B | Appariement des jumeaux dépendant de l'ordre de la réponse | ouvert |
| SYNC-11, SET-BNK-04, FRONT-INF-11 | B | Paramètre `state` généré mais jamais vérifié | ouvert |
| SQL-01 | B | Secret cron en clair dans `cron.job` | script P |
| CI-01 | M | Jeton Supabase exposé à tout le job, pas de permissions ni de concurrence | partiel (reste : épingler actions et CLI) |
| CI-02 | B | Aucun test avant déploiement | corrigé (`ci.yml`) |
| EGRESS-01 | M | Relectures complètes à chaque run avec import | ouvert |
| EGRESS-02 | B | Un signal Realtime par ligne insérée | ouvert |
| — | B | Devise ignorée ; indicateur débit/crédit absent traité comme crédit ; horaires du cron divergents entre CLAUDE.md, `G-cron-2x.sql` et le README | ouvert |
| — | B | Durée de consentement affichée sur 180 jours alors que 90 sont demandés | corrigé |

### Front — infrastructure, auth, PWA

| ID | Sév. | Constat | Statut |
|---|---|---|---|
| FRONT-INF-01 | H | Rejeu réseau sans idempotence | ouvert (voir API-SEC-02) |
| FRONT-INF-02 | H | Dialogue d'édition : historique retéléchargé à chaque réconciliation | corrigé |
| FRONT-INF-03 | M | Le budget est adapté avec la taxonomie du rendu précédent : une enveloppe tout juste créée peut refuser une assignation | ouvert |
| FRONT-INF-04 | M | Un lot d'assignations n'entre pas dans la file comme un bloc : une correction intercalée est écrasée | corrigé (lot et déplacement = une tâche de la file) |
| FRONT-INF-05 | M | Realtime : jeton posé à la main, pas de reconnexion après fermeture du canal | ouvert (à valider en conditions réelles) |
| FRONT-INF-06 | M | `fetch` sans délai : une requête pendue bloque la file sans indicateur | ouvert (dépend de l'idempotence) |
| FRONT-INF-07 | M | Recharts chargé au démarrage | corrigé (1 370 kB → 874 kB) |
| FRONT-INF-08 | M | Caches préchargés jetés après 5 min | corrigé |
| FRONT-INF-09 | B | Le rollback d'une assignation restaure tout le mois | corrigé (seules les valeurs de l'action échouée, relecture derrière la file) |
| FRONT-INF-10 | B | Pas de CSP | ouvert |
| FRONT-INF-12 | B | Service worker : URL de retour bancaire gardée comme clé de cache ; page blanche possible hors ligne juste après un déploiement | ouvert |
| FRONT-INF-13 | B | Erreur réseau affichée « Identifiants invalides » ; désactivation du second facteur sans confirmation | ouvert |
| FRONT-INF-14 | B | `signOut()` déconnecte tous les appareils | ouvert |
| FRONT-INF-15 | B | Signal de reconnexion ignoré juste après une reprise | ouvert |

### Front — bibliothèques métier

| ID | Sév. | Constat | Statut |
|---|---|---|---|
| FRONT-LIB-01, UI-BUD-01 | H | Lecture annulée par un patch optimiste jamais relancée | corrigé (`pauseReads`) |
| FRONT-LIB-02, UI-TX-02 | M | Soldes et badge optimistes écrasés par une relecture en vol | partiel (reste : suppression différée de 5 s) |
| FRONT-LIB-03 | M | Le budget ne se met pas à jour en optimiste après une action sur une transaction (saut après 2 s) | ouvert |
| FRONT-LIB-04, SET-CAT-02 | M | Relecture de la taxonomie hors file : réordonnancements qui sautent | ouvert |
| FRONT-LIB-06 | M | Libellés courts : « INTERETS DEBITEURS » rendu « Interets crediteurs », marchands PayPal confondus, « VERSEMENT PERIODIQUE » rendu « Versement especes » | ouvert |
| FRONT-LIB-08, UI-BUD-06 | M | « 1.000 » lu 1,00 €, « - » seul lu 0 | corrigé |
| FRONT-LIB-09 | B | Caches qui gardent l'identifiant temporaire d'une catégorie | ouvert |
| FRONT-LIB-10 | B | Prédicat « à catégoriser » recalculé par ligne | ouvert (le `select` instable de `useTargets`, signalé avec, est corrigé : voir UI-BUD-05) |
| FRONT-LIB-11 | B | Date du jour au fuseau de l'appareil | corrigé (Europe/Paris) |
| — | B | `MIN_MONTH = '2026-02'` en dur : les mois antérieurs (historique importé) ne sont pas navigables | ouvert |

### Écrans Budget et Comptes

| ID | Sév. | Constat | Statut |
|---|---|---|---|
| UI-BUD-02, FRONT-LIB-12 | M | Objectif « Recharger jusqu'à » : chaque dépense rouvrait le besoin, « Financer les objectifs » reproposait le montant dépensé | corrigé (décision : sémantique YNAB, besoin = cible − report − assigné du mois) |
| UI-BUD-03 | M | Mois précédent retéléchargé à chaque assignation | corrigé |
| UI-ACC-01 | M | Double clic sur « Créer le compte » : deux comptes | corrigé |
| UI-BUD-04 | M | Mobile : impossible de saisir un assigné négatif ou de rendre de l'argent au Prêt à assigner | corrigé |
| UI-BUD-05 | B | Grille re-rendue en entier à chaque survol de glisser-déposer | partiel (survol et index des objectifs stables ; pas de `React.memo` sur les lignes, qui demanderait de refondre leurs callbacks) |
| UI-ACC-02 | B | « Ajuster et clôturer » clôturait même avec une cible non nulle | corrigé |
| UI-BUD-07 | B | Dialogue d'objectif réinitialisé pendant la saisie | corrigé |
| UI-BUD-08 | B | Feuille d'actions d'une enveloppe accessible seulement par appui long | corrigé (bouton « Plus d'actions » de la feuille d'assignation) |
| UI-BUD-09 | B | « Couvrir les dépassements » sans gestion d'échec | corrigé (un lot refusé en cours d'envoi reste partiel côté serveur ; la relecture l'affiche) |

### Écrans Transactions, Tri, Règles

| ID | Sév. | Constat | Statut |
|---|---|---|---|
| UI-TRI-01 | M | « Annuler » laissait le choix annulé en mémoire de tiers | corrigé (tri ; les annulations en lot restent à faire) |
| UI-TX-03 | M | Transaction datée dans le futur non modifiable | corrigé |
| UI-TX-04, UIKIT-01 | H | Sélecteur de catégories ouvert depuis une feuille : recherche et défilement bloqués (prouvé en navigateur) | ouvert |
| UI-TX-05 | M | Lot tronqué à 200 en silence | corrigé |
| UI-TX-06, UI-TX-07 | M | Lignes re-rendues en entier, liste mobile sans fenêtre, recherche sans différé | ouvert |
| UI-TRI-02 | M | La carte courante du tri peut changer sous le doigt après un échec | ouvert |
| UI-TRI-04 | B | « Passer » en boucle pendant la revue | corrigé |
| UI-TX-09 | B | Suppression validée non protégée d'une relecture concurrente | ouvert |
| UI-RUL-01 | B | Règle créée en priorité 0 si la liste n'est pas chargée | ouvert |

### Réglages, import YNAB, sauvegarde

| ID | Sév. | Constat | Statut |
|---|---|---|---|
| SET-IMP-01 | H | Sauvegarde de sécurité perdue après « Abandonner » | ouvert |
| SET-IMP-02 | M | Reprise d'import : un lot non écrit peut être déclaré écrit | ouvert |
| SET-IMP-03 | M | Refus d'un lot après l'effacement : impasse | ouvert |
| SET-AGG-01 | M | Aucune reconstruction des agrégats en fin d'import | corrigé |
| SET-BNK-01 | M | Échec de « Reconnecter » jamais affiché | corrigé |
| SET-BNK-02 | M | Consentement refusé par la banque ignoré | corrigé |
| SET-IMP-04 | M | Registre sans colonne de montant importé à 0 € | corrigé |
| SET-BAK-01 | M | Confirmation destructive réentrante (double tap) | ouvert |
| SET-IMP-05 | B | Dates `2024/03/15` non reconnues, ambiguïté jour/mois sans recours | ouvert |
| SET-IMP-06 | B | Enveloppes YNAB vides non importées | corrigé |
| SET-IMP-07, SET-IMP-08 | B | Compte alimenté par virements proposé en suivi ; ancienne taxonomie affichée en fin d'import | ouvert |
| SET-BNK-03 | B | « Créer un compte pour ce compte bancaire » non atomique | ouvert |
| SET-BAK-02, SET-BAK-03 | B | Sauvegarde sans version de format ; liens bancaires déclarés perdus si les connexions ne sont pas chargées | ouvert |
| SET-UI-01 | B | « Budget chiffré de bout en bout » : inexact, le serveur déchiffre | corrigé |

### Rapports et kit UI

| ID | Sév. | Constat | Statut |
|---|---|---|---|
| REP-01 | H | Solde d'ouverture compté comme revenu (taux d'épargne de 55,6 % au lieu de 20 %) | corrigé |
| REP-02 | M | Taux d'épargne du mois partiel, « Meilleur mois » incluant le mois en cours | ouvert |
| REP-03 | M | Récurrence un mois sur deux affichée mensuelle | ouvert |
| REP-04 | M | Remboursement sur une catégorie de dépense ignoré | ouvert |
| REP-05 | M | Virement vers l'épargne compté en dépense | ouvert (décision) |
| REP-06 à REP-08 | B | Premier mois partiel dans les moyennes, libellés de mois en double sur 13 points, jour de semaine sur la date comptable | ouvert |
| ZAK-01 | M | Hypothèses du widget Zakat codées en dur | ouvert (décision) |
| ZAK-02 | B | Date vide enregistrée (« Invalid Date ») ; « Ta méthode » ignore le nisab | partiel (date corrigée) |
| UIKIT-02, UIKIT-05 | M | Combobox : Entrée choisissait la première option, frappe ajoutée au libellé après Échap | corrigé |
| UIKIT-03 | M | Combobox sans navigation aux flèches | ouvert |
| UIKIT-04 | B | Sélecteur de mois : flèches d'année hors bornes, pas d'Échap | ouvert |
| PERF-01 | B | Compteurs animés qui re-rendent le graphe cumulé | ouvert |

## 6. Ce qui est sain

- **Authentification et autorisation** : `verify_jwt`, `auth.getUser()`, liste d'emails
  fail-closed, second facteur, le tout avant la lecture du corps. Toutes les requêtes
  filtrent sur `user_id`. Aucun accès croisé trouvé.
- **Chiffrement** : HKDF à domaines séparés, AES-GCM avec IV aléatoire de 96 bits, AAD
  liée à la table, à l'utilisateur et à la colonne, index aveugles en HMAC complet,
  aucun payload déchiffré journalisé.
- **Moteur** : report, dépassement, Prêt à assigner passé, courant et futur, gel avant
  le mois de départ, transferts neutres et croisés conformes à la spec (hors CORE-03).
  Montants en centimes entiers partout.
- **Front** : aucun `dangerouslySetInnerHTML`, aucune source map publiée, mode démo
  absent du bundle de production, service worker qui ne touche jamais Supabase, aucune
  invalidation globale, gardes de route correctes, déconnexion qui purge tout.
- **Assignation optimiste, annuler/refaire, règles, badge « À catégoriser »** :
  identiques au serveur.

## 7. Méthode

Onze relectures indépendantes par zone, fichiers lus en entier, chaque constat tracé
dans le code appelant et appelé. Les constats marqués « prouvé » l'ont été par script
jetable, simulation ou navigateur. Les correctifs ont ensuite été vérifiés par les
tests, les trois typechecks, le build, la CI GitHub et un test de l'app en mode démo.
