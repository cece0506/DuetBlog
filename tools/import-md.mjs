import fs from "node:fs/promises";
import { watch } from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { marked } from "marked";

const ROOT = process.cwd();
const CONTENT_DIR = path.join(ROOT, "content", "posts");
const POSTS_DIR = path.join(ROOT, "public", "posts");
const DATA_DIR = path.join(ROOT, "public", "data");
const UPLOADS_DIR = path.join(ROOT, "public", "uploads", "posts");
const TOOLS_SOURCE_DIR = path.join(ROOT, "tools");
const TOOLS_PUBLIC_DIR = path.join(ROOT, "public", "tools");
const OUTPUT_JSON = path.join(DATA_DIR, "posts.json");

await fs.mkdir(POSTS_DIR, { recursive: true });
await fs.mkdir(DATA_DIR, { recursive: true });
await fs.mkdir(UPLOADS_DIR, { recursive: true });
await fs.mkdir(TOOLS_PUBLIC_DIR, { recursive: true });

function isLocalAsset(assetPath) {
  return Boolean(assetPath)
    && !assetPath.startsWith("/")
    && !assetPath.startsWith("#")
    && !/^(?:[a-z]+:)?\/\//i.test(assetPath)
    && !assetPath.startsWith("data:");
}

async function copyLocalAsset(assetPath, sourceDir, slug) {
  const cleanPath = assetPath.split("?")[0].split("#")[0];
  const sourcePath = path.resolve(sourceDir, cleanPath);
  const fileName = path.basename(cleanPath);
  const targetDir = path.join(UPLOADS_DIR, slug);
  const targetPath = path.join(targetDir, fileName);

  await fs.mkdir(targetDir, { recursive: true });
  await fs.copyFile(sourcePath, targetPath);

  return `/uploads/posts/${slug}/${fileName}`;
}

async function normalizeCover(cover, sourceDir, slug) {
  if (!isLocalAsset(cover)) {
    return cover;
  }

  return copyLocalAsset(cover, sourceDir, slug);
}

async function rewriteMarkdownAssets(markdown, sourceDir, slug) {
  const matches = Array.from(markdown.matchAll(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]+)")?\)/g));
  let result = markdown;

  for (const match of matches) {
    const [, altText, assetPath, title] = match;
    if (!isLocalAsset(assetPath)) {
      continue;
    }

    const normalizedPath = await copyLocalAsset(assetPath, sourceDir, slug);
    const titleText = title ? ` \"${title}\"` : "";
    result = result.replace(match[0], `![${altText}](${normalizedPath}${titleText})`);
  }

  return result;
}

async function syncToolPages() {
  const entries = await fs.readdir(TOOLS_SOURCE_DIR, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }
    if (entry.name === "import-md.mjs") {
      continue;
    }
    const source = path.join(TOOLS_SOURCE_DIR, entry.name);
    const target = path.join(TOOLS_PUBLIC_DIR, entry.name);
    if (/\.html?$/i.test(entry.name)) {
      let content = await fs.readFile(source, "utf8");
      if (!content.includes("data-home-link=\"true\"")) {
        const styleBlock = "<style>[data-home-link=\"true\"]{position:fixed;top:16px;left:16px;z-index:9999;padding:8px 14px;border-radius:999px;border:1px solid rgba(255,255,255,.35);background:rgba(0,0,0,.24);color:#fff;text-decoration:none;font:500 13px/1.2 Noto Sans,sans-serif;backdrop-filter:blur(8px)}</style>";
        if (content.includes("</head>")) {
          content = content.replace("</head>", `${styleBlock}</head>`);
        }
        if (content.includes("<body")) {
          content = content.replace(/<body([^>]*)>/i, `<body$1><a data-home-link=\"true\" href=\"/\">返回首页</a>`);
        }
      }
      await fs.writeFile(target, content, "utf8");
      continue;
    }

    await fs.copyFile(source, target);
  }
}

async function runImport() {
  const files = (await fs.readdir(CONTENT_DIR)).filter((f) => f.endsWith(".md"));
  const postItems = [];
  const activeSlugs = new Set();

  for (const fileName of files) {
    const sourcePath = path.join(CONTENT_DIR, fileName);
    const sourceDir = path.dirname(sourcePath);
    const raw = await fs.readFile(sourcePath, "utf8");
    const { data, content } = matter(raw);

    const slug = fileName.replace(/\.md$/i, "");
    activeSlugs.add(slug);
    const title = data.title || slug;
    const date = data.date || new Date().toISOString().slice(0, 10);
    const cover = await normalizeCover(
      data.cover || "https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=1200&q=80",
      sourceDir,
      slug,
    );
    const excerpt = data.excerpt || "";
    const tags = Array.isArray(data.tags) ? data.tags : [];
    const normalizedContent = await rewriteMarkdownAssets(content, sourceDir, slug);

    const html = marked.parse(normalizedContent);
    const page = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title}</title>
  <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
  <link rel="stylesheet" href="../assets/css/style.css" />
</head>
<body class="post-body">
  <main class="post-article-wrap">
    <article class="post-article">
      <a class="post-back" href="../pages/blog.html">Back To Blog</a>
      <h1>${title}</h1>
      <p class="post-meta">${date}</p>
      <img class="post-cover" src="${cover}" alt="${title}" loading="lazy" />
      <section class="post-content">${html}</section>
    </article>
  </main>
</body>
</html>`;

    await fs.writeFile(path.join(POSTS_DIR, `${slug}.html`), page, "utf8");

    postItems.push({ slug, title, date, cover, excerpt, tags });
  }

  const existingHtmlFiles = (await fs.readdir(POSTS_DIR)).filter((f) => f.endsWith(".html"));
  for (const htmlFile of existingHtmlFiles) {
    const slug = htmlFile.replace(/\.html$/i, "");
    if (!activeSlugs.has(slug)) {
      await fs.unlink(path.join(POSTS_DIR, htmlFile));
      console.log(`Removed orphaned post: ${htmlFile}`);
    }
  }

  postItems.sort((a, b) => new Date(b.date) - new Date(a.date));
  await fs.writeFile(OUTPUT_JSON, `${JSON.stringify(postItems, null, 2)}\n`, "utf8");
  await syncToolPages();

  console.log(`Imported ${postItems.length} markdown posts.`);
}

await runImport();

if (process.argv.includes("--watch")) {
  console.log(`Watching ${path.relative(process.cwd(), CONTENT_DIR)} for changes...`);
  let debounceTimer = null;
  watch(CONTENT_DIR, { persistent: true }, (_eventType, filename) => {
    if (!filename) {
      return;
    }
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(async () => {
      console.log(`\nDetected change: ${filename} — re-importing...`);
      try {
        await runImport();
      } catch (error) {
        console.error("Import failed:", error);
      }
    }, 300);
  });
}
