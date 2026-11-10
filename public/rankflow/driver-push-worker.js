self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('push', event => {
  event.waitUntil(self.registration.showNotification('Motion Weave — New job', {
    body:'You have a new job from Drive Office. Tap to open your job.',
    tag:'motion-weave-job', renotify:true,
    data:{url:'/rankflow/driver.html'},
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
