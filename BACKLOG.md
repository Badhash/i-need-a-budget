# BACKLOG — I Need A Budget (INAB)

## Synthèse PO

Le produit est solide sur son cœur : moteur d'enveloppes conforme YNAB, tout-chiffré, budget optimiste, sync Enable Banking 3x/jour avec dédup et virements carte différé auto-détectés, règles de catégorisation, rapports Tremor, export.

Tout le lot P1 est désormais livré : édition complète de transaction (INAB-1), déplacement d'argent entre enveloppes / couvrir un dépassement (INAB-2), PWA réelle avec manifest, mode standalone et safe-areas iOS (INAB-3), file de mutations optimistes sérialisée (INAB-4), santé de la synchro visible (INAB-5) et financement guidé des objectifs (INAB-6). L'import YNAB destructif (INAB-19) et le rapport valeur nette (INAB-8) sont également livrés. La page Rapports a été refondue (mobile simple / desktop enrichi : coach d'épargne, valeur nette, calculateur de Zakat), et la page Budget dispose d'un undo/redo local.

Reste principalement du P2/P3 selon l'usage réel : splits (INAB-7), mode offline (INAB-9), import CSV historique (INAB-10), cycle carte différée (INAB-11), objectifs avancés (INAB-12), âge de l'argent (INAB-13), récurrences (INAB-14), puis les items P3.

---

## P1 — À faire en premier

### INAB-1 — Édition complète d'une transaction
**Statut : FAIT.** Action `/api updateTransaction` + feuille d'édition (EditTransactionDialog), optimiste.

**Problème / opportunité.** Une transaction créée ou importée ne peut être que catégorisée, convertie en virement ou supprimée : impossible de corriger un montant, une date, un libellé ou d'ajouter une note sans supprimer/recréer.
**Proposition.** Action `/api` `updateTransaction` (re-chiffrement du payload, recalcul de `month_idx` si la date change, `tx_hash` conservé pour les imports) + feuille d'édition mobile (réutiliser AddTransactionDialog) avec mise à jour optimiste et rollback.
**Valeur** haute — **Effort** M — **Priorité** P1.
**Risque.** Modifier une transaction importée casse potentiellement la dédup si le montant change : documenter que `tx_hash` reste figé.

### INAB-2 — Déplacer de l'argent entre enveloppes / couvrir un dépassement
**Statut : FAIT.** Menu long-press « Couvrir depuis… » / « Déplacer vers… », deux `setAssigned` optimistes.

**Problème / opportunité.** Geste central de YNAB absent : quand une catégorie est en dépassement (available négatif), il faut faire deux assignations mentales pour la renflouer.
**Proposition.** Dans le menu long-press d'une catégorie : « Couvrir depuis… » (catégorie en négatif) et « Déplacer vers… » (catégorie excédentaire), avec sélecteur de catégorie trié par available décroissant et montant pré-rempli. Deux `setAssigned` atomiques côté client, optimistes.
**Valeur** haute — **Effort** S — **Priorité** P1.

### INAB-3 — PWA réelle : manifest, standalone, safe-areas iOS
**Statut : FAIT.** `manifest.webmanifest`, icônes (dont maskable), meta iOS et safe-areas livrés.

**Problème / opportunité.** L'app est utilisée depuis l'écran d'accueil iPhone mais il n'y a ni `manifest.webmanifest` ni mode standalone : barre Safari visible, splash générique, pas de nom/couleur de thème.
**Proposition.** Manifest complet (nom, icônes, `display: standalone`, `theme_color` clair/sombre), meta iOS (`apple-mobile-web-app-*`), gestion `env(safe-area-inset-*)` sur BottomNav/FAB/Header, splash screen. Compatible hash routing GitHub Pages.
**Valeur** haute — **Effort** S — **Priorité** P1.

### INAB-4 — File de mutations optimistes sérialisée (item TODO)
**Statut : FAIT.** File FIFO `app/src/lib/mutationQueue.ts`, réconciliation des IDs temporaires.

**Problème / opportunité.** Renommer ou supprimer une catégorie pendant la micro-fenêtre du POST de création renvoie un 400 et un rollback discret : les mutations optimistes concurrentes ne sont pas ordonnées.
**Proposition.** File FIFO côté client (petit module au-dessus de TanStack Mutation) : les mutations touchant la même entité s'enchaînent, les IDs temporaires sont réconciliés avec les IDs serveur avant l'envoi des mutations suivantes.
**Valeur** haute — **Effort** M — **Priorité** P1.
**Dépendance.** Socle pour INAB-9 (offline).

### INAB-5 — Santé de la synchro visible (monitoring + relance manuelle)
**Statut : FAIT.** Action `/api listSyncLogs`, composant SyncHealth dans Réglages, relance manuelle.

**Problème / opportunité.** La sync tourne 3x/jour en silence ; en cas d'échec (session expirée, erreur Enable Banking), l'utilisateur ne le découvre qu'en constatant l'absence de transactions.
**Proposition.** Lecture des `sync_logs` via `/api` : indicateur « dernière synchro il y a X h » dans Comptes/Réglages, badge d'erreur si le dernier run a échoué, bouton « Synchroniser maintenant », historique des 10 derniers runs dans Réglages.
**Valeur** haute — **Effort** S — **Priorité** P1.

### INAB-6 — Assignation guidée : « Financer tous les objectifs »
**Statut : FAIT.** Bouton « Financer les objectifs » (FundTargetsSheet), respect du RTA.

**Problème / opportunité.** Avec des objectifs (targets) posés, l'assignation mensuelle reste manuelle catégorie par catégorie : le rituel de début de mois est fastidieux.
**Proposition.** Bouton sur la page Budget : « Financer les objectifs » qui pré-remplit les assignations manquantes (montant nécessaire pour atteindre chaque target du mois), avec aperçu du total avant validation et respect du RTA (avertissement si dépassement). Variante par groupe dans le menu long-press.
**Valeur** haute — **Effort** M — **Priorité** P1.

---

## P2 — Forte valeur, après le socle

### INAB-7 — Transactions fractionnées (splits)
**Problème / opportunité.** Un ticket de supermarché mélange courses, hygiène et maison : impossible aujourd'hui de ventiler une transaction sur plusieurs enveloppes.
**Proposition.** Modèle : sous-lignes `{categoryId, amount}` dans le payload chiffré de la transaction (somme = montant total, validée par `/api`) ; le moteur d'enveloppes agrège par sous-ligne. UI : éditeur de ventilation dans la feuille d'édition (dépend d'INAB-1).
**Valeur** haute — **Effort** L — **Priorité** P2.
**Dépendance.** INAB-1 ; toucher `packages/engine` + tests Vitest.

### INAB-8 — Rapport valeur nette (net worth)
**Statut : FAIT.** Widget Patrimoine (NetWorthWidget) : courbe mensuelle actifs − passifs + ventilation par compte.

**Problème / opportunité.** Les comptes tracking (PEA) existent mais aucun rapport n'agrège patrimoine total dans le temps — le rapport signature de Copilot/YNAB manque.
**Proposition.** Widget Rapports : courbe mensuelle actifs − passifs (soldes reconstruits depuis les transactions, calcul côté `/api`), chiffre héros + tendance vs mois précédent, ventilation par compte.
**Valeur** haute — **Effort** M — **Priorité** P2.

### INAB-9 — Mode offline : cache persistant + file d'envoi différé
**Problème / opportunité.** Dans le métro, l'app ne montre rien (cache mémoire uniquement) et une saisie échoue avec rollback : frustrant pour une app de poche.
**Proposition.** Persistance du cache TanStack Query (localStorage/IDB, données déjà en clair côté client uniquement — pas de donnée chiffrée exposée en plus qu'aujourd'hui, à signaler : données lisibles sur l'appareil), et rejeu de la file de mutations (INAB-4) au retour du réseau, avec indicateur discret « en attente d'envoi ».
**Valeur** haute — **Effort** L — **Priorité** P2.
**Risque.** Cache en clair sur l'appareil : à valider explicitement vs la posture tout-chiffré ; dépend d'INAB-4.

### INAB-10 — Import CSV historique (item TODO, phase 2 du CLAUDE.md)
**Problème / opportunité.** L'historique antérieur à l'activation du compte n'existe pas dans l'app : rapports et moyennes sont faussés les premiers mois.
**Proposition.** Réglages > Import CSV : upload côté client, mapping colonnes (date, montant, libellé, compte), prévisualisation, envoi par lots à une action `/api` `importTransactions` (chiffrement + `tx_hash` pour dédup avec les imports bancaires), passage par le moteur de règles.
**Valeur** moyenne — **Effort** M — **Priorité** P2.

### INAB-11 — Cycle de facturation carte à débit différé (item TODO)
**Problème / opportunité.** Le virement de prélèvement carte est détecté, mais rien ne vérifie que le montant prélevé correspond bien à la somme des achats du cycle : les écarts (achat manquant, arbitrage de date) passent inaperçus.
**Proposition.** Paramètre de cycle par compte `card_deferred` (jour d'arrêté), écran de rapprochement : somme des achats du cycle vs montant du prélèvement apparié, badge d'alerte en cas d'écart avec liste des transactions du cycle.
**Valeur** moyenne — **Effort** M — **Priorité** P2.

### INAB-12 — Objectifs avancés : « recharge mensuelle » et échéance avec répétition
**Problème / opportunité.** Seuls deux types de targets existent (`monthly`, `byDate`) ; les cas « garder 200 € disponibles » (refill) et « facture annuelle récurrente » ne sont pas couverts.
**Proposition.** Deux nouveaux types dans `targets` (payload chiffré, moteur de calcul dans `lib/targets.ts` + `/api`) : « avoir X disponible chaque mois » (assigner la différence) et « X pour le JJ/MM, chaque année ». Affichage TargetBar adapté.
**Valeur** moyenne — **Effort** M — **Priorité** P2.
**Dépendance.** Synergie forte avec INAB-6.

### INAB-13 — Âge de l'argent (Age of Money)
**Problème / opportunité.** L'indicateur de rétention emblématique de YNAB manque : aucun signal ludique de progression globale qui donne envie de revenir chaque jour.
**Proposition.** Calcul FIFO côté `/api` (âge moyen en jours des euros dépensés, moyenne des 10 dernières dépenses), carte KPI en tête du Budget avec tendance et micro-explication au tap.
**Valeur** moyenne — **Effort** M — **Priorité** P2.

### INAB-14 — Transactions récurrentes planifiées
**Problème / opportunité.** Loyers et abonnements connus d'avance n'apparaissent qu'après import bancaire : impossible d'anticiper les prochains prélèvements ni de repérer une échéance manquée.
**Proposition.** Table chiffrée `scheduled_transactions` (fréquence, prochain dû, compte, catégorie, montant), section « À venir » dans Transactions et sur le compte, appariement à l'import (montant ± tolérance) qui marque l'échéance honorée ; alerte si dépassée.
**Valeur** moyenne — **Effort** L — **Priorité** P2.
**Risque.** Nouvelle table = migration SQL manuelle (SQL Editor) + index aveugles à concevoir.

---

## P3 — Confort, engagement, dette

### INAB-15 — Notifications push (re-consentement, sync en échec, à catégoriser)
**Problème / opportunité.** Les événements importants (session bancaire qui expire à J-14, sync en échec, transactions à catégoriser) ne sont visibles qu'en ouvrant l'app.
**Proposition.** Web Push via service worker (iOS 16.4+ exige la PWA installée) : souscription stockée chiffrée, envoi depuis sync-bank/pg_cron via l'API Web Push (clés VAPID en secret), contenu volontairement générique (« Nouvelles transactions à catégoriser ») pour ne rien fuiter.
**Valeur** moyenne — **Effort** L — **Priorité** P3.
**Dépendance.** INAB-3 (PWA installée) ; librairie web-push Deno à valider (stack).

### INAB-16 — Recherche globale et filtres enrichis dans Transactions
**Problème / opportunité.** La recherche actuelle est un filtre texte client sur la page paginée ; pas de recherche par catégorie, montant, plage de dates, ni depuis les autres vues.
**Proposition.** Panneau de filtres combinables (catégorie, compte, plage de dates, montant min/max, sans catégorie) + raccourci « voir les transactions » depuis une catégorie du Budget (mois + catégorie pré-filtrés). Filtrage côté client sur les données déjà déchiffrées.
**Valeur** moyenne — **Effort** S — **Priorité** P3.

### INAB-17 — Réconciliation manuelle guidée par compte
**Problème / opportunité.** La réconciliation automatique existe côté serveur pour les comptes liés, mais les comptes manuels (espèces, hors banque) dérivent sans outil de pointage.
**Proposition.** Sur la fiche compte : « Réconcilier » — saisir le solde réel, l'app calcule l'écart et propose une transaction d'ajustement (catégorie système « Ajustement de solde »), horodatage du dernier pointage affiché.
**Valeur** moyenne — **Effort** S — **Priorité** P3.

### INAB-18 — Découpage et durcissement des Edge Functions (dette)
**Problème / opportunité.** `api/index.ts` (~2 000 lignes) et `sync-bank/index.ts` (~1 500 lignes) concentrent 40+ actions dans deux fichiers : risque de régression croissant, aucune couverture de test hors engine/crypto.
**Proposition.** Découper en modules par domaine (transactions, budget, catégories, règles, banque) avec un routeur d'actions typé, extraire la logique pure testable (appariement carte différé, dédup, application des règles) vers des fonctions couvertes par Vitest.
**Valeur** moyenne — **Effort** M — **Priorité** P3.

---

## Récapitulatif

| ID | Titre | Valeur | Effort | Priorité | Statut |
|---|---|---|---|---|---|
| INAB-1 | Édition complète d'une transaction | Haute | M | P1 | FAIT |
| INAB-2 | Déplacer de l'argent / couvrir un dépassement | Haute | S | P1 | FAIT |
| INAB-3 | PWA réelle (manifest, standalone, safe-areas) | Haute | S | P1 | FAIT |
| INAB-4 | File de mutations optimistes sérialisée | Haute | M | P1 | FAIT |
| INAB-5 | Santé de la synchro visible | Haute | S | P1 | FAIT |
| INAB-6 | Financer tous les objectifs en un geste | Haute | M | P1 | FAIT |
| INAB-7 | Transactions fractionnées | Haute | L | P2 | À faire |
| INAB-8 | Rapport valeur nette | Haute | M | P2 | FAIT |
| INAB-9 | Mode offline (cache persistant + rejeu) | Haute | L | P2 | À faire |
| INAB-10 | Import CSV historique | Moyenne | M | P2 | À faire |
| INAB-11 | Cycle de facturation carte différé | Moyenne | M | P2 | À faire |
| INAB-12 | Objectifs avancés (refill, annuel) | Moyenne | M | P2 | À faire |
| INAB-13 | Âge de l'argent | Moyenne | M | P2 | À faire |
| INAB-14 | Transactions récurrentes planifiées | Moyenne | L | P2 | À faire |
| INAB-15 | Notifications push | Moyenne | L | P3 | À faire |
| INAB-16 | Recherche globale et filtres enrichis | Moyenne | S | P3 | À faire |
| INAB-17 | Réconciliation manuelle guidée | Moyenne | S | P3 | À faire |
| INAB-18 | Découpage des Edge Functions | Moyenne | M | P3 | À faire |
| INAB-19 | Import YNAB destructif | Haute | M | P1 | FAIT |
