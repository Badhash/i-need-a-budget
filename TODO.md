# TODO — I Need A Budget

Liste des chantiers restants / idees, hors specification figee du CLAUDE.md.

## Restant

- [ ] Cycle de facturation configurable par carte a debit differe (verification
      montant du prelevement = somme des achats du cycle) — INAB-11, raffinement futur.
- [ ] Import CSV historique bancaire (INAB-10, phase 2 du CLAUDE.md). L'import
      YNAB destructif existe deja ; il s'agit ici de l'import CSV releve bancaire.

## Fait recemment

### File de mutations optimistes serialisee (INAB-4)
- [x] File FIFO cote client (app/src/lib/mutationQueue.ts) au-dessus de TanStack :
      les mutations touchant la meme entite s'enchainent, les IDs temporaires sont
      reconcilies avec les IDs serveur avant l'envoi des mutations suivantes.
      Corrige le 400 sur renommer/supprimer pendant la micro-fenetre de creation.

### Cartes a debit differe (methode YNAB)
Le prelevement mensuel groupe n'est pas une depense : c'est un virement du compte
de depot vers le compte carte, sans categorie, pour ne compter chaque achat qu'une fois.
- [x] Detection auto du prelevement carte apres chaque synchro : un debit
      « CARTE DEPENSES » sans categorie est apparie au credit oppose sur un autre
      compte (±5 jours, match unique) et les deux sont lies en virement. Repli :
      s'il existe un unique compte « carte a debit differe » NON lie a Enable
      Banking, la transaction miroir est creee dessus.
- [x] Action UI « convertir en virement vers… » et « annuler le virement »
      (menu par ligne dans Transactions).
- [x] Type de compte « carte a debit differe » (kind card_deferred).

### Import de l'historique + solde d'ouverture
- [x] Import des N derniers jours (30/90/180/365) depuis Reglages > Connexion
      bancaire > « Importer l'historique ».
- [x] Reconciliation automatique : le solde d'ouverture est recale pour que le
      solde local corresponde au solde reel Enable Banking (action reconcile,
      enchainee cote serveur a tout sync avec sinceDays).

### Produit / UX
- [x] Libelles bancaires courts : parseur d'affichage (app/src/lib/bankLabel.ts)
      qui classe chaque transaction (virement recu/emis, prelevement, carte,
      retrait, versement, pret, reglement, cotisation, interets, cheque) avec
      pastille coloree ; libelle brut conserve (tooltip + dedup + regles).
- [x] Categories et groupes editables : renommer, ajouter, supprimer, reordonner
      (Reglages > Categories, actions /api, mises a jour optimistes).
- [x] Page courante persistee au hard refresh et au retour du consentement
      bancaire (localStorage inab:last-path, liste blanche de routes).
- [x] Categorisation optimiste : la categorie s'applique instantanement,
      POST en arriere-plan, rollback discret en cas d'echec.
- [x] Connexion Enable Banking : selecteur de banque avec recherche + logo.
- [x] Liaison compte bancaire ↔ compte local, IBAN masque (cote serveur).
- [x] Message de synchro explicite (0 compte associe / 0 transaction / N importees).
- [x] Menu mobile flottant iOS, onboarding centre, icone d'app.
