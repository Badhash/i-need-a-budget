import { Wallet } from 'lucide-react'
import { APP_VERSION } from '@/lib/version'
import { ProgressBar } from '@/components/shared/ProgressBar'

// Pieces d'euro : decalages horizontaux et departs varies pour un flux naturel.
const COINS = [
  { dx: -15, delay: 0 },
  { dx: 6, delay: 600 },
  { dx: 15, delay: 1200 },
]

/**
 * Ecran de chargement plein ecran affiche au lancement, le temps que les
 * donnees critiques soient prechargees. Portefeuille en « respiration » sur un
 * halo, pieces d'euro (ambre) qui tombent dedans en boucle, aurore de fond qui
 * derive lentement ; tout est fige si l'OS demande la reduction des animations.
 * Themable (3 themes, clair/sombre).
 *
 * Prop optionnelle `progress` (0 -> 100) : quand fournie, affiche une fine barre
 * de progression aux couleurs de l'accent + un pourcentage discret. Sans elle,
 * apparence inchangee (ex. ecran "Connexion…").
 *
 * La version de l'app (date du build + commit) est rappelee en petit en bas de
 * l'ecran, au-dessus de l'indicateur d'accueil iOS.
 */
export function AppLoader({
  message = 'Chargement de ton budget…',
  progress,
}: {
  message?: string
  progress?: number
}) {
  const hasProgress = progress !== undefined
  const pct = hasProgress ? Math.max(0, Math.min(100, Math.round(progress))) : 0

  return (
    <div className="relative isolate flex min-h-app flex-col items-center justify-center overflow-hidden bg-bg px-6">
      {/* Aurore de fond : deux lueurs larges qui derivent lentement. */}
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <div className="loader-drift absolute inset-x-0 top-[16%] mx-auto h-[26rem] w-[26rem] rounded-full bg-aura-1/20 blur-3xl dark:bg-aura-1/25" />
        <div
          className="loader-drift absolute -bottom-24 -left-16 h-80 w-80 rounded-full bg-aura-2/15 blur-3xl"
          style={{ animationDelay: '-4.5s' }}
        />
      </div>

      <div className="flex flex-col items-center gap-9">
        <div className="relative flex h-24 w-24 items-center justify-center">
          <span aria-hidden className="loader-glow absolute inset-1 rounded-[1.75rem] bg-brand blur-xl" />
          <span className="loader-badge relative flex h-[5.5rem] w-[5.5rem] items-center justify-center rounded-[1.6rem] bg-brand text-accentfg shadow-glow ring-1 ring-inset ring-accentfg/15">
            <Wallet className="h-10 w-10" strokeWidth={1.8} />
          </span>
          {/* Pieces d'euro : rendues APRES le badge (donc devant), elles tombent
              sur le portefeuille et sont ABSORBEES (fondu + reduction) au niveau
              de son ouverture. */}
          <span aria-hidden className="pointer-events-none absolute inset-x-0 top-0 flex justify-center">
            {COINS.map((coin, i) => (
              <span
                key={i}
                className="loader-coin absolute flex h-[18px] w-[18px] items-center justify-center rounded-full bg-coin text-[10px] font-bold leading-none text-coin-fg shadow-sm ring-1 ring-inset ring-coin-fg/25"
                style={{ marginLeft: coin.dx, animationDelay: `${coin.delay}ms` }}
              >
                €
              </span>
            ))}
          </span>
        </div>

        <div className="flex flex-col items-center gap-2 text-center">
          <p className="text-[18px] font-semibold tracking-tight text-ink">I Need A Budget</p>
          <p className="text-[13.5px] text-soft">{message}</p>

          {hasProgress && (
            <div className="mt-3 flex w-56 max-w-[70vw] flex-col items-center gap-2">
              <ProgressBar
                value={pct / 100}
                size="sm"
                animateOnMount={false}
                label="Progression du chargement"
              />
              <p className="text-[12px] text-soft tnum">{pct} %</p>
            </div>
          )}
        </div>
      </div>

      <p className="absolute inset-x-0 bottom-0 px-6 pb-[max(1.25rem,calc(env(safe-area-inset-bottom)+0.5rem))] text-center text-[11.5px] font-medium tracking-wide text-soft tnum">
        Version {APP_VERSION}
      </p>
    </div>
  )
}
