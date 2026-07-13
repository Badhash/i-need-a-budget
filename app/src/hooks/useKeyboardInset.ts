import { useEffect, useState } from 'react'

/**
 * Hauteur (px) occupee par le clavier virtuel iOS : Safari ne remonte pas les
 * elements position:fixed quand le clavier s'ouvre, il reduit seulement le
 * visualViewport. On mesure l'ecart pour caler les feuilles au-dessus.
 */
export function useKeyboardInset(): number {
  const [inset, setInset] = useState(0)

  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    const update = () => {
      setInset(Math.max(0, window.innerHeight - vv.height - vv.offsetTop))
    }
    vv.addEventListener('resize', update)
    vv.addEventListener('scroll', update)
    update()
    return () => {
      vv.removeEventListener('resize', update)
      vv.removeEventListener('scroll', update)
    }
  }, [])

  return inset
}
