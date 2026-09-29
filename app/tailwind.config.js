import animate from 'tailwindcss-animate'

// Couleur de token : triplet RGB (tokens.css) + opacite Tailwind.
const token = (name) => `rgb(var(--${name}) / <alpha-value>)`

// Courbe « ressort » du langage visuel Aurore (voir --ease-spring).
const spring = 'cubic-bezier(0.22, 1, 0.36, 1)'

/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: token('bg'),
        surface: token('surface'),
        surface2: token('surface2'),
        surface3: token('surface3'),
        ink: token('ink'),
        soft: token('soft'),
        line: token('line'),
        edge: token('edge'),
        // accent (DEFAULT) + variantes : accent-fg (texte sur l'accent),
        // accent-ink (texte accentue AA sur fond clair), accent-2 (degrades).
        accent: {
          DEFAULT: token('accent'),
          fg: token('accent-fg'),
          ink: token('accent-ink'),
          2: token('accent-2'),
        },
        accentfg: token('accent-fg'),
        success: token('success'),
        warning: token('warning'),
        danger: token('danger'),
        aura: {
          1: token('aura-1'),
          2: token('aura-2'),
        },
        // Ambre vif decoratif (pieces de l'ecran de chargement), jamais semantique.
        coin: {
          DEFAULT: token('coin'),
          fg: token('coin-fg'),
        },
        // Voile des feuilles et modales (couleur + opacite dans le token).
        scrim: 'var(--scrim)',
      },
      fontFamily: {
        sans: 'var(--font-sans)',
      },
      boxShadow: {
        card: 'var(--shadow-card)',
        fab: 'var(--shadow-fab)',
        raised: 'var(--shadow-raised)',
        elevated: 'var(--shadow-elevated)',
        glow: 'var(--shadow-glow)',
        button: 'var(--shadow-button)',
        bar: 'var(--shadow-bar)',
        highlight: 'var(--highlight)',
      },
      borderRadius: {
        '4xl': '2rem',
      },
      maxWidth: {
        content: '72rem',
      },
      transitionTimingFunction: {
        spring,
      },
      transitionDuration: {
        250: '250ms',
        280: '280ms',
        400: '400ms',
        600: '600ms',
      },
      // Les @keyframes vivent dans globals.css (source unique, noms inab-*) :
      // ils restent disponibles meme pour les classes CSS maison (.stagger,
      // .skeleton-shimmer) qui ne passent pas par ces utilitaires.
      animation: {
        'fade-up': `inab-fade-up 280ms ${spring} backwards`,
        'fade-in': 'inab-fade-in 200ms ease-out backwards',
        'fade-out': 'inab-fade-out 160ms ease-in forwards',
        'scale-in': `inab-scale-in 220ms ${spring} backwards`,
        'scale-out': 'inab-scale-out 150ms ease-in forwards',
        shimmer: 'inab-shimmer 1.6s ease-in-out infinite',
        'slide-up': `inab-slide-up 300ms ${spring}`,
        'slide-down': 'inab-slide-down 200ms cubic-bezier(0.4, 0, 1, 1) forwards',
        'modal-in': `inab-modal-in 240ms ${spring}`,
        'modal-out': 'inab-modal-out 150ms ease-in forwards',
        'toast-in': `inab-toast-in 280ms ${spring} backwards`,
        'toast-out': 'inab-toast-out 180ms ease-in forwards',
        pop: `inab-pop 320ms ${spring}`,
      },
    },
  },
  plugins: [animate],
}
