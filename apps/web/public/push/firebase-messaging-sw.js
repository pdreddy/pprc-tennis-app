/* FCM Web Push is delivered to this dedicated worker; the application PWA worker keeps its own scope. */
self.addEventListener('push', event => {
 let payload = {};
 try { payload = event.data?.json() || {}; } catch { payload = {}; }
 const n = payload.notification || payload.data || {};
 const url = (payload.data && payload.data.url) || '/notifications';
 event.waitUntil(self.registration.showNotification(n.title || 'PPRC Events', {body:n.body || 'You have an event update.',icon:'/icon-192.png',data:{url}}));
});
self.addEventListener('notificationclick', event => {
 event.notification.close();
 const target = new URL(event.notification.data?.url || '/notifications', self.location.origin);
 // Same-origin only, so a crafted payload cannot open an arbitrary site.
 const url = target.origin === self.location.origin ? target.href : self.location.origin + '/notifications';
 event.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(list => {
  const open = list.find(c => c.url.startsWith(self.location.origin) && 'focus' in c);
  return open ? open.focus().then(c => c.navigate ? c.navigate(url) : c) : self.clients.openWindow(url);
 }));
});
