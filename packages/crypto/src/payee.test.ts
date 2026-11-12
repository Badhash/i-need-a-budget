import { describe, expect, it } from 'vitest'
import { payeeKey } from './payee'

describe('payeeKey', () => {
  it('retire dates, montants et numeros', () => {
    expect(payeeKey('CARTE 12/03/24 AMAZON EU SARL 12,50EUR CB*1234')).toBe('amazon eu sarl')
    expect(payeeKey('PRELEVEMENT SEPA EDF REF 000123456')).toBe('edf ref')
  })
  it('est stable entre deux occurrences du meme marchand', () => {
    expect(payeeKey('CARTE 01/09 CARREFOUR MARKET PARIS 45,10')).toBe(
      payeeKey('CARTE 15/09 CARREFOUR MARKET PARIS 12,00'),
    )
  })
  it('ignore casse et accents', () => {
    expect(payeeKey('Boulangerie Générale')).toBe('boulangerie generale')
  })
  it('renvoie vide pour un libelle sans mot stable', () => {
    expect(payeeKey('12/03 1234')).toBe('')
  })
  it('garde les sigles a esperluette', () => {
    expect(payeeKey('CARTE 12/03 H&M 2341 CB*1234')).toBe('hm')
    expect(payeeKey('CARTE 12/03 C&A PARIS')).toBe('ca paris')
    expect(payeeKey('CARTE 12/03 M & S FOOD')).toBe('ms food')
  })
  it('decompose les ligatures', () => {
    expect(payeeKey('CARTE 12/03 CŒUR DE BLE')).toBe('coeur ble')
    expect(payeeKey('Æsop')).toBe('aesop')
  })
  it('ne memorise pas une cle qui ne designe aucun tiers', () => {
    expect(payeeKey('CHEQUE 1234567')).toBe('')
    expect(payeeKey('REMISE CHEQUE 0012345')).toBe('')
    expect(payeeKey('ECHEANCE PRET 12345678901')).toBe('')
    expect(payeeKey('VIR INST REF 123456')).toBe('')
    expect(payeeKey('CARTE 12/03 PARIS 15')).toBe('')
  })
  it('garde un tiers accompagne de mots generiques', () => {
    expect(payeeKey('PRELEVEMENT SEPA EDF REF 000123456')).toBe('edf ref')
    expect(payeeKey('VIR INST JEAN DUPONT')).toBe('inst jean dupont')
  })
  it('est idempotente sur ses propres cles', () => {
    for (const label of ['CARTE 12/03 H&M', 'CŒUR DE BLE', 'CARREFOUR MARKET PARIS']) {
      const key = payeeKey(label)
      expect(payeeKey(key)).toBe(key)
    }
  })
})
