self.addEventListener('push', (event) => {
  const data = event.data ? event.data.json() : {}
  event.waitUntil(self.registration.showNotification(data.title || 'To-do Today', {
    body: data.body || 'You have a task coming up.',
    icon: '/icon.svg',
    badge: '/icon.svg',
    data: { url: data.url || '/' },
    tag: data.tag || 'todo-reminder',
    renotify: true
  }))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = event.notification.data?.url || '/'
  event.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
    for (const client of windows) {
      if ('focus' in client) {
        client.navigate(url)
        return client.focus()
      }
    }
    return clients.openWindow(url)
  }))
})
