function startApp() {
  void Promise.all([
    import("react"),
    import("react-dom/client"),
    import("./App")
  ]).then(([React, ReactDOM, { App }]) => {
    ReactDOM.createRoot(document.getElementById("root")!).render(
      <React.StrictMode>
        <App />
      </React.StrictMode>
    );
  });
}

window.requestAnimationFrame(startApp);
