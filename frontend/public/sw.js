// Brommerboek push service worker. Kept tiny and dependency-free: show the
// pushed notification, and focus/open the app on click.

self.addEventListener("push", (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch {
    // Malformed payload — fall back to a bare notification.
  }
  event.waitUntil(
    self.registration.showNotification(data.title || "brommerboek", {
      body: data.body || "",
      icon: "/cub50.svg",
      badge: "/cub50.svg",
      data: { url: data.url || "/" },
    }),
  )
})

self.addEventListener("notificationclick", (event) => {
  event.notification.close()
  const url = event.notification.data?.url || "/"
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((windows) => {
        for (const win of windows) {
          if ("focus" in win) {
            if ("navigate" in win) win.navigate(url)
            return win.focus()
          }
        }
        return self.clients.openWindow(url)
      }),
  )
})
