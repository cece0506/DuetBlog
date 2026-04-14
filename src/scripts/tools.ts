export {};

type ToolItem = {
  name: string;
  path: string;
  description?: string;
};

async function loadTools() {
  const response = await fetch("/data/tools.json");
  if (!response.ok) {
    throw new Error("无法读取 tools.json");
  }
  return (await response.json()) as ToolItem[];
}

async function initToolsPage() {
  const container = document.getElementById("tools-grid");
  if (!container) {
    return;
  }

  try {
    const tools = await loadTools();
    container.innerHTML = tools
      .map(
        (tool) => `
          <a class="tool-card tool-card-link" href="/${tool.path}">
            <div>
              <h3>${tool.name}</h3>
              <p>${tool.description || ""}</p>
            </div>
            <span class="tool-card-cta">打开工具</span>
          </a>
        `
      )
      .join("");
  } catch (error) {
    container.innerHTML = `<p>${error instanceof Error ? error.message : "加载失败"}</p>`;
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    void initToolsPage();
  }, { once: true });
} else {
  void initToolsPage();
}
