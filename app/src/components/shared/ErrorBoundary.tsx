import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  failed: boolean
}

/**
 * Filet global : sans lui, une exception de rendu (ex. chunk introuvable apres
 * un deploiement, cf. router.tsx) demonte toute l'app et laisse un ecran
 * blanc. On affiche un ecran sobre avec un bouton de rechargement.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { failed: false }

  static getDerivedStateFromError(): State {
    return { failed: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Jamais de donnees metier ici : seulement le message technique.
    console.error('Erreur de rendu', error.message, info.componentStack)
  }

  render(): ReactNode {
    if (!this.state.failed) return this.props.children
    return (
      <div className="flex min-h-app flex-col items-center justify-center gap-4 bg-bg px-6 text-center text-ink">
        <p className="text-[17px] font-semibold">Une erreur est survenue.</p>
        <p className="max-w-sm text-[14px] text-soft">
          L'application n'a pas pu afficher cet écran. Recharger règle le problème dans la plupart
          des cas, tes données sont en sécurité.
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="inline-flex min-h-[44px] items-center rounded-xl bg-accent px-5 text-[14px] font-semibold text-accentfg"
        >
          Recharger l'application
        </button>
      </div>
    )
  }
}
