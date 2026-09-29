/**
 * Donne le focus au champ de recherche du selecteur de categorie des qu'il est
 * monte. En desktop, le panneau n'apparait qu'une image apres l'ouverture (il
 * attend sa position) : sans ce relais, taper, Entree et Echap n'atteignent
 * pas le selecteur ouvert au clavier ou a la souris.
 */
export function focusCategorySearch(): void {
  let tries = 0
  const tick = () => {
    const input = document.querySelector<HTMLInputElement>('[data-inab-popover] input')
    if (input) {
      if (document.activeElement !== input) input.focus()
      return
    }
    tries += 1
    if (tries < 12) requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
}
