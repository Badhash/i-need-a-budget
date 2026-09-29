// Identifiants des transactions creees dans la session : id temporaire (ajout
// optimiste) -> id serveur, et l'inverse.
//
// La file des mutations (mutationQueue) ne garde sa correspondance que le
// temps d'une rafale d'ecritures (videe au drainage). Or un id temporaire peut
// etre capture plus longtemps : « Annuler » d'un toast, dialogue d'edition
// ouvert sur une ligne tout juste saisie, feuille de detail. Cette table,
// propre a la session, permet de toujours retrouver l'id serveur, et de garder
// la meme cle React pour la ligne (aucun remontage a la confirmation).

const confirmedIds = new Map<string, string>()
const tempOfReal = new Map<string, string>()

/** Enregistre l'id serveur d'une transaction creee avec un id temporaire. */
export function registerConfirmedTx(tempId: string, realId: string): void {
  confirmedIds.set(tempId, realId)
  tempOfReal.set(realId, tempId)
}

/** Id courant d'une ligne (l'id temporaire d'un ajout confirme devient l'id serveur). */
export function followTxId(id: string): string {
  return confirmedIds.get(id) ?? id
}

/** Cle React stable d'une ligne : l'id temporaire d'origine survit a la confirmation. */
export function txRowKey(id: string): string {
  return tempOfReal.get(id) ?? id
}
