import { useEffect, useState } from 'react'

// Vrai au-dela du breakpoint lg de Tailwind (1024px). Sert a rendre des arbres
// DIFFERENTS sur mobile et desktop (contenu distinct, pas juste du CSS), sans
// monter les deux (evite des graphes Recharts dans un conteneur display:none).
const QUERY = '(min-width: 1024px)'

export function useIsDesktop(): boolean {
  const [isDesktop, setIsDesktop] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(QUERY).matches,
  )
  useEffect(() => {
    const mq = window.matchMedia(QUERY)
    const onChange = () => setIsDesktop(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  return isDesktop
}
