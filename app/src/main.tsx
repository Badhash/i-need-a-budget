import React from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { App } from '@/App'
import { useUiStore } from '@/stores/ui'
import { ErrorBoundary } from '@/components/shared/ErrorBoundary'
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
//
// Mise a jour : le workflow de deploiement estampille sw.js ET le bundle avec
// le SHA du commit (VITE_BUILD_ID). Quand un nouveau worker est installe alors
// qu'un ancien controle la page, on lui demande skipWaiting (les anciens caches
// sont purges a l'activation) puis on compare sa version a celle de la page :
// si elle differe, la page tourne sur un ancien bundle et on propose de
// recharger (banniere, jamais d'autorite : aucune saisie perdue). Au retour au
// premier plan apres une longue absence, on verifie s'il existe une nouvelle
// version, sans attendre le prochain lancement.
const BUILD_ID = String(import.meta.env.VITE_BUILD_ID ?? '')
const UPDATE_CHECK_AFTER_MS = 5 * 60 * 1000

function askWorkerVersion(worker: ServiceWorker): Promise<string | null> {
  return new Promise((resolve) => {
    const channel = new MessageChannel()
    const timer = window.setTimeout(() => resolve(null), 3000)
    channel.port1.onmessage = (event: MessageEvent<{ version?: unknown }>) => {
      window.clearTimeout(timer)
      resolve(typeof event.data?.version === 'string' ? event.data.version : null)
    }
    worker.postMessage({ type: 'GET_VERSION' }, [channel.port2])
  })
}

if (!import.meta.env.DEV && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('./sw.js', { scope: './' })
      .then((registration) => {
        navigator.serviceWorker.addEventListener('controllerchange', () => {
          const controller = navigator.serviceWorker.controller
          if (!controller || !BUILD_ID) return
          void askWorkerVersion(controller).then((version) => {
            if (version && version !== BUILD_ID) useUiStore.getState().setUpdateAvailable(true)
          })
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
        let hiddenAt = 0
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'hidden') {
            hiddenAt = Date.now()
            return
          }
          if (hiddenAt && Date.now() - hiddenAt >= UPDATE_CHECK_AFTER_MS) {
            hiddenAt = 0
            registration.update().catch(() => undefined)
          }
        })
      })
      .catch(() => {
        // best-effort : l'app fonctionne sans service worker
      })
  })
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </ErrorBoundary>
  </React.StrictMode>,
)
