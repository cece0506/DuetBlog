import fs from "node:fs/promises";
import { watch } from "node:fs";
import path from "node:path";
import notionSdk from "../node_modules/notion-astro-loader/node_modules/@notionhq/client/build/src/index.js";
import notionRehype from "notion-rehype-k";
import rehypeKatex from "rehype-katex";
import rehypeSlug from "rehype-slug";
import rehypeStringify from "rehype-stringify";
import { unified } from "unified";
import { downloadAndUpload, processImagesInContent } from "../src/lib/r2-sync.ts";

const { Client, iteratePaginatedAPI, isFullBlock, isFullPage } = notionSdk;

const ROOT = process.cwd();
const POSTS_DIR = path.join(ROOT, "public", "posts");
const DATA_DIR = path.join(ROOT, "public", "data");
const TOOLS_SOURCE_DIR = path.join(ROOT, "tools");
const TOOLS_PUBLIC_DIR = path.join(ROOT, "public", "tools");
const LOG_DIR = path.join(ROOT, "logs", "notion-sync");
const GENERATED_DIR = path.join(ROOT, "src", "generated");
const OUTPUT_JSON = path.join(DATA_DIR, "posts.json");
const OUTPUT_GENERATED = path.join(GENERATED_DIR, "notion-blog.json");
const DEFAULT_POLL_MS = 12 * 60 * 60 * 1000;

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

await fs.mkdir(POSTS_DIR, { recursive: true });
await fs.mkdir(DATA_DIR, { recursive: true });
await fs.mkdir(TOOLS_PUBLIC_DIR, { recursive: true });
await fs.mkdir(LOG_DIR, { recursive: true });
await fs.mkdir(GENERATED_DIR, { recursive: true });

function getEnv(name) {
  const value = process.env[name];
  if (!value) {
    return undefined;
  }
  return value.trim().replace(/^"|"$/g, "").replace(/^'|'$/g, "");
}

function pickProperty(properties, ...names) {
  for (const name of names) {
    if (properties[name]) {
      return properties[name];
    }
  }
  return undefined;
}

function findPropertyByType(properties, ...types) {
  return Object.values(properties).find((property) => property?.type && types.includes(property.type));
}

function textFromProperty(property) {
  if (!property) {
    return "";
  }
  const titleText = (property.title || []).map((item) => item.plain_text || "").join("").trim();
  if (titleText) {
    return titleText;
  }
  return (property.rich_text || []).map((item) => item.plain_text || "").join("").trim();
}

function dateFromProperty(property) {
  return property?.date?.start || property?.created_time?.slice(0, 10) || new Date().toISOString().slice(0, 10);
}

function statusFromProperty(property) {
  return property?.status?.name || property?.select?.name || "Draft";
}

function hiddenFromProperty(property) {
  if (!property) {
    return false;
  }

  if (property.checkbox === true) {
    return true;
  }

  const state = (property?.status?.name || property?.select?.name || "").toLowerCase();
  return state === "hidden" || state === "private";
}

function tagsFromProperty(property) {
  return (property?.multi_select || []).map((item) => item.name || "").filter(Boolean);
}

function fileUrlFromObject(fileObj) {
  if (!fileObj) {
    return undefined;
  }
  if (fileObj.type === "external") {
    return fileObj.external?.url;
  }
  if (fileObj.type === "file") {
    return fileObj.file?.url;
  }
  return undefined;
}

function fileUrlFromProperty(property) {
  if (!property?.files?.length) {
    return undefined;
  }
  return fileUrlFromObject(property.files[0]);
}

function toSlug(input) {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-")
    .replace(/^-+|-+$/g, "") || "untitled";
}

function stripHtml(input) {
  return input.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function syncLogFilePath() {
  const now = new Date();
  const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}-${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}${String(now.getSeconds()).padStart(2, "0")}-${String(now.getMilliseconds()).padStart(3, "0")}`;
  return path.join(LOG_DIR, `notion-sync-${stamp}.json`);
}

const processor = unified()
  .use(notionRehype, {})
  .use(rehypeSlug)
  .use(rehypeKatex)
  .use(rehypeStringify);

async function* listBlocks(client, blockId) {
  for await (const block of iteratePaginatedAPI(client.blocks.children.list, { block_id: blockId })) {
    if (!isFullBlock(block)) {
      continue;
    }

    if (block.has_children) {
      const children = [];
      for await (const child of listBlocks(client, block.id)) {
        children.push(child);
      }
      block[block.type].children = children;
    }

    if (block.type === "image") {
      const url = fileUrlFromObject(block.image);
      yield {
        ...block,
        image: {
          type: block.image.type,
          [block.image.type]: url,
          caption: block.image.caption,
        },
      };
      continue;
    }

    yield block;
  }
}

async function renderPageHtml(client, page) {
  const blocks = [];
  for await (const block of listBlocks(client, page.id)) {
    blocks.push(block);
  }
  const vFile = processor.process({ data: blocks });
  return vFile.toString();
}

async function syncToolPages() {
  const entries = await fs.readdir(TOOLS_SOURCE_DIR, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }
    if (entry.name === "import-md.mjs" || entry.name === "sync-notion.mjs") {
      continue;
    }
    const source = path.join(TOOLS_SOURCE_DIR, entry.name);
    const target = path.join(TOOLS_PUBLIC_DIR, entry.name);
    if (/\.html?$/i.test(entry.name)) {
      let content = await fs.readFile(source, "utf8");
      if (!content.includes('data-home-link="true"')) {
        const styleBlock = '<style>[data-home-link="true"]{position:fixed;top:16px;left:16px;z-index:9999;padding:8px 14px;border-radius:999px;border:1px solid rgba(255,255,255,.35);background:rgba(0,0,0,.24);color:#fff;text-decoration:none;font:500 13px/1.2 Noto Sans,sans-serif;backdrop-filter:blur(8px)}</style>';
        if (content.includes("</head>")) {
          content = content.replace("</head>", `${styleBlock}</head>`);
        }
        if (content.includes("<body")) {
          content = content.replace(/<body([^>]*)>/i, '<body$1><a data-home-link="true" href="/">返回首页</a>');
        }
      }
      await fs.writeFile(target, content, "utf8");
      continue;
    }
    await fs.copyFile(source, target);
  }
}

async function fetchNotionPosts() {
  const notionToken = getEnv("NOTION_TOKEN");
  const notionDatabaseId = getEnv("NOTION_DATABASE_ID");
  if (!notionToken || !notionDatabaseId) {
    throw new Error("NOTION_TOKEN or NOTION_DATABASE_ID is missing");
  }

  const client = new Client({ auth: notionToken });
  const posts = [];

  for await (const page of iteratePaginatedAPI(client.databases.query, { database_id: notionDatabaseId })) {
    if (!isFullPage(page)) {
      continue;
    }

    const properties = page.properties || {};
    const title = textFromProperty(
      findPropertyByType(properties, "title") || pickProperty(properties, "Title", "Name", "title", "标题", "名称"),
    ) || "未命名文章";
    const slug = textFromProperty(
      pickProperty(properties, "Slug", "slug", "链接", "短链", "Path"),
    ) || toSlug(title);
    const date = dateFromProperty(
      pickProperty(properties, "Date", "date", "日期", "Published", "PublishDate", "发布时间") ||
      findPropertyByType(properties, "date", "created_time"),
    );
    const status = statusFromProperty(
      pickProperty(properties, "Status", "status", "状态") || findPropertyByType(properties, "status", "select"),
    );
    const isHidden = hiddenFromProperty(
      pickProperty(properties, "Hidden", "hidden", "隐藏", "isHidden"),
    );
    const tags = tagsFromProperty(
      pickProperty(properties, "Tags", "tags", "标签") || findPropertyByType(properties, "multi_select"),
    );

    if (status.toLowerCase() !== "published" || isHidden) {
      continue;
    }

    let cover =
      fileUrlFromObject(page.cover) ||
      fileUrlFromProperty(pickProperty(properties, "CoverImage", "Cover", "cover", "封面图", "封面") || findPropertyByType(properties, "files")) ||
      undefined;

    if (cover) {
      try {
        cover = await downloadAndUpload(cover, { publishedAt: date });
      } catch (error) {
        console.warn("[sync-notion] cover upload failed, using original url", error);
      }
    }

    const html = await renderPageHtml(client, page);
    const processedBody = await processImagesInContent(html, { publishedAt: date, concurrency: 5 });
    const excerpt = textFromProperty(
      pickProperty(properties, "excerpt", "Excerpt", "摘要") || findPropertyByType(properties, "rich_text"),
    ) || stripHtml(processedBody).slice(0, 150);

    posts.push({
      slug,
      title,
      date,
      cover,
      excerpt,
      tags,
      notionId: page.id,
      notionUrl: page.url,
      body: processedBody,
    });
  }

  posts.sort((a, b) => new Date(b.date) - new Date(a.date));
  return posts;
}

function renderPostPage(post) {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${post.title}</title>
  <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
  <link rel="stylesheet" href="../assets/css/style.css" />
</head>
<body class="post-body">
  <aside class="side-nav" aria-label="侧边导航">
    <a data-nav-link href="/">首页</a>
    <a data-nav-link href="/pages/blog.html">博客</a>
    <a data-nav-link href="/pages/tools.html">工具</a>
  </aside>
  <main class="post-article-wrap">
    <article class="post-article">
      <a class="post-back" href="../pages/blog.html">Back To Blog</a>
      <h1>${post.title}</h1>
      <p class="post-meta">${post.date}</p>
      ${post.cover ? `<img class="post-cover" src="${post.cover}" alt="${post.title}" loading="lazy" />` : ""}
      <section class="post-content">${post.body}</section>
    </article>
  </main>
</body>
</html>`;
}

async function writeArtifacts(posts) {
  const activeSlugs = new Set(posts.map((post) => post.slug));

  for (const post of posts) {
    await fs.writeFile(path.join(POSTS_DIR, `${post.slug}.html`), renderPostPage(post), "utf8");
  }

  const existingHtmlFiles = (await fs.readdir(POSTS_DIR)).filter((file) => file.endsWith(".html"));
  for (const htmlFile of existingHtmlFiles) {
    const slug = htmlFile.replace(/\.html$/i, "");
    if (!activeSlugs.has(slug)) {
      await fs.unlink(path.join(POSTS_DIR, htmlFile));
    }
  }

  const publicPosts = posts.map(({ slug, title, date, cover, excerpt, tags, notionId, notionUrl }) => ({
    slug,
    title,
    date,
    cover,
    excerpt,
    tags,
    notionId,
    notionUrl,
  }));

  await fs.writeFile(OUTPUT_JSON, `${JSON.stringify(publicPosts, null, 2)}\n`, "utf8");
  await fs.writeFile(OUTPUT_GENERATED, `${JSON.stringify(posts, null, 2)}\n`, "utf8");
  await fs.writeFile(syncLogFilePath(), `${JSON.stringify({ generatedAt: new Date().toISOString(), count: posts.length, posts }, null, 2)}\n`, "utf8");
}

let previousDigest = "";

async function runSync() {
  const posts = await fetchNotionPosts();
  const digest = JSON.stringify(posts.map((post) => [post.slug, post.date, post.title, post.cover]));
  if (digest === previousDigest) {
    console.log(`[sync-notion] No content changes (${posts.length} posts)`);
    await syncToolPages();
    return;
  }

  previousDigest = digest;
  await writeArtifacts(posts);
  await syncToolPages();
  console.log(`[sync-notion] Synced ${posts.length} posts from Notion`);
}

await runSync();

if (process.argv.includes("--watch")) {
  const pollMs = Number(getEnv("NOTION_POLL_MS") || "") || DEFAULT_POLL_MS;
  console.log(`[sync-notion] Polling Notion every ${Math.round(pollMs / 1000)}s`);
  setInterval(() => {
    void runSync().catch((error) => {
      console.error("[sync-notion] sync failed:", error);
    });
  }, pollMs);

  watch(TOOLS_SOURCE_DIR, { persistent: true }, () => {
    void syncToolPages().catch((error) => {
      console.error("[sync-notion] tool sync failed:", error);
    });
  });
}
