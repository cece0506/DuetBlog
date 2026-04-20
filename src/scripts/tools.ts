export {};

type ToolItem = {
  name: string;
  path?: string;
  url?: string;
  host?: string;
  description?: string;
};

type ToolHostConfig = {
  toolsOrigin?: string;
  toolsOriginDev?: string;
  toolsOriginProd?: string;
};

function normalizeOrigin(origin: string | undefined): string {
  return (origin || "").trim().replace(/\/+$/, "");
}

function isLocalRuntime(): boolean {
  const hostname = window.location.hostname.toLowerCase();
  if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1") {
    return true;
  }
  if (hostname.endsWith(".local")) {
    return true;
  }
  if (/^10\./.test(hostname) || /^192\.168\./.test(hostname)) {
    return true;
  }
  return /^172\.(1[6-9]|2\d|3[0-1])\./.test(hostname);
}

function resolveToolsOrigin(hostConfig: ToolHostConfig): string {
  const local = isLocalRuntime();
  if (local) {
    return normalizeOrigin(hostConfig.toolsOriginDev || hostConfig.toolsOrigin);
  }
  return normalizeOrigin(hostConfig.toolsOriginProd || hostConfig.toolsOrigin);
}

async function loadToolHostConfig(): Promise<ToolHostConfig> {
  try {
    const response = await fetch("/data/tools-host.json");
    if (!response.ok) {
      return {};
    }
    return (await response.json()) as ToolHostConfig;
  } catch {
    return {};
  }
}

function resolveToolHref(tool: ToolItem, hostConfig: ToolHostConfig): string {
  const raw = (tool.url || tool.path || "").trim();
  if (!raw) {
    return "/pages/tools.html";
  }
  if (/^https?:\/\//i.test(raw)) {
    return raw;
  }
  if (tool.host === "tools") {
    const toolsOrigin = resolveToolsOrigin(hostConfig);
    const path = raw.startsWith("/") ? raw : `/${raw}`;
    return toolsOrigin ? `${toolsOrigin}${path}` : path;
  }
  return raw.startsWith("/") ? raw : `/${raw}`;
}

function isExternalHref(href: string): boolean {
  return /^https?:\/\//i.test(href);
}

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
    const [tools, hostConfig] = await Promise.all([loadTools(), loadToolHostConfig()]);
    container.innerHTML = tools
      .map((tool) => {
        const href = resolveToolHref(tool, hostConfig);
        const externalAttrs = isExternalHref(href) ? ' target="_blank" rel="noopener noreferrer"' : "";
        return `
          <a class="tool-card tool-card-link" href="${href}"${externalAttrs}>
            <div>
              <h3>${tool.name}</h3>
              <p>${tool.description || ""}</p>
            </div>
            <span class="tool-card-cta">打开工具</span>
          </a>
        `;
      })
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
