# TODO — I Need A Budget

Liste des chantiers restants / idees, hors specification figee du CLAUDE.md.

## Bancaire

### Cartes a debit differe (ex. carte World Elite)
Probleme : une carte a debit differe genere des achats au fil du mois, puis un
SEUL gros prelevement en fin de mois sur le compte de depot. Si on importe les
deux comptes et qu'on categorise a la fois les achats carte ET le prelevement
groupe, on compte les depenses DEUX fois.

Solution (methode YNAB) :
- Lier la carte a un compte local distinct (deja possible via « Associer a… »).
- Chaque achat carte = transaction sur le compte carte, categorisee → impacte le budget.
- Le prelevement mensuel groupe sur le compte de depot n'est PAS une depense :
  c'est un VIREMENT (transfer, sans categorie) du compte de depot vers le compte
  carte. Il solde la carte, sans re-impacter les enveloppes → chaque depense n'est
  comptee qu'une fois.

A implementer :
- [ ] Detection auto du prelevement carte (libelle + montant = somme des
      transactions carte du cycle) → le marquer automatiquement comme virement
      (transferGroupId) vers le compte carte, sans categorie.
- [ ] Action UI « convertir une transaction en virement » (pour le faire a la main
      en attendant l'auto-detection).
- [ ] Type de compte « carte a debit differe » avec cycle de facturation.

En attendant (manuel) : lier les deux comptes, categoriser les achats carte, et
NE PAS categoriser le prelevement mensuel (le marquer virement ou l'exclure).

### Import de l'historique + solde d'ouverture
Aujourd'hui la synchro n'importe que les transactions POSTERIEURES a la date de
connexion (pour ne pas doubler avec le solde d'ouverture saisi a la main). Donc
pas d'historique visible au depart.
- [ ] Import optionnel des N derniers jours a la premiere synchro.
- [ ] Reconciliation : fixer le solde d'ouverture au solde a la date de debut
      d'import (via les balances Enable Banking) pour eviter le double comptage.

## Produit / UX

- [ ] Rendre categories et groupes editables : renommer, ajouter, supprimer,
      reordonner (actions /api + ecran d'edition).
- [ ] Persister la page courante au hard refresh (Ctrl+Shift+R) et au retour du
      consentement bancaire (ne pas retomber systematiquement sur Budget).
- [ ] Categorisation optimiste (comme l'assignation) : la categorie s'applique
      instantanement, POST en arriere-plan.

## Fait recemment

- [x] Connexion Enable Banking : selecteur de banque avec recherche + logo.
- [x] Liaison compte bancaire ↔ compte local, IBAN masque (cote serveur).
- [x] Message de synchro explicite (0 compte associe / 0 transaction / N importees).
- [x] Menu mobile flottant iOS, onboarding centre, icone d'app.
