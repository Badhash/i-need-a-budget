/* Service worker ecrit a la main (pas de workbox : stack figee).
 * Objectif : lancement instantane de la PWA et tolerance hors-ligne du shell,
 * sans JAMAIS mettre en cache une donnee metier.
 *
 * Strategies :
 *  - navigation (index.html) : reseau d'abord, repli cache -> un nouveau deploy
 *    est pris en compte des la premiere ouverture en ligne ;
 *  - assets Vite haches (/assets/) : cache d'abord (immuables, noms haches) ;
 *  - Google Fonts (css + woff2) : stale-while-revalidate, cache dedie ;
 *  - Supabase (supabase.co / functions / realtime) et tout non-GET : jamais
 *    touches, passent directement au reseau.
 * Les noms d'assets etant generes par Vite, rien n'est precache a part le
 * shell : tout le reste se remplit a l'usage.
 */
// Remplace par le SHA du commit au deploiement (workflow deploy-pages) : un
// nouveau deploiement = un nouveau worker = anciens caches purges a l'activation.
// Sans estampille (build local), le worker ne change jamais.
const VERSION = '__BUILD_ID__'
const SHELL_CACHE = `inab-shell-${VERSION}`
const ASSETS_CACHE = `inab-assets-${VERSION}`
const FONTS_CACHE = `inab-fonts-${VERSION}`
const KNOWN_CACHES = [SHELL_CACHE, ASSETS_CACHE, FONTS_CACHE]

// Chemins relatifs au scope (sous-chemin GitHub Pages).
const SHELL_URLS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './favicon.svg',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png',
  './apple-touch-icon.png',
]

const NEVER_CACHE_HOSTS = ['supabase.co', 'supabase.in']

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) =>
      // Precache best-effort : une icone manquante ne doit pas faire echouer
      // l'installation du worker.
      Promise.all(SHELL_URLS.map((url) => cache.add(url).catch(() => undefined))),
    ),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => !KNOWN_CACHES.includes(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('message', (event) => {
  if (!event.data) return
  if (event.data.type === 'SKIP_WAITING') self.skipWaiting()
  // La page compare la version du worker a celle de son bundle (main.tsx).
  if (event.data.type === 'GET_VERSION' && event.ports && event.ports[0]) {
    event.ports[0].postMessage({ version: VERSION })
  }
})

function isNeverCached(url) {
  return NEVER_CACHE_HOSTS.some((h) => url.hostname === h || url.hostname.endsWith('.' + h))
}

function isFontRequest(url) {
  return url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com'
}

// Reseau d'abord, repli cache (navigation / shell).
async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName)
  try {
    const response = await fetch(request)
    if (response && response.ok) await cache.put(request, response.clone())
    return response
  } catch (err) {
    const cached = (await cache.match(request)) || (await cache.match('./index.html')) || (await cache.match('./'))
    if (cached) return cached
    throw err
  }
}

// Cache d'abord (assets immuables).
async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName)
  const cached = await cache.match(request)
  if (cached) return cached
  const response = await fetch(request)
  if (response && response.ok) await cache.put(request, response.clone())
  return response
}

// Stale-while-revalidate (polices).
async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName)
  const cached = await cache.match(request)
  const refresh = fetch(request)
    .then((response) => {
      // Les woff2 gstatic arrivent en reponse opaque (type 'opaque', status 0)
      // quand la requete CSS n'est pas en CORS : on les garde quand meme.
      if (response && (response.ok || response.type === 'opaque')) cache.put(request, response.clone())
      return response
    })
    .catch(() => undefined)
  if (cached) return cached
  const fresh = await refresh
  if (fresh) return fresh
  throw new Error('font unavailable')
}

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return
  let url
  try {
    url = new URL(request.url)
  } catch {
    return
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return
  if (isNeverCached(url)) return

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request, SHELL_CACHE))
    return
  }

  if (url.origin === self.location.origin) {
    if (url.pathname.includes('/assets/')) {
      event.respondWith(cacheFirst(request, ASSETS_CACHE))
      return
    }
    const scopePath = new URL(self.registration.scope).pathname
    const rel = url.pathname.startsWith(scopePath) ? url.pathname.slice(scopePath.length) : null
    if (rel !== null && SHELL_URLS.includes('./' + rel)) {
      event.respondWith(networkFirst(request, SHELL_CACHE))
    }
    return
  }

  if (isFontRequest(url)) {
    event.respondWith(staleWhileRevalidate(request, FONTS_CACHE))
  }
})

// ---------------------------------------------------------------------------
// Notifications push (REF O). Le serveur envoie un JSON chiffre de bout en bout
// { title, body, url, tag } ; url = route hash de l'app (ex. '#/trier').
// iOS exige qu'un push affiche TOUJOURS une notification (userVisibleOnly).
// ---------------------------------------------------------------------------

self.addEventListener('push', (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch {
    data = { body: event.data ? event.data.text() : '' }
  }
  const title = typeof data.title === 'string' && data.title ? data.title : 'Budget'
  const scope = self.registration.scope
  event.waitUntil(
    self.registration.showNotification(title, {
      body: typeof data.body === 'string' ? data.body : '',
      tag: typeof data.tag === 'string' ? data.tag : undefined,
      icon: new URL('./icon-192.png', scope).href,
      badge: new URL('./icon-192.png', scope).href,
      data: { url: typeof data.url === 'string' && data.url.startsWith('#/') ? data.url : '#/budget' },
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const hash = (event.notification.data && event.notification.data.url) || '#/budget'
  const target = new URL(hash, self.registration.scope).href
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      // App deja ouverte : on la ramene au premier plan sur la bonne page.
      for (const client of clients) {
        if (client.url.startsWith(self.registration.scope) && 'focus' in client) {
          return client.focus().then((c) => (c && 'navigate' in c ? c.navigate(target) : c))
        }
      }
      return self.clients.openWindow(target)
    }),
  )
})
