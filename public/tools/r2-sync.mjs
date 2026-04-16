import { createHash } from "node:crypto";
import path from "node:path";
import axios from "axios";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

const NOTION_IMAGE_RE = /https?:\/\/[^\s"'()<>]+(?:secure\.notion-static\.com|s3\.amazonaws\.com)[^\s"'()<>]*/gi;
const ASTRO_IMAGE_PROXY_RE = /\/\_image\?[^"'<>]*href=([^&"'<>]+)[^"'<>]*/gi;
const DEFAULT_PUBLIC_BASE_URL = "https://duet-blog-images.duetpalace.top";
const DEFAULT_CONCURRENCY = 4;

const uploadCache = new Map();

function getEnv(name) {
  const value = process.env[name];
  if (!value) {
    return undefined;
  }

  return value.trim().replace(/^"|"$/g, "").replace(/^'|'$/g, "");
}

function resolveConfig() {
  const accessKeyId = getEnv("R2_ACCESS_KEY_ID") || "";
  const secretAccessKey = getEnv("R2_SECRET_ACCESS_KEY") || "";
  const bucketName = getEnv("R2_BUCKET_NAME") || "";
  const endpoint = getEnv("R2_ENDPOINT") || "";
  const publicBaseUrl = (getEnv("R2_PUBLIC_BASE_URL") || DEFAULT_PUBLIC_BASE_URL).replace(/\/+$/, "");
  const region = getEnv("R2_REGION") || "auto";

  if (!accessKeyId || !secretAccessKey || !bucketName || !endpoint) {
    throw new Error("R2 config is incomplete. Please set R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME, R2_ENDPOINT");
  }

  return { accessKeyId, secretAccessKey, bucketName, endpoint, publicBaseUrl, region };
}

function createR2Client(config) {
  return new S3Client({
    region: config.region || "auto",
    endpoint: config.endpoint,
    forcePathStyle: true,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });
}

function isNotionTemporaryImage(url) {
  return /secure\.notion-static\.com|s3\.amazonaws\.com/i.test(url);
}

function getYearMonth(publishedAt) {
  const date = publishedAt ? new Date(publishedAt) : new Date();
  const validDate = Number.isNaN(date.getTime()) ? new Date() : date;
  const year = String(validDate.getFullYear());
  const month = String(validDate.getMonth() + 1).padStart(2, "0");
  return { year, month };
}

function extensionFromContentType(contentType) {
  if (!contentType) {
    return undefined;
  }
  const normalized = contentType.split(";")[0].trim().toLowerCase();
  const map = {
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
    "image/avif": "avif",
    "image/svg+xml": "svg",
    "image/tiff": "tiff",
    "image/bmp": "bmp",
  };
  return map[normalized];
}

function extensionFromUrl(url) {
  try {
    const pathname = new URL(url).pathname;
    const ext = path.extname(pathname).replace(".", "").toLowerCase();
    return ext || undefined;
  } catch {
    return undefined;
  }
}

function stripTrackingParams(url) {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return url;
  }
}

async function mapWithConcurrency(items, concurrency, worker) {
  const queue = [...items];
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (queue.length > 0) {
      const item = queue.shift();
      if (item === undefined) {
        break;
      }
      await worker(item);
    }
  });

  await Promise.all(runners);
}

export async function downloadAndUpload(notionImageUrl, options = {}) {
  if (!isNotionTemporaryImage(notionImageUrl)) {
    return notionImageUrl;
  }

  const cacheKey = stripTrackingParams(notionImageUrl);
  const cached = uploadCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const task = (async () => {
    const config = resolveConfig();
    const client = createR2Client(config);

    const response = await axios.get(notionImageUrl, {
      responseType: "arraybuffer",
      timeout: 20000,
      maxRedirects: 5,
      validateStatus: (status) => status >= 200 && status < 400,
    });

    const contentType = String(response.headers["content-type"] || "");
    const fileBuffer = Buffer.from(response.data);
    const md5 = createHash("md5").update(fileBuffer).digest("hex");

    const ext = extensionFromContentType(contentType) || extensionFromUrl(notionImageUrl) || "bin";
    const { year, month } = getYearMonth(options.publishedAt);
    const key = `${year}/${month}/${md5}.${ext}`;

    await client.send(new PutObjectCommand({
      Bucket: config.bucketName,
      Key: key,
      Body: fileBuffer,
      ContentType: contentType || `image/${ext}`,
      CacheControl: "public, max-age=31536000, immutable",
    }));

    return `${config.publicBaseUrl}/${key}`;
  })();

  uploadCache.set(cacheKey, task);
  try {
    return await task;
  } finally {
    uploadCache.delete(cacheKey);
  }
}

export async function processImagesInContent(htmlContent, options = {}) {
  if (!htmlContent) {
    return htmlContent;
  }

  const directMatches = htmlContent.match(NOTION_IMAGE_RE) || [];
  const proxyMatches = Array.from(htmlContent.matchAll(ASTRO_IMAGE_PROXY_RE));
  const proxyUrlMap = new Map();
  for (const match of proxyMatches) {
    const encoded = match[1];
    if (!encoded) {
      continue;
    }
    try {
      const decoded = decodeURIComponent(encoded);
      if (isNotionTemporaryImage(decoded)) {
        proxyUrlMap.set(match[0], decoded);
      }
    } catch {
      continue;
    }
  }

  const uniqueUrls = Array.from(new Set([...directMatches, ...proxyUrlMap.values()]));
  if (uniqueUrls.length === 0 && proxyUrlMap.size === 0) {
    return htmlContent;
  }

  const replacements = new Map();
  await mapWithConcurrency(uniqueUrls, options.concurrency || DEFAULT_CONCURRENCY, async (url) => {
    try {
      const uploadedUrl = await downloadAndUpload(url, options);
      replacements.set(url, uploadedUrl);
    } catch (error) {
      console.error("[r2-sync] Failed to process image:", url, error);
      replacements.set(url, url);
    }
  });

  let output = htmlContent;
  for (const [from, to] of replacements) {
    output = output.split(from).join(to);
  }

  for (const [proxyMatch, notionUrl] of proxyUrlMap) {
    const uploadedUrl = replacements.get(notionUrl) || notionUrl;
    output = output.split(proxyMatch).join(uploadedUrl);
  }

  return output;
}
