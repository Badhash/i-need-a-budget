import React from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { App } from '@/App'
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

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>,
)
