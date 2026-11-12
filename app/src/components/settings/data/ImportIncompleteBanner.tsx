// Bandeau d'import incomplet (AppShell) : un remplacement complet (import YNAB
// ou restauration) a commence a effacer sans se terminer, typiquement avant un
// rechargement de la page qui a perdu la reprise en memoire. Le signal est un
// drapeau local sans donnee (lib/ynabImport.ts) ; il renvoie vers Reglages >
// Donnees, ou se trouvent la restauration et le fichier de sauvegarde.

import { useEffect, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { TriangleAlert, X } from 'lucide-react'
import { IMPORT_INCOMPLETE_EVENT, clearImportIncomplete, readImportIncomplete, useImportStore } from '@/lib/ynabImport'
import { Button } from '@/components/ui/button'

const DATA_SECTION = 'donnees'

/** Defile jusqu'a la section Donnees des que la page Reglages l'a rendue. */
function scrollToDataSection(attempt = 0): void {
  const el = document.getElementById(DATA_SECTION)
  if (el) {
    const smooth = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches !== true
    el.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'start' })
    return
  }
  if (attempt < 30) window.setTimeout(() => scrollToDataSection(attempt + 1), 50)
}

export function ImportIncompleteBanner() {
  const navigate = useNavigate()
  const [flagged, setFlagged] = useState(readImportIncomplete)
  // Un import suivi en memoire (en cours, interrompu, termine) a son propre
  // panneau dans Reglages : le bandeau ne sert qu'apres un rechargement ou un
  // abandon.
  const idle = useImportStore((s) => s.phase === 'idle')

  useEffect(() => {
    const update = () => setFlagged(readImportIncomplete())
    window.addEventListener(IMPORT_INCOMPLETE_EVENT, update)
    window.addEventListener('storage', update)
    return () => {
      window.removeEventListener(IMPORT_INCOMPLETE_EVENT, update)
      window.removeEventListener('storage', update)
    }
  }, [])

  if (!flagged || !idle) return null
  return (
    <div
      role="status"
      className="mb-5 flex animate-fade-up flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl border border-warning/25 bg-warning/10 py-2.5 pl-3 pr-2"
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-warning/15 text-warning">
        <TriangleAlert className="h-[18px] w-[18px]" />
      </span>
      <p className="min-w-0 flex-1 basis-48 text-[13.5px] leading-snug text-ink">
        <span className="font-medium">Un import n’est pas allé au bout.</span>{' '}
        <span className="text-soft">
          Ton budget est peut-être incomplet : restaure ta sauvegarde ou relance l’import.
        </span>
      </p>
      <div className="ml-auto flex shrink-0 items-center gap-1">
        <Button
          variant="soft"
          size="sm"
          onClick={() => {
            void navigate({ to: '/reglages' }).then(() => scrollToDataSection())
          }}
        >
          Ouvrir les réglages
        </Button>
        <Button
          variant="ghost"
          size="iconSm"
          onClick={clearImportIncomplete}
          aria-label="Masquer ce signal"
          className="relative after:absolute after:-inset-1 after:content-['']"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}
