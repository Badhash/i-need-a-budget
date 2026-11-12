# Audit du code — novembre 2026

Revue complète du dépôt (front, Edge Functions, moteur, crypto, SQL, CI) : failles,
bugs et optimisations. Ce document liste **tous** les constats, ce qui est corrigé
sur `main` et ce qui reste à faire. Une correction = un commit : chacune s'annule
seule avec `git revert <commit>`.

## 1. Synthèse

- 122 constats distincts sur 11 zones (un même défaut signalé par deux relectures
  ne compte qu'une fois). Aucune faille critique : pas de contournement
  d'authentification, pas d'accès aux données d'un autre utilisateur, pas de fuite de
  données déchiffrées, primitives de chiffrement saines.
- **89 corrigés, 6 corrigés en partie, 2 couverts par un script SQL à appliquer,
  25 ouverts** : aucun de sévérité haute, 8 moyenne, 17 basse.
- Les problèmes les plus lourds étaient fonctionnels, pas des failles :
  1. **Synchro bancaire** : après un re-consentement, plus rien n'était importé, en
     silence ; deux opérations identiques le même jour n'en donnaient qu'une.
  2. **Egress** : l'historique complet des transactions, texte compris, était
     retéléchargé à chaque réconciliation.
  3. **Agrégats** : plusieurs chemins (échec, worker tué, reconstruction concurrente)
     pouvaient laisser le marqueur « ready » sur des chiffres faux.
  4. **Doublons** : une réponse réseau perdue rejouait une création (transaction ou
     compte en double).

### Vérifications faites

| Vérification | Résultat |
|---|---|
| Tests du moteur (`packages/engine`) | 48 sur 48 (6 ajoutés : virement à cheval sur le mois de départ) |
| Tests de la crypto (`packages/crypto`) | 44 sur 44 (clé de tiers, garde « libellé complété ») |
| `deno check` des deux Edge Functions | 3 erreurs avant, 0 après |
| Typecheck et build du front | OK, vérifiés sur chaque commit |
| Workflows GitHub (`ci.yml`, déploiements Pages et Edge Functions) | verts sur `main` |
| Agrégats : simulateur PostgREST (scénarios d'écriture, de concurrence, de panne) | conformes, équivalence agrégats / calcul complet sur 8 cas |
| App en mode démo dans un navigateur (desktop et mobile, clair et sombre) | sélecteur de catégories dans une feuille, réaffectation de catégorie, budget optimiste, écrans Budget, Rapports, Réglages |

### Ce qui n'a pas pu être vérifié

- **La base de production.** Le schéma n'est pas versionné : RLS, droits, index,
  triggers Realtime et contenu de `cron.job` n'ont pas pu être contrôlés. Les requêtes
  de contrôle sont à la fin de `supabase/migrations-manual/O-revoke-rpc-execute.sql`.
- **Enable Banking en réel.** Les correctifs de la synchro sont typés et testés sur leur
  logique isolée, pas contre l'API de la banque (hypothèses marquées « HYP EB »).
- **Le parcours réel** (vraie session, vraie banque, iPhone) : tout a été vérifié en
  mode démo, avec un faux serveur.

## 2. Statut de la mise en production

Tout ce qui ne demande aucun accès à Supabase est sur `main` et déployé
automatiquement : Pages pour le front, Edge Functions pour `/api` et `sync-bank`
(après les tests de `ci.yml`). Le front et le serveur restent compatibles entre eux
pendant le déploiement (nouveaux paramètres optionnels, fonctionnalités annoncées
par `features`).

**Reste à faire de ton côté, quand tu auras accès à Supabase** (rien n'est bloquant) :

1. **Appliquer deux scripts dans le SQL Editor** (voir `RUNBOOK.md`) :
   `O-revoke-rpc-execute.sql` (droits des RPC), puis `P-cron-secret-vault.sql` (le
   secret d'appel de la synchro est aujourd'hui en clair dans `cron.job`). Faire
   tourner ce secret ensuite.
2. **Lancer les 5 requêtes de contrôle** de la fin du script O et comparer aux valeurs
   attendues indiquées en commentaire.
3. **Vérifier dans le dashboard Supabase** : inscription fermée (« Allow new users to
   sign up » désactivé), second facteur TOTP enrôlé sur ton compte, `ALLOWED_ORIGINS`
   renseigné.
4. **Facultatif** : poser le secret `REQUIRE_MFA=1` sur les Edge Functions pour exiger
   le second facteur côté serveur (seulement une fois le TOTP enrôlé, sinon l'accès
   est refusé).
5. **Au prochain re-consentement bancaire** : il passe désormais par un `state` signé.
   Un consentement lancé avant le déploiement et terminé après sera refusé une fois
   (« relance la connexion »).
6. **Après le premier run de synchro** : contrôler dans Réglages > Banque que les
   comptes sont toujours associés et qu'un import arrive.

## 3. Corrections livrées

`git log --oneline` liste chaque correction. Par zone :

| Zone | Contenu |
|---|---|
| Synchro bancaire | Rang d'occurrence du hash, isolation par compte, délai de 25 s, report des associations au re-consentement, `syncFrom`, journaux sans données, appariement optimal des saisies manuelles, opérations déjà présentes non comptées, agrégats invalidés après chaque écriture, `state` du consentement signé |
| Agrégats et moteur | Statut `dirty` pendant les écritures, invalidation jamais avalée, reconstruction planifiée, virement à cheval sur le mois de départ, requêtes de maintenance sans effet supprimées, marqueur horodaté |
| API | Idempotence des créations, « Annuler le virement » sur la bonne moitié, lectures scopées (virements, règles, suppressions), `listTransactions` par mois, rapports retirés du démarrage, réaffectation complète d'une catégorie, export versionné, second facteur obligatoire en option, supabase-js épinglé |
| Crypto | Clé de tiers (sigles, ligatures, clés génériques), garde « libellé complété » |
| Front | Réconciliation par mois, budget optimiste exact après une action sur une transaction, délai maximal des appels, taxonomie à jour, sélecteur de catégories dans les feuilles, libellés bancaires, saisie des montants, relectures derrière la file d'écritures, tri allégé |
| Écrans | Budget (objectifs « Recharger jusqu'à », lots d'assignations, rollback ciblé, feuilles mobiles), Rapports (remboursements, épargne, taux à date, périodicité, premier mois), Zakat (nisab), kit UI (combobox, sélecteur de mois), Réglages (import YNAB, reprise, restauration, banque) |
| CI et SQL | Tests avant déploiement, scripts SQL de durcissement O et P (non appliqués) |

## 4. Reste à faire, par priorité

Aucun constat de sévérité haute n'est ouvert.

### Priorité 1 — fiabilité

| ID | Constat | Piste |
|---|---|---|
| SYNC-08 | Une ligne importée puis supprimée, renommée ou déplacée d'un mois peut être réimportée (la dédup lit l'état courant) | Conserver un `bankLabel` immuable, ajouter le hash des variantes aux tombstones |
| FRONT-LIB-02, UI-TX-02, UI-TX-09 | Une relecture en vol peut écraser soldes et badge optimistes pendant les 5 s d'une suppression annulable | Protéger `bootstrap` pendant la suppression différée (`pauseReads`), comme la liste |
| UI-TRI-02 | La carte courante du tri peut changer sous le doigt après un échec | Épingler l'id de la carte, `mutateAsync().catch` |
| FRONT-INF-05, FRONT-INF-15 | Realtime : pas de reconnexion après fermeture du canal, signal de reconnexion ignoré juste après une reprise | À valider en conditions réelles (iPhone, mise en veille) |
| SYNC-06 | Synchro manuelle sans limite de fréquence | Délai minimal entre deux synchros manuelles |
| CORE-10 | Une transaction dont la catégorie n'existe plus n'est comptée nulle part | La traiter comme non catégorisée (moteur, agrégats, badge ; `AGG_VERSION` à monter) |

### Priorité 2 — egress et performance

| ID | Constat | Piste |
|---|---|---|
| EGRESS-01 | Chaque run de synchro avec import relit tout l'historique pour reconstruire les agrégats | Maintenance incrémentale pour les insertions simples |
| API-LOG-11 | `bootstrap` relit taxonomie et mémoire de tiers pour rafraîchir un solde et un compteur | Paramètre `scope: 'counters'` |
| API-LOG-10, CORE-04 | Maintenance des agrégats séquentielle (9 requêtes par catégorisation) | Accumuler les deltas par cellule, `Promise.all` |
| EGRESS-02 | Un signal Realtime par ligne insérée | Coalescer côté trigger |
| UI-TX-06, UI-TX-07, UI-BUD-05 | Listes et grille re-rendues en entier, liste mobile sans fenêtre | `React.memo`, virtualisation, `useDeferredValue` sur la recherche |

### Priorité 3 — finitions et décisions

| ID | Question ou constat |
|---|---|
| ZAK-01 | Widget Zakat : assiette, taux, nisab et date sont des hypothèses codées en dur, à exposer en réglages (décision) |
| FRONT-INF-10 | Pas de CSP sur l'app budget (faite sur freelance-dashboard) |
| API-SEC-04 | `enc_update` ne signale pas une mise à jour de 0 ligne (demande un changement SQL) |
| CI-01, API-SEC-10 | Épingler les actions GitHub et la CLI Supabase |
| Divers B | Service worker et URL de retour bancaire, messages d'erreur de connexion, `signOut()` global, identifiants temporaires en cache, règle créée en priorité 0, jour de semaine des rapports, `MIN_MONTH` en dur |

## 5. Liste complète des constats

Sévérité : H haute, M moyenne, B basse. Statut : **corrigé**, **partiel**,
**script** (SQL fourni, à appliquer), **ouvert**.

### API — sécurité (`supabase/functions/api`)

| ID | Sév. | Constat | Statut |
|---|---|---|---|
| API-SEC-01 | M | `seedDefaults` purgeait toute la taxonomie d'un budget utilisé ayant moins de 6 groupes ou 21 catégories | corrigé |
| API-SEC-02 | M | Créations sans idempotence, rejouées par la file réseau | corrigé (référence client `clientRef` et rejeu signalé : transactions, comptes, catégories, groupes, règles ; sans SQL) |
| API-SEC-03 | B | Second facteur non exigé sans facteur enrôlé | corrigé (secret `REQUIRE_MFA=1` à poser dans Supabase pour exiger le second facteur) |
| API-SEC-04, API-LOG-15 | B | `enc_update` ne signale pas une mise à jour de 0 ligne (écriture sur une ligne supprimée) | ouvert (SQL) |
| API-SEC-05 | B | La clé anon passait la vérification de la plateforme et coûtait un appel au service Auth | corrigé |
| API-SEC-06, SQL-02 | B | `revoke ... from public` ne retire pas les droits de `anon` et `authenticated` | script O |
| API-SEC-07 | B | Mois, dates et montants non bornés (« 9999-12 » : 96 000 mois déroulés ; « 2025-02-31 » accepté) | corrigé |
| API-SEC-08 | B | `linkBankAccount` ne vérifiait ni la connexion ni le compte bancaire | corrigé |
| API-SEC-09 | B | Origine de repli CORS « null », qui est celle des iframes sandbox | corrigé (localhost reste autorisé) |
| API-SEC-10 | B | `npm:@supabase/supabase-js@2` et CLI en version flottante | partiel (supabase-js épinglé en 2.119.0 dans les deux fonctions ; CLI du workflow à épingler) |
| — | B | Liste d'emails autorisés sans contrôle de `email_confirmed_at` | ouvert |

### API — logique et egress

| ID | Sév. | Constat | Statut |
|---|---|---|---|
| API-LOG-01 | H | Invariant « ready » cassé si le worker est tué en plein lot ou si l'invalidation échoue | corrigé (statut `dirty` posé avant toute écriture, retour à `ready` par CAS seulement si les ajustements ont réussi : un worker tué laisse un état non prêt) |
| API-LOG-02 | H | `listTransactions` relit tout à chaque réconciliation | corrigé (`months[]` côté serveur ; la réconciliation ne relit que les 3 derniers mois et les mois modifiés localement) |
| API-LOG-03 | H | `getReports` relit tout l'historique pour un mois | corrigé (rapports retirés de `bootstrapFull` et code mort supprimé ; `getReports` n'a plus d'appelant) |
| API-LOG-04 | M | Recherche d'un miroir de virement sur l'historique complet | corrigé (moitié et miroir lus par id et par mois, `enc_core` seul) |
| API-LOG-05 | M | « Annuler le virement » supprime la mauvaise moitié | corrigé (miroir marqué `synthetic` à sa création ; c'est lui qui est supprimé, de quelque côté qu'on annule) |
| API-LOG-06, SET-NEW-01, CORE-09, SET-AGG-02 | M | « Nouveau budget » effaçait les assignations avant de poser le mois de départ ; pas de ré-invalidation après les imports | corrigé |
| API-LOG-07 | M | « Appliquer les règles » pouvait catégoriser le prélèvement de carte différée (compté deux fois) | corrigé |
| API-LOG-08, CORE-05 | M | Agrégats invalidés reconstruits seulement au lancement suivant | corrigé (reste : double lecture de `bootstrapFull`, colonnes inutiles) |
| API-LOG-09 | M | Mémoire de tiers tronquée au-delà de 1 000 lignes | corrigé |
| API-LOG-10, CORE-04 | M | Maintenance séquentielle, requêtes sans effet | partiel (requêtes sans effet supprimées : 9 au lieu de 14 par catégorisation ; pas de parallélisation) |
| API-LOG-11 | M | `bootstrap` et `getBudgetMonth` renvoient plus que nécessaire | ouvert |
| API-LOG-12, CORE-11 | B | Cache de 3 s purgé avant l'écriture seulement | corrigé |
| API-LOG-13 | B | Suppression : tombstone en échec après l'écriture du miroir | corrigé |
| API-LOG-14 | B | Autres lectures complètes avec texte | corrigé (`enc_core` pour l'historique, texte des seules lignes touchées) |
| API-LOG-16 | B | `getTransactions` non paginé | corrigé |
| API-LOG-17 | B | `.in('id')` non découpé dans `deleteCategory`, pagination par offset, comparateurs de tri sans égalité, `getReports` ignore le mois de départ | ouvert |

### Moteur, crypto, agrégats

| ID | Sév. | Constat | Statut |
|---|---|---|---|
| CORE-01 | H | `aggBegin` lisait le statut avant la fence : maintenance sautée sous un marqueur redevenu « ready » (prouvé par simulation) | corrigé |
| CORE-02 | M | Maintenance après l'écriture métier : double comptage possible | corrigé (voir API-LOG-01 : statut `dirty` pendant l'écriture) |
| CORE-03 | M | Virement à cheval sur le mois de départ | corrigé (moteur et agrégats, `AGG_VERSION` 4 ; 6 tests) |
| CORE-06 | B | `payeeKey` : clés trop génériques (« cheque », « echeance pret », « paris » pour C&A PARIS, vide pour H&M) | corrigé (sigles, ligatures ; une clé réduite à des mots génériques est vide) |
| CORE-07 | B | Garde « libellé complété » : 12 caractères mesurés préfixe carte compris ; un import resservi à l'identique pouvait absorber une autre opération | corrigé (longueur mesurée hors préfixe carte) |
| CORE-08, SYNC-02 | H | Deux opérations identiques le même jour : la seconde perdue | corrigé |
| CORE-10 | B | Une transaction dont la catégorie n'existe plus n'est comptée nulle part | ouvert |
| CORE-12 | B | Marqueur recréé à `rev` 0 : confusion possible avec une session ancienne | corrigé (`rev` initial horodaté) |

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
| SYNC-09 | B | Agrégats invalidés une seule fois par run | corrigé (marqueur invalidé aussi après chaque écriture) |
| SYNC-10 | B | Appariement des jumeaux dépendant de l'ordre de la réponse | corrigé (appariement par date croissante, jumeau le plus ancien de la fenêtre) |
| SYNC-11, SET-BNK-04, FRONT-INF-11 | B | Paramètre `state` généré mais jamais vérifié | corrigé (`state` signé HMAC, lié à l'utilisateur, 1 h) |
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
| FRONT-INF-01 | H | Rejeu réseau sans idempotence | corrigé (voir API-SEC-02) |
| FRONT-INF-02 | H | Dialogue d'édition : historique retéléchargé à chaque réconciliation | corrigé |
| FRONT-INF-03 | M | Le budget est adapté avec la taxonomie du rendu précédent : une enveloppe tout juste créée peut refuser une assignation | corrigé (taxonomie lue dans le cache à l'arrivée de la réponse) |
| FRONT-INF-04 | M | Un lot d'assignations n'entre pas dans la file comme un bloc : une correction intercalée est écrasée | corrigé (lot et déplacement = une tâche de la file) |
| FRONT-INF-05 | M | Realtime : jeton posé à la main, pas de reconnexion après fermeture du canal | ouvert (à valider en conditions réelles) |
| FRONT-INF-06 | M | `fetch` sans délai : une requête pendue bloque la file sans indicateur | corrigé (30 s en lecture, 60 s en écriture, 120 s pour les actions lourdes) |
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
| FRONT-LIB-03 | M | Le budget ne se met pas à jour en optimiste après une action sur une transaction (saut après 2 s) | corrigé (patch exact : enveloppe, report sur les mois en cache, dépassement, revenus) |
| FRONT-LIB-04, SET-CAT-02 | M | Relecture de la taxonomie hors file : réordonnancements qui sautent | corrigé (relecture derrière la file d'écritures) |
| FRONT-LIB-06 | M | Libellés courts : « INTERETS DEBITEURS » rendu « Interets crediteurs », marchands PayPal confondus, « VERSEMENT PERIODIQUE » rendu « Versement especes » | corrigé (TotalEnergies et civilité inchangés) |
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
| UI-TX-04, UIKIT-01 | H | Sélecteur de catégories ouvert depuis une feuille : recherche et défilement bloqués (prouvé en navigateur) | corrigé (focus et défilement libérés, Échap ferme le panneau seul ; vérifié en navigateur) |
| UI-TX-05 | M | Lot tronqué à 200 en silence | corrigé |
| UI-TX-06, UI-TX-07 | M | Lignes re-rendues en entier, liste mobile sans fenêtre, recherche sans différé | ouvert |
| UI-TRI-02 | M | La carte courante du tri peut changer sous le doigt après un échec | ouvert |
| UI-TRI-04 | B | « Passer » en boucle pendant la revue | corrigé |
| UI-TX-09 | B | Suppression validée non protégée d'une relecture concurrente | ouvert |
| UI-RUL-01 | B | Règle créée en priorité 0 si la liste n'est pas chargée | ouvert |

### Réglages, import YNAB, sauvegarde

| ID | Sév. | Constat | Statut |
|---|---|---|---|
| SET-IMP-01 | H | Sauvegarde de sécurité perdue après « Abandonner » | corrigé (abandon confirmé, sauvegarde gardée et restaurable en un geste, garde de fermeture tant que l'import échoué attend, drapeau `inab-import-incomplete` et bandeau au démarrage) |
| SET-IMP-02 | M | Reprise d'import : un lot non écrit peut être déclaré écrit | corrigé (comparaison par signature compte, date, montant, libellé) |
| SET-IMP-03 | M | Refus d'un lot après l'effacement : impasse | corrigé (404 : relance unique sans les catégories disparues, pertes comptées ; autre refus : « Ignorer ce lot » ; Réglages > Catégories en lecture seule pendant l'import, les autres écrans restent modifiables) |
| SET-AGG-01 | M | Aucune reconstruction des agrégats en fin d'import | corrigé |
| SET-BNK-01 | M | Échec de « Reconnecter » jamais affiché | corrigé |
| SET-BNK-02 | M | Consentement refusé par la banque ignoré | corrigé |
| SET-IMP-04 | M | Registre sans colonne de montant importé à 0 € | corrigé |
| SET-BAK-01 | M | Confirmation destructive réentrante (double tap) | corrigé (prouvé : trois feuilles de partage avant, une après) |
| SET-IMP-05 | B | Dates `2024/03/15` non reconnues, ambiguïté jour/mois sans recours | corrigé (date invalide ou hors bornes du serveur ignorée et comptée, choix JJ/MM ou MM/JJ dans l'aperçu) |
| SET-IMP-06 | B | Enveloppes YNAB vides non importées | corrigé |
| SET-IMP-07, SET-IMP-08 | B | Compte alimenté par virements proposé en suivi ; ancienne taxonomie affichée en fin d'import | corrigé (07 : compte signalé « À vérifier » dans l'aperçu, sans bascule automatique ; 08 : bootstrap relu d'abord, mois observés relus avec la nouvelle taxonomie, ce qui contourne FRONT-INF-03 pour l'import seulement) |
| SET-BNK-03 | B | « Créer un compte pour ce compte bancaire » non atomique | corrigé (création et association séparées, compte relu si l'association échoue, liste bloquée pendant la création) |
| SET-BAK-02, SET-BAK-03 | B | Sauvegarde sans version de format ; liens bancaires déclarés perdus si les connexions ne sont pas chargées | corrigé (format et version écrits par `exportData`, contrôlés à la restauration) |
| SET-UI-01 | B | « Budget chiffré de bout en bout » : inexact, le serveur déchiffre | corrigé |

### Rapports et kit UI

| ID | Sév. | Constat | Statut |
|---|---|---|---|
| REP-01 | H | Solde d'ouverture compté comme revenu (taux d'épargne de 55,6 % au lieu de 20 %) | corrigé |
| REP-02 | M | Taux d'épargne du mois partiel, « Meilleur mois » incluant le mois en cours | corrigé (mois en cours comparé à date, affichage borné à « < −100 % », meilleur mois parmi les mois clos) |
| REP-03 | M | Récurrence un mois sur deux affichée mensuelle | corrigé (montant proratisé par la fréquence observée, « tous les 2 mois » affiché). Reste : un bimestriel n'est détecté que les mois où il a passé le seuil de la moitié des mois actifs |
| REP-04 | M | Remboursement sur une catégorie de dépense ignoré | corrigé (déduit de la catégorie, du groupe et du mois, plancher à 0 par catégorie et par mois) |
| REP-05 | M | Virement vers l'épargne compté en dépense | corrigé (décision : la moitié budget d'un virement vers un compte de suivi est de l'épargne, quelle que soit sa catégorie) |
| REP-06 | B | Premier mois partiel dans les moyennes, projection sans historique | corrigé (exclu des moyennes et du mois précédent de comparaison ; projection après 7 jours de données) |
| REP-07 | B | Libellés de mois en double sur 13 points | corrigé |
| REP-08 | B | Jour de semaine sur la date comptable | ouvert |
| ZAK-01 | M | Hypothèses du widget Zakat codées en dur | ouvert (décision) |
| ZAK-02 | B | Date vide enregistrée (« Invalid Date ») ; « Ta méthode » ignore le nisab | corrigé |
| UIKIT-02, UIKIT-05 | M | Combobox : Entrée choisissait la première option, frappe ajoutée au libellé après Échap | corrigé |
| UIKIT-03 | M | Combobox sans navigation aux flèches | corrigé (flèches, rôles ARIA, focus gardé dans le champ, Échap sans fermer la feuille) |
| UIKIT-04 | B | Sélecteur de mois : flèches d'année hors bornes, pas d'Échap | corrigé |
| PERF-01 | B | Compteurs animés qui re-rendent le graphe cumulé | corrigé |

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
