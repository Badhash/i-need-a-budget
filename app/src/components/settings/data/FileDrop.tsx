// Zone de choix de fichier : bouton plein (toucher) et depot par glisser
// (desktop). L'input natif reste cache pour un rendu propre.

import { useRef, useState } from 'react'
import { Check, FileUp, type LucideIcon } from 'lucide-react'
import { fmtSize } from '@/components/settings/data/download'
import { cn } from '@/lib/utils'

export function FileDrop({
  label,
  hint,
  accept,
  file,
  onPick,
  icon: Icon = FileUp,
  disabled,
}: {
  label: string
  hint: string
  accept: string
  file: File | null
  onPick: (file: File | null) => void
  icon?: LucideIcon
  disabled?: boolean
}) {
  const input = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)

  return (
    <>
      <input
        ref={input}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => {
          onPick(e.target.files?.[0] ?? null)
          // Meme fichier choisi deux fois : l'evenement change doit repartir.
          e.target.value = ''
        }}
      />
      <button
        type="button"
        disabled={disabled}
        onClick={() => input.current?.click()}
        onDragOver={(e) => {
          e.preventDefault()
          setOver(true)
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setOver(false)
          const dropped = e.dataTransfer.files?.[0]
          if (dropped && !disabled) onPick(dropped)
        }}
        className={cn(
          'pressable flex min-h-[64px] w-full items-center gap-3 rounded-2xl border px-4 py-3 text-left transition-[border-color,background-color] duration-150 disabled:opacity-50',
          file
            ? 'border-success/30 bg-success/[0.06]'
            : 'border-dashed border-line bg-surface2/40 hover:border-accent/50 hover:bg-accent/[0.04]',
          over && 'border-accent bg-accent/[0.08]',
        )}
      >
        <span
          className={cn(
            'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl',
            file ? 'bg-success/15 text-success' : 'bg-surface text-soft shadow-card',
          )}
        >
          {file ? <Check className="h-[18px] w-[18px]" /> : <Icon className="h-[18px] w-[18px]" />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[14px] font-medium text-ink">{file ? file.name : label}</span>
          <span className="line-clamp-2 block text-[12.5px] leading-snug text-soft">
            {file ? `${fmtSize(file.size)} · toucher pour changer` : hint}
          </span>
        </span>
      </button>
    </>
  )
}
