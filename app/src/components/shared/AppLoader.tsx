/**
 * Ecran de chargement plein ecran affiche au lancement, le temps que les
 * donnees de fond (comptes, budgets de tous les mois, transactions, objectifs,
 * regles, connexions bancaires, rapports) soient prechargees. Mini animation
 * "respiration" du logo + points rebondissants, coupee si l'OS demande la
 * reduction des animations. Themable (clair/sombre).
 *
 * Prop optionnelle `progress` (0 -> 100) : quand fournie, affiche une fine barre
 * de progression aux couleurs de l'accent + un pourcentage discret. Sans elle,
 * apparence inchangee (ex. ecran "Connexion…").
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
    <div className="flex min-h-dvh flex-col items-center justify-center gap-7 bg-bg px-6">
      <div className="relative flex items-center justify-center">
        <span className="loader-glow absolute h-20 w-20 rounded-[1.4rem] bg-accent/30 blur-xl" />
        {/* Portefeuille dessine en SVG, en deux couches : le DOS (ghost) tout au
            fond, les PIECES au milieu, puis la POCHE AVANT par-dessus. Les pieces
            tombent depuis le haut, passent devant le dos, puis glissent DERRIERE
            la poche avant qui les masque : elles disparaissent dans la fente du
            portefeuille (et non au bord haut de l'icone). */}
        <span className="loader-badge relative flex h-20 w-20 items-center justify-center rounded-[1.4rem] bg-accent text-white shadow-lg">
          <svg viewBox="0 0 80 80" className="h-20 w-20" fill="none" aria-hidden>
            {/* Dos du portefeuille (ghost : laisse voir le corail, donne la profondeur) */}
            <rect x="18" y="28" width="44" height="30" rx="7" fill="white" fillOpacity="0.32" />
            {/* Pieces (or) : tombent dans la fente, masquees par la poche avant */}
            {[
              { cx: 34, delay: 0 },
              { cx: 42, delay: 600 },
              { cx: 38, delay: 1200 },
            ].map((coin, i) => (
              <g key={i} className="loader-coin" style={{ animationDelay: `${coin.delay}ms` }}>
                <circle cx={coin.cx} cy="42" r="4.2" fill="#F5A623" />
                <circle cx={coin.cx} cy="42" r="2.1" fill="#FFFFFF" fillOpacity="0.55" />
              </g>
            ))}
            {/* Poche avant (opaque : masque les pieces qui y entrent) + fermoir */}
            <rect x="18" y="42" width="44" height="16" rx="6" fill="white" />
            <circle cx="52" cy="50" r="3" fill="currentColor" className="text-accent" />
          </svg>
        </span>
      </div>

      <div className="flex flex-col items-center gap-3.5">
        <p className="text-[15px] font-semibold tracking-tight text-ink">I Need A Budget</p>
        <div className="flex items-center gap-1.5" aria-hidden>
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="loader-dot h-2 w-2 rounded-full bg-accent"
              style={{ animationDelay: `${i * 160}ms` }}
            />
          ))}
        </div>

        {hasProgress && (
          <div className="mt-1 flex w-56 max-w-[70vw] flex-col items-center gap-2">
            <div
              className="h-1.5 w-full overflow-hidden rounded-full bg-accent/15"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={pct}
              aria-label="Progression du chargement"
            >
              <div
                className="loader-bar h-full rounded-full bg-accent transition-[width] duration-300 ease-out motion-reduce:transition-none"
                style={{ width: `${pct}%` }}
              />
            </div>
            <p className="text-[12px] tabular-nums text-soft">{pct} %</p>
          </div>
        )}

        <p className="text-[13px] text-soft">{message}</p>
      </div>
    </div>
  )
}
