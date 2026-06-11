// Cereal service worker — handles push notifications and offline shell.

const CACHE = 'cereal-shell-v1'
const SHELL = ['/', '/manifest.json']

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)))
  self.skipWaiting()
})

self.addEventListener('activate', e => {
  e.waitUntil(self.clients.claim())
})

// Network-first for everything (we want fresh data) — fall back to cache offline
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return
  // Don't intercept API/WebSocket
  const url = new URL(e.request.url)
  if (url.pathname.startsWith('/api') || url.pathname.startsWith('/ws')) return

  e.respondWith(
    fetch(e.request).catch(() => caches.match(e.request))
  )
})

// Push notification handler
self.addEventListener('push', e => {
  const data = e.data ? e.data.json() : {}
  const title = data.title || 'New email'
  const options = {
    body: data.body || 'You have a new message.',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: data.tag || 'cereal-msg',
    data: { bowlId: data.bowlId, messageId: data.messageId },
  }
  e.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', e => {
  e.notification.close()
  const bowlId = e.notification.data?.bowlId
  const target = bowlId ? `/?bowl=${bowlId}` : '/'
  e.waitUntil(
    self.clients.matchAll({ type: 'window' }).then(clients => {
      const existing = clients.find(c => c.url.includes(self.registration.scope))
      if (existing) {
        existing.navigate(target)
        return existing.focus()
      }
      return self.clients.openWindow(target)
    })
  )
})
