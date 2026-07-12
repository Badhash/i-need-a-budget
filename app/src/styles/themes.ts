// Metadonnees des themes + palettes hexadecimales pour les graphes Recharts
// (les SVG ne resolvent pas var() en attribut : on duplique ici les valeurs
// de tokens.css, qui reste la source unique pour tout le reste).

export type ThemeId = 'corail' | 'menthe' | 'nuit'
export type Mode = 'light' | 'dark' | 'system'
export type CatColor = 'blue' | 'green' | 'amber' | 'pink' | 'purple' | 'teal'

export interface ThemeMeta {
  id: ThemeId
  label: string
  tagline: string
  font: string
  preview: {
    bg: string
    surface: string
    accent: string
    text: string
    darkBg: string
    darkSurface: string
    darkAccent: string
  }
}

// Theme par defaut : nuit (choix utilisateur). Les autres restent selectionnables.
export const THEMES: ThemeMeta[] = [
  {
    id: 'corail',
    label: 'Corail',
    tagline: 'Chaleureux et arrondi, inspiré de Copilot Money',
    font: 'Instrument Sans',
    preview: {
      bg: '#faf9f7',
      surface: '#ffffff',
      accent: '#ff6b5e',
      text: '#1a1a1a',
      darkBg: '#141414',
      darkSurface: '#1e1e1e',
      darkAccent: '#ff7a6e',
    },
  },
  {
    id: 'menthe',
    label: 'Menthe',
    tagline: 'Frais et apaisant, vert menthe et tons doux',
    font: 'Outfit',
    preview: {
      bg: '#f6faf8',
      surface: '#ffffff',
      accent: '#0d9476',
      text: '#0f1f1a',
      darkBg: '#0d1412',
      darkSurface: '#151f1c',
      darkAccent: '#2ed3a7',
    },
  },
  {
    id: 'nuit',
    label: 'Nuit',
    tagline: 'Premium et contrasté, violet électrique',
    font: 'Space Grotesk',
    preview: {
      bg: '#f7f6fb',
      surface: '#ffffff',
      accent: '#704efa',
      text: '#17151f',
      darkBg: '#111018',
      darkSurface: '#1a1824',
      darkAccent: '#9b85ff',
    },
  },
]

export interface ChartPalette {
  accent: string
  success: string
  danger: string
  soft: string
  grid: string
  cats: Record<CatColor, string>
}

export const CHART_PALETTES: Record<ThemeId, Record<'light' | 'dark', ChartPalette>> = {
  corail: {
    light: {
      accent: '#ff6b5e',
      success: '#29a863',
      danger: '#e5484d',
      soft: '#8a847b',
      grid: '#ebe8e2',
      cats: {
        blue: '#3b6fb5',
        green: '#1f9d5b',
        amber: '#a8700f',
        pink: '#c94f63',
        purple: '#7a5fc7',
        teal: '#1f8d85',
      },
    },
    dark: {
      accent: '#ff7a6e',
      success: '#3dd68c',
      danger: '#f2555a',
      soft: '#9e9890',
      grid: '#302e2b',
      cats: {
        blue: '#8fb8e8',
        green: '#7cd9a5',
        amber: '#ebc178',
        pink: '#ee9eac',
        purple: '#bba5f0',
        teal: '#7fd1ca',
      },
    },
  },
  menthe: {
    light: {
      accent: '#0d9476',
      success: '#169e5a',
      danger: '#e0424c',
      soft: '#687d75',
      grid: '#deebe5',
      cats: {
        blue: '#33689c',
        green: '#178a50',
        amber: '#9c6d11',
        pink: '#bf4e6e',
        purple: '#6f58bd',
        teal: '#12857c',
      },
    },
    dark: {
      accent: '#2ed3a7',
      success: '#5cd68f',
      danger: '#f05c61',
      soft: '#8da199',
      grid: '#283732',
      cats: {
        blue: '#8cb6e6',
        green: '#7bdba4',
        amber: '#e6c078',
        pink: '#ec9dab',
        purple: '#b8a4ee',
        teal: '#7dd3ca',
      },
    },
  },
  nuit: {
    light: {
      accent: '#704efa',
      success: '#24a560',
      danger: '#e5484d',
      soft: '#746f84',
      grid: '#e7e4f0',
      cats: {
        blue: '#3d6bc0',
        green: '#1e9a58',
        amber: '#a06c12',
        pink: '#c2498f',
        purple: '#7150e0',
        teal: '#1b8e96',
      },
    },
    dark: {
      accent: '#9b85ff',
      success: '#54d695',
      danger: '#f25a64',
      soft: '#9691a8',
      grid: '#2d2a3c',
      cats: {
        blue: '#93b4f2',
        green: '#7adfac',
        amber: '#eec583',
        pink: '#ef9dcb',
        purple: '#bfabff',
        teal: '#83d4dc',
      },
    },
  },
}
