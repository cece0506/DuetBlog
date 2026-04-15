import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();

async function loadDotEnv() {
  const envPath = path.join(ROOT, ".env");
  try {
    const content = await fs.readFile(envPath, "utf8");
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) {
        continue;
      }
      const separatorIndex = trimmed.indexOf("=");
      if (separatorIndex === -1) {
        continue;
      }
      const key = trimmed.slice(0, separatorIndex).trim();
      const value = trimmed.slice(separatorIndex + 1).trim().replace(/^"|"$/g, "").replace(/^'|'$/g, "");
      if (!(key in process.env)) {
        process.env[key] = value;
      }
    }
  } catch {
    return;
  }
}

await loadDotEnv();

const hook = (process.env.CF_PAGES_DEPLOY_HOOK || process.env.CLOUDFLARE_DEPLOY_HOOK || "").trim();
if (!hook) {
  throw new Error("CF_PAGES_DEPLOY_HOOK is missing");
}

const response = await fetch(hook, { method: "POST" });
if (!response.ok) {
  const text = await response.text();
  throw new Error(`Cloudflare deploy hook failed (${response.status}): ${text}`);
}

console.log("[cloudflare] Deploy hook triggered successfully");
