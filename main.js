function showBootFailure(error) {
  console.error("Boot failed:", error);
  const fallback = document.createElement("div");
  fallback.style.position = "fixed";
  fallback.style.left = "12px";
  fallback.style.right = "12px";
  fallback.style.bottom = "12px";
  fallback.style.padding = "10px 12px";
  fallback.style.border = "1px solid #ef4444";
  fallback.style.background = "rgba(127,29,29,0.95)";
  fallback.style.color = "#fee2e2";
  fallback.style.font = "12px/1.4 monospace";
  fallback.style.zIndex = "99999";
  fallback.textContent = `Boot failed: ${error?.message || String(error)}`;
  document.body.appendChild(fallback);
}

async function start() {
  try {
    if (!window.ethers) {
      throw new Error("window.ethers is missing. The ethers CDN script did not load.");
    }
    const { bootApp } = await import("./legacy-app-bridge.js?v=20260416d");
    await bootApp();
  } catch (error) {
    showBootFailure(error);
  }
}

start();
