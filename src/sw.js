// No fetch interception: private pages and account responses are never cached.
self.addEventListener('push',event=>{
 event.waitUntil(self.registration.showNotification('One small step, whenever you’re ready.',{
  body:'A five-minute lesson or a quick review is here for you. No catching up required.',
  icon:new URL('icon-192.png',self.registration.scope).pathname,badge:new URL('icon-192.png',self.registration.scope).pathname,tag:'learning-reminder',renotify:false,silent:true,data:{url:new URL(self.registration.scope).pathname}
 }));
});
self.addEventListener('notificationclick',event=>{
 event.notification.close();
 event.waitUntil((async()=>{const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});
  for(const client of windows){if(new URL(client.url).origin===self.location.origin){await client.focus();return;}}
  await self.clients.openWindow('/');
 })());
});
