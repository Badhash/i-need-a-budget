import { useEffect, useState } from 'react'
import { CHART_PALETTES, THEMES, type ChartPalette, type ThemeId } from '@/styles/themes'
import { resolveDark, useUiStore } from '@/stores/ui'

/**
 * Aligne le chrome systeme sur le theme ET le mode EFFECTIFS de l'app (qui
 * peut etre en sombre sur un appareil en clair, et inversement) :
 *  - <meta name="theme-color"> (barre d'etat Android, barre d'onglets Safari,
 *    fenetre PWA desktop) : toutes les balises, quel que soit leur media, prennent
 *    le fond courant ;
 *  - barre d'etat iOS en mode standalone : texte clair sur contenu sombre
 *    (black-translucent, bord a bord) en sombre, style par defaut (texte fonce)
 *    en clair. iOS relit la balise au lancement (le script de index.html la pose
 *    avant le premier rendu) ; un changement a chaud est pris en compte selon
 *    les versions.
 */
export function syncSystemChrome(theme: ThemeId, dark: boolean): void {
  const meta = THEMES.find((t) => t.id === theme) ?? THEMES[0]!
  const color = dark ? meta.preview.darkBg : meta.preview.bg
  document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]').forEach((m) => {
    m.content = color
  })
  const statusBar = document.querySelector<HTMLMetaElement>('meta[name="apple-mobile-web-app-status-bar-style"]')
  if (statusBar) statusBar.content = dark ? 'black-translucent' : 'default'
}

/** Applique data-theme + classe dark sur <html> et suit la preference systeme. */
export function useThemeController() {
  const theme = useUiStore((s) => s.theme)
  const mode = useUiStore((s) => s.mode)

  useEffect(() => {
    const root = document.documentElement
    const dark = resolveDark(mode)
    root.classList.add('theme-anim')
    root.dataset.theme = theme
    root.classList.toggle('dark', dark)
    syncSystemChrome(theme, dark)
    const timer = setTimeout(() => root.classList.remove('theme-anim'), 300)
    return () => clearTimeout(timer)
  }, [theme, mode])

  useEffect(() => {
    if (mode !== 'system') return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => {
      document.documentElement.classList.toggle('dark', mq.matches)
      syncSystemChrome(theme, mq.matches)
    }
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [mode, theme])
}

/** Palette hexadecimale courante pour les graphes Recharts. */
export function useChartPalette(): ChartPalette {
  const theme = useUiStore((s) => s.theme)
  const mode = useUiStore((s) => s.mode)
  const [systemDark, setSystemDark] = useState(
    () => window.matchMedia('(prefers-color-scheme: dark)').matches,
  )

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => setSystemDark(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  const dark = mode === 'system' ? systemDark : mode === 'dark'
  return CHART_PALETTES[theme][dark ? 'dark' : 'light']
}
