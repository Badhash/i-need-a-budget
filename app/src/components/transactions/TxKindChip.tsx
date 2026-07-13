// Pastille indiquant le type d'operation bancaire (deduit du libelle brut).
// Reutilise les variables pastel --cat-*-bg/fg de tokens.css : lisible en
// light et dark quel que soit le theme.

import type { BankLabelKind } from '@/lib/bankLabel'
import type { CatColor } from '@/styles/themes'

const LABELS: Record<Exclude<BankLabelKind, 'autre'>, string> = {
  virement_recu: 'Virement reçu',
  virement_emis: 'Virement émis',
  prelevement: 'Prélèvement',
  carte: 'Carte',
  retrait: 'Retrait',
  versement: 'Versement',
  pret: 'Prêt',
  reglement: 'Règlement',
  cotisation: 'Cotisation',
  interets: 'Intérêts',
  cheque: 'Chèque',
  solde: 'Solde',
}

// Mapping harmonieux vers les 6 palettes pastel existantes.
const COLORS: Record<Exclude<BankLabelKind, 'autre'>, CatColor> = {
  virement_recu: 'green',
  virement_emis: 'blue',
  prelevement: 'amber',
  carte: 'purple',
  retrait: 'teal',
  versement: 'teal',
  pret: 'blue',
  reglement: 'pink',
  cotisation: 'amber',
  interets: 'green',
  cheque: 'teal',
  solde: 'teal',
}

export function TxKindChip({ kind }: { kind: BankLabelKind }) {
  // Le kind 'autre' n'apporte aucune information : pas de pastille.
  if (kind === 'autre') return null
  const color = COLORS[kind]
  return (
    <span
      className="inline-flex shrink-0 items-center whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium"
      style={{
        backgroundColor: `var(--cat-${color}-bg)`,
        color: `var(--cat-${color}-fg)`,
      }}
    >
      {LABELS[kind]}
    </span>
  )
}
