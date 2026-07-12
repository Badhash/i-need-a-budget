# I Need A Budget

Application personnelle de budget par enveloppes (zero-based), inspirée de YNAB,
avec une exigence forte sur l'UI/UX (north star : Copilot Money).

- Spécification produit et conventions : [CLAUDE.md](CLAUDE.md)
- Feuille de route (sessions restantes) : [PLAN.md](PLAN.md)
- Périmètre MVP (reste à faire) : [PLAN-MVP.md](PLAN-MVP.md)

## Reste à faire

- Authentification (login email/password + MFA)
- Branchement du front sur l'Edge Function `/api` (remplacement des mocks) + Realtime
- Synchronisation bancaire automatique via Enable Banking (Edge Function `sync-bank`)
- Finitions : règles de catégorisation, targets, export chiffré

## Structure

```
/app                  front React (Vite + TypeScript + Tailwind)
/packages/engine      moteur d'enveloppes (TypeScript pur + tests)
/packages/crypto      chiffrement AES-256-GCM + index aveugles
/supabase             schéma chiffré, migrations, Edge Function /api
/.github/workflows    deploiement GitHub Pages + ping Supabase
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
