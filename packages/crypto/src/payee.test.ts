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
})
