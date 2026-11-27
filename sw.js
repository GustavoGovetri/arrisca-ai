// Service worker do Arrisca Aí: deixa o site instalável, guarda uma cópia para abrir sem internet
// e mostra as notificações (convite para sala e pedido de amizade).
// A página sempre vem da internet primeiro, para a atualização automática continuar funcionando.
const CACHE = 'arrisca-v1';
const FIXOS = ['/', '/index.html', '/config.js', '/net-firebase.js', '/manifest.webmanifest',
  '/fonts/fredoka.woff2', '/fonts/lilita-one.woff2', '/icones/icone-192.png', '/icones/badge-96.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FIXOS)).catch(() => {}).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/__/')) return; // nunca guarda respostas do servidor
  if (req.mode === 'navigate') {
    // página: internet primeiro; sem internet, a última cópia
    e.respondWith(fetch(req).then(r => {
      if (r.ok) { const c = r.clone(); caches.open(CACHE).then(k => k.put('/index.html', c)); }
      return r;
    }).catch(() => caches.match('/index.html')));
    return;
  }
  if (/^\/(fonts|sons|icones)\//.test(url.pathname)) {
    // fontes, sons e ícones quase nunca mudam: usa a cópia e atualiza por trás
    e.respondWith(caches.open(CACHE).then(async k => {
      const tem = await k.match(req);
      const rede = fetch(req).then(r => { if (r.ok) k.put(req, r.clone()); return r; }).catch(() => tem);
      return tem || rede;
    }));
    return;
  }
  // o resto (config.js, net-firebase.js, mapas): internet primeiro, cópia se cair
  e.respondWith(fetch(req).then(r => {
    if (r.ok) { const c = r.clone(); caches.open(CACHE).then(k => k.put(req, c)); }
    return r;
  }).catch(() => caches.match(req)));
});

// ----- notificações -----
self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (x) { d = { corpo: e.data && e.data.text() }; }
  const url = typeof d.url === 'string' && d.url.startsWith('/') ? d.url : '/';
  e.waitUntil(self.registration.showNotification(d.titulo || 'Arrisca Aí', {
    body: d.corpo || '', tag: d.tag || 'arrisca', renotify: true,
    icon: '/icones/icone-192.png', badge: '/icones/badge-96.png', lang: 'pt-BR', data: { url }
  }));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || '/', location.origin).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(cs => {
    // se o jogo já está aberto, usa a mesma janela
    for (const c of cs) {
      if (new URL(c.url).origin === location.origin) {
        c.postMessage({ tipo: 'abrir', url });
        return c.focus();
      }
    }
    return self.clients.openWindow(url);
  }));
});
