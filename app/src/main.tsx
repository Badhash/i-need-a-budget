import React from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { App } from '@/App'
import { useUiStore } from '@/stores/ui'
import '@/styles/globals.css'

// iOS Safari : neutralise completement le pinch-zoom (evenements gesture*
// proprietaires, non couverts par le viewport maximum-scale) — l'app garde
// toujours exactement la taille de l'ecran.
for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
  document.addEventListener(type, (e) => e.preventDefault(), { passive: false })
}

// Apres le prechargement complet au lancement (cf. AuthedBootGate), on veut une
// navigation 100 % instantanee : aucun refetch de fond ne doit se declencher au
// changement de mois ou d'ecran pendant la session. On fige donc les donnees
// (staleTime: Infinity). La fraicheur reste garantie autrement : reconciliation
// par le signal Realtime et les mutations optimistes, qui appellent
// invalidateQueries -> une invalidation force le refetch quel que soit le
// staleTime, donc ce reglage ne casse pas les invalidations existantes.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: Infinity,
      retry: 1,
    },
  },
})

// Raccourci PWA (manifest shortcuts) « Ajouter une transaction » : l'URL de
// lancement porte `?ajouter=1` dans le hash. Lu UNE fois au demarrage, on ouvre
// le dialogue via le store UI puis on retire le parametre (pas de reouverture
// au rechargement, pas de dependance au routeur : validateSearch ne le connait pas).
try {
  const hash = window.location.hash
  if (/[?&]ajouter=1(&|$)/.test(hash)) {
    useUiStore.getState().setAddTxOpen(true)
    const cleaned = hash.replace(/([?&])ajouter=1(&|$)/, (_m, sep: string, tail: string) => (tail ? sep : '')).replace(/\?$/, '')
    history.replaceState(null, '', window.location.pathname + window.location.search + cleaned)
  }
} catch {
  // ignore
}

// Service worker (app/public/sw.js, servi a la racine du site a cote de
// index.html) : shell + assets haches en cache, jamais Supabase. Enregistre
// apres `load` pour ne pas concurrencer le chargement initial ; jamais en dev.
// Mise a jour : quand un nouveau worker est installe alors qu'un ancien controle
// la page, on lui demande skipWaiting puis on recharge UNE fois au changement
// de controleur (garde anti-boucle).
if (!import.meta.env.DEV && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('./sw.js', { scope: './' })
      .then((registration) => {
        let reloading = false
        navigator.serviceWorker.addEventListener('controllerchange', () => {
          if (reloading) return
          reloading = true
          window.location.reload()
        })
        registration.addEventListener('updatefound', () => {
          const worker = registration.installing
          if (!worker) return
          worker.addEventListener('statechange', () => {
            if (worker.state === 'installed' && navigator.serviceWorker.controller) {
              worker.postMessage({ type: 'SKIP_WAITING' })
            }
          })
        })
      })
      .catch(() => {
        // best-effort : l'app fonctionne sans service worker
      })
  })
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>,
)
