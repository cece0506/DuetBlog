import fs from "node:fs/promises";
import { watch } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import notionSdk from "../node_modules/notion-astro-loader/node_modules/@notionhq/client/build/src/index.js";
import notionRehype from "notion-rehype-k";
import rehypeKatex from "rehype-katex";
import rehypeSlug from "rehype-slug";
import rehypeStringify from "rehype-stringify";
import { unified } from "unified";
import { ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";
import { downloadAndUpload, processImagesInContent } from "./r2-sync.mjs";

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
const CACHE_FILE = path.join(GENERATED_DIR, "notion-sync-cache.json");
const STATE_FILE = path.join(GENERATED_DIR, "notion-sync-state.json");
const CACHE_VERSION = 2;
const STATE_VERSION = 1;
const DEFAULT_POLL_MS = 12 * 60 * 60 * 1000;
const DEFAULT_LOG_RETENTION_DAYS = 7;
const DEFAULT_FULL_REFRESH_HOURS = 24 * 7;

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

function datePartsFromValue(dateValue) {
  const date = new Date(dateValue);
  const validDate = Number.isNaN(date.getTime()) ? new Date() : date;
  return {
    year: String(validDate.getFullYear()),
    month: String(validDate.getMonth() + 1).padStart(2, "0"),
    day: String(validDate.getDate()).padStart(2, "0"),
  };
}

function buildPostPublicPath(post) {
  const { year, month, day } = datePartsFromValue(post.date);
  return `/posts/${year}/${month}/${day}/${encodeURIComponent(post.slug)}.html`;
}

function buildPostOutputPath(post) {
  const { year, month, day } = datePartsFromValue(post.date);
  return path.join(POSTS_DIR, year, month, day, `${post.slug}.html`);
}

function buildLegacyPostOutputPath(post) {
  return path.join(POSTS_DIR, `${post.slug}.html`);
}

function renderLegacyRedirectPage(targetPath) {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="refresh" content="0; url=${targetPath}" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Redirecting...</title>
  <script>window.location.replace(${JSON.stringify(targetPath)});</script>
</head>
<body>
  <p>Redirecting to <a href="${targetPath}">${targetPath}</a></p>
</body>
</html>`;
}

async function listHtmlFilesRecursive(dirPath) {
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listHtmlFilesRecursive(fullPath));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".html")) {
      files.push(fullPath);
    }
  }
  return files;
}

async function removeEmptyDirectories(dirPath) {
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const fullPath = path.join(dirPath, entry.name);
    await removeEmptyDirectories(fullPath);
    const nested = await fs.readdir(fullPath);
    if (nested.length === 0) {
      await fs.rmdir(fullPath);
    }
  }
}

function syncLogFilePath() {
  const now = new Date();
  const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}-${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}${String(now.getSeconds()).padStart(2, "0")}-${String(now.getMilliseconds()).padStart(3, "0")}`;
  return path.join(LOG_DIR, `notion-sync-${stamp}.json`);
}

function parsePositiveInt(value, fallback) {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) {
    return fallback;
  }
  return Math.floor(num);
}

async function cleanupOldLogs() {
  const retentionDays = parsePositiveInt(getEnv("SYNC_LOG_RETENTION_DAYS"), DEFAULT_LOG_RETENTION_DAYS);
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  const entries = await fs.readdir(LOG_DIR, { withFileTypes: true });

  await Promise.all(entries.map(async (entry) => {
    if (!entry.isFile() || !entry.name.endsWith(".json")) {
      return;
    }
    const fullPath = path.join(LOG_DIR, entry.name);
    try {
      const stat = await fs.stat(fullPath);
      if (stat.mtimeMs < cutoff) {
        await fs.unlink(fullPath);
      }
    } catch {
      return;
    }
  }));
}

async function loadSyncCache() {
  try {
    const content = await fs.readFile(CACHE_FILE, "utf8");
    const parsed = JSON.parse(content);
    if (
      parsed &&
      typeof parsed === "object" &&
      parsed.version === CACHE_VERSION &&
      parsed.entries &&
      typeof parsed.entries === "object"
    ) {
      return parsed;
    }
  } catch {
    return { version: CACHE_VERSION, entries: {} };
  }
  return { version: CACHE_VERSION, entries: {} };
}

async function saveSyncCache(cache) {
  await fs.writeFile(CACHE_FILE, `${JSON.stringify(cache, null, 2)}\n`, "utf8");
}

async function loadSyncState() {
  try {
    const content = await fs.readFile(STATE_FILE, "utf8");
    const parsed = JSON.parse(content);
    if (parsed && typeof parsed === "object" && parsed.version === STATE_VERSION) {
      return parsed;
    }
  } catch {
    return { version: STATE_VERSION, lastSuccessfulSyncAt: "" };
  }
  return { version: STATE_VERSION, lastSuccessfulSyncAt: "" };
}

async function saveSyncState(state) {
  await fs.writeFile(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

function shouldUseIncrementalSync(state, cache) {
  const incrementalEnabled = getEnv("NOTION_INCREMENTAL_SYNC") !== "false";
  if (!incrementalEnabled || !state?.lastSuccessfulSyncAt) {
    return "";
  }

  if (Object.keys(cache?.entries || {}).length === 0) {
    return "";
  }

  const fullRefreshHours = parsePositiveInt(getEnv("NOTION_FULL_REFRESH_HOURS"), DEFAULT_FULL_REFRESH_HOURS);
  const lastMs = Date.parse(state.lastSuccessfulSyncAt);
  if (!Number.isFinite(lastMs)) {
    return "";
  }

  const maxAgeMs = fullRefreshHours * 60 * 60 * 1000;
  if (Date.now() - lastMs >= maxAgeMs) {
    return "";
  }

  return state.lastSuccessfulSyncAt;
}

function normalizeCacheEntries(rawEntries) {
  const entries = {};
  for (const [pageId, entry] of Object.entries(rawEntries || {})) {
    if (!entry || typeof entry !== "object" || !entry.post) {
      continue;
    }
    entries[pageId] = entry;
  }
  return entries;
}

async function queryNotionPages(client, notionDatabaseId, editedSince = "") {
  const query = { database_id: notionDatabaseId };
  if (editedSince) {
    query.filter = {
      timestamp: "last_edited_time",
      last_edited_time: { on_or_after: editedSince },
    };
  }

  const pages = [];
  for await (const page of iteratePaginatedAPI(client.databases.query, query)) {
    if (!isFullPage(page)) {
      continue;
    }
    pages.push(page);
  }

  return pages;
}

function createR2ListClient() {
  const accessKeyId = getEnv("R2_ACCESS_KEY_ID");
  const secretAccessKey = getEnv("R2_SECRET_ACCESS_KEY");
  const endpoint = getEnv("R2_ENDPOINT");
  const region = getEnv("R2_REGION") || "auto";
  if (!accessKeyId || !secretAccessKey || !endpoint) {
    return undefined;
  }

  return new S3Client({
    region,
    endpoint,
    forcePathStyle: true,
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
  });
}

async function listFallbackCovers() {
  const explicitUrls = (getEnv("COVER_FALLBACK_URLS") || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const urls = new Set(explicitUrls);

  const bucket = getEnv("R2_BUCKET_NAME");
  const publicBase = (getEnv("R2_PUBLIC_BASE_URL") || "").replace(/\/+$/, "");
  const prefixRaw = getEnv("COVER_FALLBACK_PREFIX") || "covers/";
  const prefix = prefixRaw.replace(/^\/+/, "");

  const client = createR2ListClient();
  if (client && bucket && publicBase) {
    try {
      let continuationToken;
      do {
        const response = await client.send(new ListObjectsV2Command({
          Bucket: bucket,
          Prefix: prefix,
          ContinuationToken: continuationToken,
        }));

        for (const item of response.Contents || []) {
          const key = item.Key || "";
          if (!key || key.endsWith("/")) {
            continue;
          }
          if (!/\.(png|jpe?g|webp|gif|avif|svg)$/i.test(key)) {
            continue;
          }
          urls.add(`${publicBase}/${key}`);
        }
        continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
      } while (continuationToken);
    } catch (error) {
      console.warn("[sync-notion] failed to list fallback covers from R2", error);
    }
  }

  return Array.from(urls).sort();
}

function stablePickCover(urls, seed) {
  if (!urls.length) {
    return undefined;
  }
  const hash = createHash("sha1").update(seed || "fallback-cover").digest("hex");
  const index = Number.parseInt(hash.slice(0, 8), 16) % urls.length;
  return urls[index];
}

function hasTemporaryNotionUrl(input) {
  return /secure\.notion-static\.com|prod-files-secure\.s3\.|s3\.[^.]+\.amazonaws\.com|s3\.amazonaws\.com/i.test(input || "");
}

function postContainsTemporaryAsset(post) {
  if (!post) {
    return false;
  }
  return hasTemporaryNotionUrl(post.cover) || hasTemporaryNotionUrl(post.body);
}

function getStatusPropertyName(properties) {
  const direct = ["Status", "status", "状态"].find((name) => properties[name]);
  if (direct) {
    return direct;
  }
  const byType = Object.entries(properties).find(([, property]) => property?.type === "status" || property?.type === "select");
  return byType?.[0];
}

async function sendFailureNotification(message, detail = {}) {
  const webhook = getEnv("SYNC_NOTIFY_WEBHOOK");
  if (!webhook) {
    console.warn(`[sync-notion] ${message}`, detail);
    return;
  }

  try {
    await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: message,
        detail,
        source: "sync-notion",
        at: new Date().toISOString(),
      }),
    });
  } catch (error) {
    console.warn("[sync-notion] notify webhook failed", error);
  }
}

async function markPagePublishFailed(client, pageId, statusPropertyName, propertyType) {
  if (!statusPropertyName) {
    return;
  }

  const updateValue = propertyType === "select"
    ? { select: { name: "Published Failed" } }
    : { status: { name: "Published Failed" } };

  await client.pages.update({
    page_id: pageId,
    properties: {
      [statusPropertyName]: updateValue,
    },
  });
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
  const vFile = await processor.process({ data: blocks });
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

function isPublishedAndVisible(page) {
  const properties = page.properties || {};
  const statusProperty = pickProperty(properties, "Status", "status", "状态") || findPropertyByType(properties, "status", "select");
  const status = statusFromProperty(statusProperty);
  const isHidden = hiddenFromProperty(pickProperty(properties, "Hidden", "hidden", "隐藏", "isHidden"));
  return {
    properties,
    statusProperty,
    status,
    isHidden,
    visible: status.toLowerCase() === "published" && !isHidden,
  };
}

async function buildPostFromPage(client, page, fallbackCovers, cachedPost) {
  const properties = page.properties || {};
  const pageId = page.id;

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
  const tags = tagsFromProperty(
    pickProperty(properties, "Tags", "tags", "标签") || findPropertyByType(properties, "multi_select"),
  );

  const notionCover =
    fileUrlFromObject(page.cover) ||
    fileUrlFromProperty(pickProperty(properties, "CoverImage", "Cover", "cover", "封面图", "封面") || findPropertyByType(properties, "files")) ||
    undefined;

  const fallbackCover = stablePickCover(fallbackCovers, `${pageId}:${slug}`);
  let cover = notionCover || fallbackCover || cachedPost?.cover || undefined;

  if (notionCover) {
    try {
      cover = await downloadAndUpload(notionCover, { publishedAt: date });
    } catch (error) {
      console.warn("[sync-notion] cover upload failed, using previous/fallback cover", error);
      cover = cachedPost?.cover || fallbackCover || notionCover;
    }
  }

  const html = await renderPageHtml(client, page);
  const processedBody = await processImagesInContent(html, { publishedAt: date, concurrency: 5 });
  const excerpt = textFromProperty(
    pickProperty(properties, "excerpt", "Excerpt", "摘要") || findPropertyByType(properties, "rich_text"),
  ) || stripHtml(processedBody).slice(0, 150);

  return {
    slug,
    title,
    date,
    cover,
    excerpt,
    tags,
    notionId: pageId,
    notionUrl: page.url,
    body: processedBody,
  };
}

async function fetchNotionPosts() {
  const notionToken = getEnv("NOTION_TOKEN");
  const notionDatabaseId = getEnv("NOTION_DATABASE_ID");
  if (!notionToken || !notionDatabaseId) {
    throw new Error("NOTION_TOKEN or NOTION_DATABASE_ID is missing");
  }

  const client = new Client({ auth: notionToken });
  const cache = await loadSyncCache();
  const state = await loadSyncState();
  const fallbackCovers = await listFallbackCovers();
  const editedSince = shouldUseIncrementalSync(state, cache);
  const pages = await queryNotionPages(client, notionDatabaseId, editedSince);
  const nextCacheEntries = editedSince ? normalizeCacheEntries(cache.entries) : {};

  console.log(`[sync-notion] Query mode: ${editedSince ? `incremental (since ${editedSince})` : "full"}, fetched ${pages.length} pages`);

  for (const page of pages) {
    const pageId = page.id;
    const lastEditedTime = page.last_edited_time || "";
    const pageState = isPublishedAndVisible(page);

    if (!pageState.visible) {
      delete nextCacheEntries[pageId];
      continue;
    }

    const cached = nextCacheEntries[pageId] || cache.entries[pageId];

    try {
      const canReuseCached =
        cached?.lastEditedTime === lastEditedTime &&
        cached?.post &&
        !postContainsTemporaryAsset(cached.post);

      const post = canReuseCached
        ? {
          ...cached.post,
          notionId: pageId,
          notionUrl: page.url,
        }
        : await buildPostFromPage(client, page, fallbackCovers, cached?.post);

      nextCacheEntries[pageId] = {
        lastEditedTime,
        post,
      };
    } catch (error) {
      const statusPropertyName = getStatusPropertyName(pageState.properties);
      const statusPropertyType = pageState.statusProperty?.type === "select" ? "select" : "status";
      try {
        await markPagePublishFailed(client, page.id, statusPropertyName, statusPropertyType);
      } catch (updateError) {
        console.warn("[sync-notion] failed to update status to Published Failed", updateError);
      }

      await sendFailureNotification("Notion 博客发布失败，状态已回写 Published Failed", {
        pageId: page.id,
        pageUrl: page.url,
        reason: String(error),
      });
      console.error("[sync-notion] page publish failed", page.id, error);
    }
  }

  const posts = Object.values(nextCacheEntries)
    .map((entry) => entry?.post)
    .filter(Boolean)
    .sort((a, b) => new Date(b.date) - new Date(a.date));

  await saveSyncCache({ version: CACHE_VERSION, entries: nextCacheEntries });
  await saveSyncState({
    version: STATE_VERSION,
    lastSuccessfulSyncAt: new Date().toISOString(),
  });

  return posts;
}

function renderPostPage(post) {
  const tagsHtml = (post.tags || []).map((tag) => `<span class="post-detail-tag">${tag}</span>`).join("");
  const previousLink = post.previousPost
    ? `<a class="post-switch-card" href="${post.previousPost.path}"><span>上一篇</span><strong>${post.previousPost.title}</strong></a>`
    : `<div class="post-switch-card is-disabled"><span>上一篇</span><strong>已经是第一篇</strong></div>`;
  const nextLink = post.nextPost
    ? `<a class="post-switch-card" href="${post.nextPost.path}"><span>下一篇</span><strong>${post.nextPost.title}</strong></a>`
    : `<div class="post-switch-card is-disabled"><span>下一篇</span><strong>已经是最后一篇</strong></div>`;
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${post.title}</title>
  <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
  <link rel="stylesheet" href="/assets/css/style.css" />
</head>
<body class="post-body">
  <aside class="side-nav" aria-label="侧边导航">
    <a data-nav-link href="/">首页</a>
    <a data-nav-link href="/pages/blog.html">博客</a>
    <a data-nav-link href="/pages/tools.html">工具</a>
    <button type="button" class="side-nav-top" data-scroll-top aria-label="回到顶部">顶部</button>
  </aside>
  <aside class="tree-sidebar" id="post-tree-sidebar" aria-label="博客目录侧边栏">
    <button type="button" class="tree-sidebar-toggle" data-tree-toggle aria-expanded="true" aria-label="收起博客目录">目录</button>
    <div class="tree-sidebar-title">博客目录</div>
    <div class="tree-sidebar-body" data-tree-body></div>
  </aside>
  <main class="post-article-wrap">
    <article class="post-article">
      <a class="post-back" href="/pages/blog.html">Back To Blog</a>
      ${post.cover ? `<img class="post-cover" src="${post.cover}" alt="${post.title}" loading="lazy" />` : ""}
      <h1 class="post-title">${post.title}</h1>
      <p class="post-meta">${post.date}</p>
      <div class="post-detail-meta">
        <p><strong>短链 Slug：</strong>${post.slug || "-"}</p>
        <p><strong>摘要 Excerpt：</strong>${post.excerpt || "-"}</p>
        <div class="post-detail-tags"><strong>标签 Tags：</strong>${tagsHtml || "-"}</div>
      </div>
      <section class="post-content">${post.body}</section>
      <nav class="post-switch-nav" aria-label="上一篇下一篇">
        ${previousLink}
        ${nextLink}
      </nav>
    </article>
  </main>
  <script src="/assets/js/blog-tree.js"></script>
</body>
</html>`;
}

async function writeArtifacts(posts) {
  const postsWithPaths = posts.map((post, index) => ({
    ...post,
    path: buildPostPublicPath(post),
    previousPost: index > 0 ? {
      title: posts[index - 1].title,
      path: buildPostPublicPath(posts[index - 1]),
    } : undefined,
    nextPost: index < posts.length - 1 ? {
      title: posts[index + 1].title,
      path: buildPostPublicPath(posts[index + 1]),
    } : undefined,
  }));

  const activeHtmlPaths = new Set();

  for (const post of postsWithPaths) {
    const datedOutputPath = buildPostOutputPath(post);
    const legacyOutputPath = buildLegacyPostOutputPath(post);
    await fs.mkdir(path.dirname(datedOutputPath), { recursive: true });
    await fs.writeFile(datedOutputPath, renderPostPage(post), "utf8");
    await fs.writeFile(legacyOutputPath, renderLegacyRedirectPage(post.path), "utf8");
    activeHtmlPaths.add(datedOutputPath);
    activeHtmlPaths.add(legacyOutputPath);
  }

  const existingHtmlFiles = await listHtmlFilesRecursive(POSTS_DIR);
  for (const htmlFile of existingHtmlFiles) {
    if (!activeHtmlPaths.has(htmlFile)) {
      await fs.unlink(htmlFile);
    }
  }
  await removeEmptyDirectories(POSTS_DIR);

  const publicPosts = postsWithPaths.map(({ slug, title, date, cover, excerpt, tags, notionId, notionUrl, path: postPath }) => ({
    slug,
    title,
    date,
    cover,
    excerpt,
    tags,
    notionId,
    notionUrl,
    path: postPath,
  }));

  await fs.writeFile(OUTPUT_JSON, `${JSON.stringify(publicPosts, null, 2)}\n`, "utf8");
  await fs.writeFile(OUTPUT_GENERATED, `${JSON.stringify(postsWithPaths, null, 2)}\n`, "utf8");
  await fs.writeFile(syncLogFilePath(), `${JSON.stringify({ generatedAt: new Date().toISOString(), count: postsWithPaths.length, posts: postsWithPaths }, null, 2)}\n`, "utf8");
}

let previousDigest = "";

async function runSync() {
  await cleanupOldLogs();
  const posts = await fetchNotionPosts();
  const digest = JSON.stringify(posts);
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
