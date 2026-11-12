import { describe, expect, it } from 'vitest'
import { isLabelVariant } from './labelVariant'

// Libelles fictifs, calques des formes renvoyees par les banques.
describe('isLabelVariant', () => {
  it('reconnait un libelle complete apres coup', () => {
    expect(isLabelVariant('VIR Virement de JEAN DUPONT', 'VIR Virement de JEAN DUPONT DUPONT JEAN')).toBe(true)
    expect(
      isLabelVariant('VIR Virement depuis MaBanque', 'VIR Virement depuis MaBanque JEAN DUPONT Réf : SCT1234567890'),
    ).toBe(true)
  })

  it('reconnait un libelle carte tronque differemment, avec ou sans suffixe CB', () => {
    expect(isLabelVariant('CARTE 14/04/26 PAYPAL *STREAMING VIDEO SU', 'CARTE 14/04/26 PAYPAL *STREAMING VI CB*1234')).toBe(
      true,
    )
    expect(isLabelVariant('CARTE 25/04/26 BOUTIQUE PAYMENTS 2441535', 'CARTE 25/04/26 BOUTIQUE PAYMENTS 2 CB*1234')).toBe(
      true,
    )
    expect(isLabelVariant('CARTE 20/04/26 PAYPAL *MAGASINS', 'CARTE 20/04/26 PAYPAL *MAGASINS CB*1234')).toBe(true)
  })

  it('ignore casse, accents et espaces', () => {
    expect(isLabelVariant('Virement reçu de  Élodie MARTIN', 'VIREMENT RECU DE ELODIE MARTIN REF 123')).toBe(true)
  })

  it('distingue deux operations differentes', () => {
    expect(isLabelVariant('VIR Virement de JEAN DUPONT Réf : SCT111', 'VIR Virement de JEAN DUPONT Réf : SCT222')).toBe(false)
    expect(isLabelVariant('CARTE 13/10/26 CAFE DU COIN', 'CARTE 14/10/26 CAFE DU COIN')).toBe(false)
    expect(isLabelVariant('PRELEVEMENT ORANGE MOBILE', 'PRELEVEMENT FREE MOBILE')).toBe(false)
  })

  it('refuse les libelles trop courts pour conclure', () => {
    expect(isLabelVariant('VIR', 'VIR INST')).toBe(false)
    expect(isLabelVariant('CARTE X', 'CARTE X1234 MAGASIN')).toBe(false)
  })

  it('ne compte pas le prefixe carte dans la longueur minimale', () => {
    expect(isLabelVariant('CARTE 14/04/26 SNCF', 'CARTE 14/04/26 SNCF INTERNET')).toBe(false)
    expect(isLabelVariant('CARTE 14/04/26 SNCF CB*1234', 'CARTE 14/04/26 SNCF INTERNET')).toBe(false)
    expect(isLabelVariant('CARTE 14/04/26 BOULANGERIE', 'CARTE 14/04/26 BOULANGERIE DU MARCHE')).toBe(false)
    expect(isLabelVariant('CARTE 14/04/26 BOULANGERIE DU', 'CARTE 14/04/26 BOULANGERIE DU MARCHE')).toBe(true)
  })
})
