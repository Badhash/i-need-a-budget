// Outils des couches ancrees de la grille desktop (popover « Deplacer de
// l'argent », valeurs rapides sous l'editeur d'assigne) : position fixed
// calee sur l'ancre et bornee au viewport, piege a focus, fermeture au clic
// exterieur. Les couches sont portalisees dans body : la carte de la grille
// rogne son contenu (coins arrondis), une couche absolue y serait coupee.

import { useEffect, useLayoutEffect, useState, type KeyboardEvent, type RefObject } from 'react'

/** Marge minimale entre une couche et le bord du viewport (px). */
const VIEWPORT_MARGIN = 12

export interface AnchoredBox {
  /** Bord gauche (couche de largeur fixe). */
  left?: number
  /** Bord droit (couche a largeur de contenu, alignee sur la fin de l'ancre). */
  right?: number
  top?: number
  bottom?: number
  width?: number
  maxWidth?: number
  maxHeight: number
  placement: 'below' | 'above' | 'left'
  /** Placement lateral : ordonnee du centre de l'ancre dans la couche (fleche). */
  arrowY?: number
}

interface AnchoredOptions {
  /** Largeur fixe ; absente = largeur du contenu, alignee sur le bord droit de l'ancre. */
  width?: number
  /** Ecart entre l'ancre et la couche (px). */
  gap?: number
  /** Hauteur souhaitee : en dessous de cet espace libre, la couche peut passer au-dessus. */
  preferHeight?: number
  /**
   * 'left' : a gauche de l'ancre, centree sur elle puis bornee au viewport
   * (repli dessous/dessus faute de place). Largeur fixe requise.
   */
  side?: 'left'
  /** Hauteur mesuree de la couche (placement lateral) ; estimation sinon. */
  layerHeight?: number
  /** Placement lateral : distance du haut de la couche a son point d'accroche. */
  alignOffset?: number
}

function measure(
  anchor: HTMLElement,
  { width, gap = 8, preferHeight = 420, side, layerHeight, alignOffset = 32 }: AnchoredOptions,
): AnchoredBox {
  const r = anchor.getBoundingClientRect()
  const vw = window.innerWidth
  const vh = window.innerHeight
  const below = vh - r.bottom - gap - VIEWPORT_MARGIN
  const above = r.top - gap - VIEWPORT_MARGIN

  if (side === 'left' && width !== undefined) {
    const w = Math.min(width, vw - 2 * VIEWPORT_MARGIN)
    const left = r.left - gap - w
    if (left >= VIEWPORT_MARGIN) {
      const maxHeight = vh - 2 * VIEWPORT_MARGIN
      const h = Math.min(layerHeight ?? preferHeight, maxHeight)
      const anchorY = r.top + r.height / 2
      const top = Math.min(Math.max(anchorY - alignOffset, VIEWPORT_MARGIN), vh - VIEWPORT_MARGIN - h)
      return { left, top, width: w, maxHeight, placement: 'left', arrowY: anchorY - top }
    }
  }

  const horizontal: Pick<AnchoredBox, 'left' | 'right' | 'width' | 'maxWidth'> =
    width !== undefined
      ? (() => {
          const w = Math.min(width, vw - 2 * VIEWPORT_MARGIN)
          const left = Math.min(Math.max(r.right - w, VIEWPORT_MARGIN), vw - VIEWPORT_MARGIN - w)
          return { left, width: w }
        })()
      : {
          right: Math.max(vw - r.right, VIEWPORT_MARGIN),
          maxWidth: Math.max(r.right - VIEWPORT_MARGIN, 160),
        }

  // Ni dessous ni dessus : la couche occupe la hauteur du viewport (elle
  // recouvre alors son ancre plutot que d'etre coupee).
  if (Math.max(below, above) < 200) {
    return { ...horizontal, top: VIEWPORT_MARGIN, maxHeight: vh - 2 * VIEWPORT_MARGIN, placement: 'below' }
  }
  if (below >= preferHeight || below >= above) {
    return { ...horizontal, top: r.bottom + gap, maxHeight: below, placement: 'below' }
  }
  return { ...horizontal, bottom: vh - r.top + gap, maxHeight: above, placement: 'above' }
}

/**
 * Position fixed d'une couche ancree sous (ou au-dessus de) son ancre, recalee
 * au defilement (capture : n'importe quel conteneur) et au redimensionnement,
 * une fois par frame au plus. null tant que l'ancre est absente.
 */
export function useAnchoredBox(anchor: HTMLElement | null, options: AnchoredOptions): AnchoredBox | null {
  const [box, setBox] = useState<AnchoredBox | null>(null)
  const { width, gap, preferHeight, side, layerHeight, alignOffset } = options

  useLayoutEffect(() => {
    if (!anchor) {
      setBox(null)
      return
    }
    let frame = 0
    const place = () => {
      frame = 0
      // Ancre retiree du DOM (ligne masquee, groupe replie) : on garde la
      // derniere position, le proprietaire de la couche la ferme.
      if (!anchor.isConnected) return
      setBox(measure(anchor, { width, gap, preferHeight, side, layerHeight, alignOffset }))
    }
    place()
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(place)
    }
    window.addEventListener('scroll', schedule, true)
    window.addEventListener('resize', schedule)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('scroll', schedule, true)
      window.removeEventListener('resize', schedule)
    }
  }, [anchor, width, gap, preferHeight, side, layerHeight, alignOffset])

  return box
}

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * Piege a focus d'une couche (a brancher sur son onKeyDown) : Tab et Maj+Tab
 * bouclent sur les elements focusables de la couche au lieu d'en sortir.
 */
export function trapTabKey(e: KeyboardEvent<HTMLElement>): void {
  if (e.key !== 'Tab') return
  const items = Array.from(e.currentTarget.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => el.tabIndex >= 0 && el.getClientRects().length > 0,
  )
  if (items.length === 0) return
  const first = items[0]!
  const last = items[items.length - 1]!
  const active = document.activeElement
  if (e.shiftKey && (active === first || !e.currentTarget.contains(active))) {
    e.preventDefault()
    last.focus()
  } else if (!e.shiftKey && (active === last || !e.currentTarget.contains(active))) {
    e.preventDefault()
    first.focus()
  }
}

/**
 * Fermeture au clic (pointerdown) hors de la couche et hors de son ancre :
 * un clic sur l'ancre reste gere par l'ancre elle-meme (bascule).
 */
export function useDismissOnOutsidePointer(
  layer: RefObject<HTMLElement>,
  anchor: HTMLElement | null,
  onDismiss: () => void,
): void {
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const target = e.target as Node | null
      if (!target) return
      if (layer.current?.contains(target) || anchor?.contains(target)) return
      onDismiss()
    }
    document.addEventListener('pointerdown', onDown, true)
    return () => document.removeEventListener('pointerdown', onDown, true)
  }, [layer, anchor, onDismiss])
}
