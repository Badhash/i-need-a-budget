import { useEffect, useState } from 'react'
import { CHART_PALETTES, type ChartPalette } from '@/styles/themes'
import { resolveDark, useUiStore } from '@/stores/ui'

/** Applique data-theme + classe dark sur <html> et suit la preference systeme. */
export function useThemeController() {
  const theme = useUiStore((s) => s.theme)
  const mode = useUiStore((s) => s.mode)

  useEffect(() => {
    const root = document.documentElement
    root.classList.add('theme-anim')
    root.dataset.theme = theme
    root.classList.toggle('dark', resolveDark(mode))
    const timer = setTimeout(() => root.classList.remove('theme-anim'), 300)
    return () => clearTimeout(timer)
  }, [theme, mode])

  useEffect(() => {
    if (mode !== 'system') return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => {
      document.documentElement.classList.toggle('dark', mq.matches)
    }
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [mode])
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
