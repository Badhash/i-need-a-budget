import { useRef } from 'react'
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react'

/**
 * Appui long tactile : declenche onLongPress apres `ms` si le doigt n'a pas
 * bouge de plus de 10px. Retourne les handlers a etaler sur l'element et
 * `firedRecently()` pour que le onClick qui suit un appui long soit ignore.
 */
export function useLongPress(onLongPress: () => void, ms = 450) {
  const timer = useRef<number | null>(null)
  const origin = useRef<{ x: number; y: number } | null>(null)
  const fired = useRef(false)

  const clear = () => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current)
      timer.current = null
    }
    origin.current = null
  }

  const handlers = {
    onPointerDown: (e: ReactPointerEvent) => {
      fired.current = false
      origin.current = { x: e.clientX, y: e.clientY }
      timer.current = window.setTimeout(() => {
        fired.current = true
        timer.current = null
        // Petit retour haptique la ou il est supporte.
        try {
          navigator.vibrate?.(10)
        } catch {
          // ignore
        }
        onLongPress()
      }, ms)
    },
    onPointerMove: (e: ReactPointerEvent) => {
      if (!origin.current) return
      const dx = e.clientX - origin.current.x
      const dy = e.clientY - origin.current.y
      if (dx * dx + dy * dy > 100) clear()
    },
    onPointerUp: clear,
    onPointerCancel: clear,
    onPointerLeave: clear,
    // iOS affiche sinon le menu systeme (copier / definir) sur appui long.
    onContextMenu: (e: ReactMouseEvent) => e.preventDefault(),
  }

  return { handlers, firedRecently: () => fired.current }
}
