/* FCM Web Push is delivered to this dedicated worker; the application PWA worker keeps its own scope. */
self.addEventListener('push', event => {
 const payload = event.data?.json() || {};
 const n = payload.notification || payload.data || {};
 event.waitUntil(self.registration.showNotification(n.title || 'PPRC Events', {body:n.body || 'You have an event update.',icon:'/icon-192.png',data:{url:'/notifications'}}));
});
self.addEventListener('notificationclick', event => {
 event.notification.close();
 event.waitUntil(self.clients.openWindow('/notifications'));
});
