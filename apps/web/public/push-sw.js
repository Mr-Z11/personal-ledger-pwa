/* 工资日提醒推送处理脚本，由主 Service Worker 通过 importScripts 加载 */
self.addEventListener("push", (event) => {
  if (!event.data) return;
  let payload = {};
  try {
    payload = event.data.json();
  } catch {
    payload = { title: "记账提醒", body: event.data.text() };
  }
  const title = payload.title || "记账提醒";
  const options = {
    body: payload.body || "",
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    tag: payload.tag || "ledger-reminder",
    // 消费类提醒带 tag：App 打开时本机通知已按本地数据发过同 tag 的一条，
    // 后到的服务端推送静默替换它、不重复响铃；工资日 / 测试推送不带 tag，保持原行为。
    renotify: !payload.tag,
    data: { url: payload.url || "/" },
    vibrate: [100, 50, 100]
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ("focus" in client) {
          client.focus();
          if (client.navigate && targetUrl !== "/") client.navigate(targetUrl);
          return;
        }
      }
      return self.clients.openWindow(targetUrl);
    })
  );
});
