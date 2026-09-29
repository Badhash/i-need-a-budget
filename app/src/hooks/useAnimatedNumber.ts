import { useEffect, useRef, useState } from 'react'

// Sortie douce facon ressort (ease-out quartique) : demarre vite, se pose sans rebond.
const easeOut = (t: number) => 1 - Math.pow(1 - t, 4)

/**
 * Interpole en douceur vers la valeur cible (compteur de montant). Aucune
 * animation au premier rendu (la valeur initiale s'affiche telle quelle) ; une
 * nouvelle cible en cours de route repart de la valeur AFFICHEE (pas de saut).
 * Respecte prefers-reduced-motion (valeur finale immediate).
 */
export function useAnimatedNumber(target: number, durationMs = 450): number {
  const [value, setValue] = useState(target)
  const shownRef = useRef(target)
  const rafRef = useRef<number>()

  useEffect(() => {
    const from = shownRef.current
    if (from === target) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      shownRef.current = target
      setValue(target)
      return
    }
    const start = performance.now()
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs)
      const current = Math.round(from + (target - from) * easeOut(t))
      shownRef.current = current
      setValue(current)
      if (t < 1) rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  }, [target, durationMs])

  return value
}
