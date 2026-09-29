// Fonctionnalites SERVEUR optionnelles, annoncees par l'Edge Function /api dans
// la reponse bootstrap / bootstrapFull (`features: string[]`).
//
// Le front et les Edge Functions se deploient separement (Pages d'un cote,
// workflow deploy-functions de l'autre) : une interface qui depend d'un
// comportement serveur NOUVEAU doit rester masquee tant que le serveur deploye
// ne l'annonce pas. Un serveur ancien n'envoie pas `features` : ensemble vide,
// l'app garde son comportement historique. Des le redeploiement des fonctions,
// les fonctionnalites s'allument sans nouveau deploiement du front.

export const SERVER_FEATURES = {
  /** Virement entre un compte budget et un compte de suivi : la moitie cote
   * budget se categorise (sortie/entree du budget, regle YNAB). */
  crossBudgetTransfers: 'crossBudgetTransfers',
  /** updateAccount accepte onBudget (bascule budget/suivi) et closed (archivage). */
  accountFlags: 'accountFlags',
  /** setTarget accepte le type 'refill' (« recharger jusqu'a », report compris). */
  refillTargets: 'refillTargets',
  /** importReplaceTransactions accepte transferGroupId (paires de virements YNAB). */
  importTransfers: 'importTransfers',
} as const

export type ServerFeature = (typeof SERVER_FEATURES)[keyof typeof SERVER_FEATURES]
