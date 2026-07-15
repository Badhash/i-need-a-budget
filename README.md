# I Need A Budget

Application personnelle de budget par enveloppes (zero-based), inspirée de YNAB,
avec une exigence forte sur l'UI/UX (north star : Copilot Money).

- Spécification produit et conventions : [CLAUDE.md](CLAUDE.md)
- Backlog priorisé (fait / restant) : [BACKLOG.md](BACKLOG.md)
- Feuille de route (reste à faire) : [PLAN.md](PLAN.md)
- Périmètre MVP : [PLAN-MVP.md](PLAN-MVP.md)

## État

Le produit est livré et branché sur données réelles :

- Authentification email/password + MFA TOTP.
- Front branché sur l'Edge Function `/api` (aucune donnée mockée) + signal Realtime.
- Moteur d'enveloppes YNAB (`packages/engine`) et chiffrement (`packages/crypto`),
  couverts par Vitest.
- Budget optimiste (undo/redo local), catégorisation en 2 taps, objectifs et
  financement guidé des objectifs, règles de catégorisation.
- Édition et déplacement de transactions, cartes à débit différé, import YNAB
  destructif, PWA installable (manifest + safe-areas iOS), file de mutations,
  santé de la synchro visible.
- Page Rapports (mobile simple / desktop enrichi : coach d'épargne, valeur nette,
  calculateur de Zakat).
- Synchronisation bancaire Enable Banking (Edge Function `sync-bank`), écrite,
  à activer une fois l'app Enable Banking validée.

Le détail de ce qui reste est dans [BACKLOG.md](BACKLOG.md) et [PLAN.md](PLAN.md).

## Structure

```
/app                  front React (Vite + TypeScript + Tailwind)
/packages/engine      moteur d'enveloppes (TypeScript pur + tests)
/packages/crypto      chiffrement AES-256-GCM + index aveugles
/supabase             Edge Functions /api et sync-bank (schéma non versionné)
/.github/workflows    deploiement Pages, deploiement Edge Functions, ping Supabase
```

## Developpement local

```bash
cd app
npm install
npm run dev     # serveur de dev
npm run build   # typecheck + build de production
```

## Deploiement GitHub Pages

Le workflow `deploy-pages.yml` construit `/app` et publie `app/dist` à chaque
push sur `main`. Pour l'activer : Settings > Pages > Source : "GitHub Actions".
L'app utilise le hash routing (`/#/`), compatible avec les project pages.
