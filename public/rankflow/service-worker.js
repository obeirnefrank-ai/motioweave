const CACHE = 'motion-weave-shared-v42';
const ASSETS = [
  '/rankflow/index.html',
  '/rankflow/styles.css',
  '/rankflow/cancelled-jobs.css',
  '/rankflow/app.js',
  '/rankflow/manifest.webmanifest',
  '/rankflow/driver.html',
  '/rankflow/driver.css',
  '/rankflow/driver.js',
  '/rankflow/driver-alerts.js',
  '/rankflow/driver-manifest.webmanifest',
  '/rankflow/access.js',
  '/rankflow/shared-theme.css',
  '/rankflow/shared-theme.js',
  '/rankflow/admin-link.js',
  '/rankflow/icons/icon-192.svg',
  '/rankflow/icons/icon-512.svg',
  '/rankflow/assets/motion-weave-logo-on-dark.svg',
  '/rankflow/assets/motion-weave-logo-on-light.svg',
  '/rankflow/assets/motion-weave-mark.svg',
  '/rankflow/assets/motion-weave-logo-orange-black.png'
];
self.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS))));
self.addEventListener('activate', event => event.waitUntil(Promise.all([self.clients.claim(), caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key))))])));
self.addEventListener('fetch', event => {
  const requestUrl = new URL(event.request.url);
  if (event.request.method !== 'GET' || requestUrl.searchParams.has('invite') || (/^\/(api|signin-with-chatgpt|signout-with-chatgpt|callback)(\/|$)/.test(requestUrl.pathname) || requestUrl.pathname.includes('/admin'))) return;
  event.respondWith(fetch(event.request).then(response => { const copy = response.clone(); caches.open(CACHE).then(cache => cache.put(event.request, copy)); return response; }).catch(() => caches.match(event.request)));
});
self.addEventListener('push', event => {
  event.waitUntil(self.registration.showNotification('Motion Weave — New job', {
    body:'You have a new taxi job. Tap to open your job.',
    tag:'motion-weave-job',
    renotify:true,
    data:{url:'/rankflow/driver.html'}
  }));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({type:'window',includeUncontrolled:true});
    const phone = windows.find(client => new URL(client.url).pathname.startsWith('/rankflow/driver'));
    if (phone) { await phone.focus(); return; }
    await self.clients.openWindow('/rankflow/driver.html');
  })());
});
