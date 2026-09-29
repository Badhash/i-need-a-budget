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
      // setState est un no-op si la valeur ne change pas : le polling est gratuit.
      setInset(Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop)))
    }
    vv.addEventListener('resize', update)
    vv.addEventListener('scroll', update)
    window.addEventListener('focusin', update)
    window.addEventListener('focusout', update)
    // Filet : en mode standalone (ecran d'accueil), iOS n'emet pas toujours
    // resize a l'ouverture du clavier ; on re-mesure periodiquement.
    const timer = window.setInterval(update, 250)
    update()
    return () => {
      vv.removeEventListener('resize', update)
      vv.removeEventListener('scroll', update)
      window.removeEventListener('focusin', update)
      window.removeEventListener('focusout', update)
      window.clearInterval(timer)
    }
  }, [])

  return inset
}

const SM_UP = '(min-width: 640px)'

/**
 * Variante pour les feuilles basses (DialogContent) : au-dela de sm (640px), le
 * dialog est une modale CENTREE par transform ; lui appliquer un decalage
 * clavier remplacerait ce transform et casserait son centrage (iPad, fenetre
 * etroite). On ne remonte donc la feuille que sous sm.
 */
export function useSheetKeyboardInset(): number {
  const inset = useKeyboardInset()
  const [smUp, setSmUp] = useState(() => window.matchMedia(SM_UP).matches)
  useEffect(() => {
    const mq = window.matchMedia(SM_UP)
    const onChange = () => setSmUp(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  return smUp ? 0 : inset
}
