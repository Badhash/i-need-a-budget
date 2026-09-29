// Confirmation d'un remplacement complet (import YNAB, restauration) avec
// sauvegarde de securite OBLIGATOIRE : l'export est prepare des l'ouverture de
// la feuille, puis enregistre dans le geste de confirmation (exige par la
// feuille de partage iOS) juste avant l'effacement. Sans sauvegarde prete,
// rien ne peut etre efface.

import { useEffect, useState, type ReactNode } from 'react'
import { CircleAlert, CircleCheck, Landmark, ShieldCheck } from 'lucide-react'
import type { SavedFile } from '@/lib/ynabImport'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { fetchBackup, fmtSize, saveFile } from '@/components/settings/data/download'

type BackupState = { status: 'loading' } | { status: 'ready'; file: SavedFile } | { status: 'error' }

export function ReplaceConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  onConfirm,
  onClose,
}: {
  open: boolean
  title: string
  /** Ce qui va remplacer les donnees actuelles (resume). */
  children: ReactNode
  confirmLabel: string
  onConfirm: (backup: SavedFile) => void
  onClose: () => void
}) {
  const [backup, setBackup] = useState<BackupState>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)
  const [cancelled, setCancelled] = useState(false)

  // Sauvegarde de securite preparee des l'ouverture (et a chaque nouvel essai).
  useEffect(() => {
    if (!open) return
    let alive = true
    setBackup({ status: 'loading' })
    setCancelled(false)
    fetchBackup('sauvegarde-avant-remplacement')
      .then((file) => alive && setBackup({ status: 'ready', file }))
      .catch(() => alive && setBackup({ status: 'error' }))
    return () => {
      alive = false
    }
  }, [open, attempt])

  const confirm = async () => {
    if (backup.status !== 'ready') return
    // Enregistrement dans le geste (la feuille de partage iOS l'exige), puis
    // effacement. Feuille fermee sans enregistrer : rien n'est efface.
    const saved = await saveFile(backup.file)
    if (!saved) {
      setCancelled(true)
      return
    }
    onConfirm(backup.file)
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="pr-8">{title}</DialogTitle>
          <DialogDescription>
            Tes comptes, catégories, transactions, objectifs, règles et budget actuels seront{' '}
            <strong className="font-semibold text-danger">effacés définitivement</strong> puis remplacés.
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 pb-2 pt-1">
          <div className="rounded-2xl bg-surface2/70 px-4 py-3 text-[13.5px] leading-relaxed">{children}</div>
          <div className="flex items-start gap-3 rounded-2xl border border-edge px-4 py-3">
            {backup.status === 'loading' && (
              <>
                <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-soft" />
                <div className="flex-1 space-y-2">
                  <p className="text-[13.5px] font-medium">Préparation de la sauvegarde de sécurité…</p>
                  <Skeleton className="h-3 w-40" />
                </div>
              </>
            )}
            {backup.status === 'ready' && (
              <>
                <CircleCheck className="mt-0.5 h-5 w-5 shrink-0 text-success" />
                <div className="flex-1">
                  <p className="text-[13.5px] font-medium">
                    Sauvegarde de sécurité prête · {fmtSize(backup.file.blob.size)}
                  </p>
                  <p className="text-[12.5px] leading-relaxed text-soft">
                    Elle sera enregistrée sur cet appareil avant l’effacement, et restera téléchargeable jusqu’à la fin.
                  </p>
                </div>
              </>
            )}
            {backup.status === 'error' && (
              <>
                <CircleAlert className="mt-0.5 h-5 w-5 shrink-0 text-danger" />
                <div className="flex-1 space-y-2">
                  <p className="text-[13.5px] font-medium text-danger">
                    Sauvegarde impossible : rien ne sera effacé sans elle.
                  </p>
                  <Button size="sm" variant="outline" onClick={() => setAttempt((a) => a + 1)}>
                    Réessayer
                  </Button>
                </div>
              </>
            )}
          </div>
          {cancelled && (
            <p role="alert" className="text-[13px] font-medium text-danger">
              Sauvegarde non enregistrée : rien n’a été effacé.
            </p>
          )}
          <p className="flex items-start gap-2 text-[12.5px] leading-relaxed text-soft">
            <Landmark className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            Ta connexion bancaire et son historique de synchronisation sont conservés.
          </p>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button variant="danger" onClick={() => void confirm()} disabled={backup.status !== 'ready'}>
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
