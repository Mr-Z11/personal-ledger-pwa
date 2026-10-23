const STARTUP_RELOAD_KEY = "ledger-startup-reload-at";
let recoveryStarted = false;

/* ServiceWorker 更新通道（iOS PWA 上 autoUpdate 需重开才生效，这里补两个主动机制）：
   1. 每次冷启动主动 update() 一次——不等 iOS 自己的检查时机
   2. 新 SW 通过 clientsClaim 接管已打开的页面时自动 reload——
      「检查更新」按钮点了立刻生效，不用再教用户划掉重开几次 */
if ("serviceWorker" in navigator) {
  const hadController = Boolean(navigator.serviceWorker.controller);
  let reloaded = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!hadController || reloaded) return; // 首次安装（null → sw）不触发热重载
    reloaded = true;
    window.location.reload();
  });
  void navigator.serviceWorker.ready.then((registration) => {
    void registration.update().catch(() => undefined);
  });
}

async function startApp() {
  const [React, ReactDOM, { App }] = await Promise.all([
    import("react"),
    import("react-dom/client"),
    import("./App")
  ]);
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}

function showStartupRecovery() {
  const status = document.querySelector<HTMLElement>(".boot-date");
  const title = document.querySelector<HTMLElement>(".boot-title");
  const card = document.querySelector<HTMLElement>(".boot-card");
  if (status) status.textContent = "启动资源未能载入";
  if (title) title.textContent = "请重新打开账本";
  if (!card || card.querySelector("button")) return;

  card.replaceChildren();
  const description = document.createElement("p");
  description.textContent = "应用已保留本地数据。请检查网络后重试，或关闭并重新打开主屏应用。";
  const retry = document.createElement("button");
  retry.type = "button";
  retry.textContent = "重新载入";
  retry.style.cssText = "min-height:3rem;border:0;border-radius:.7rem;background:#31473a;color:#fff7df;font:inherit;font-weight:800";
  retry.addEventListener("click", () => window.location.reload());
  card.append(description, retry);
}

function recoverStartup(error: unknown) {
  if (recoveryStarted) return;
  recoveryStarted = true;
  console.error("应用启动资源载入失败", error);

  try {
    const lastReloadAt = Number(window.sessionStorage.getItem(STARTUP_RELOAD_KEY) ?? 0);
    if (Date.now() - lastReloadAt > 30_000) {
      window.sessionStorage.setItem(STARTUP_RELOAD_KEY, String(Date.now()));
      window.location.reload();
      return;
    }
  } catch {
    // Safari may deny sessionStorage in restricted modes; keep the visible recovery UI.
  }
  showStartupRecovery();
}

window.addEventListener("vite:preloadError", (event) => {
  event.preventDefault();
  recoverStartup("预加载资源版本不一致");
});

void startApp().catch(recoverStartup);
