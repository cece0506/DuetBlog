export {};

type PostItem = {
  slug: string;
  title: string;
  date: string;
  cover: string;
  path?: string;
  excerpt?: string;
  tags?: string[];
};

let allPosts: PostItem[] = [];
let activeTag = "";
let activeMonthKey = "";
let currentPage = 1;

const POSTS_PER_PAGE = 9;

function formatDate(dateValue: string) {
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) {
    return dateValue;
  }
  return date.toLocaleDateString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" });
}

async function loadPosts() {
  const response = await fetch("/data/posts.json");
  if (!response.ok) {
    throw new Error("无法读取 posts.json");
  }
  return (await response.json()) as PostItem[];
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function resolvePostPath(post: PostItem) {
  return post.path || `/posts/${encodeURIComponent(post.slug)}.html`;
}

function buildCluster(posts: PostItem[], startIndex: number) {
  const cards = Array.from({ length: 4 }, (_, offset) => posts[(startIndex + offset) % posts.length]);
  return `
    <div class="gallery-cluster">
      ${cards
        .map(
          (post, index) => `
            <a class="gallery-bubble bubble-${index + 1}" href="${resolvePostPath(post)}">
              <img src="${post.cover}" alt="${post.title}" loading="lazy" />
              <div class="bubble-overlay">
                <strong>${post.title}</strong>
                <span>${formatDate(post.date)}</span>
              </div>
            </a>
          `,
        )
        .join("")}
    </div>
  `;
}

function fillLane(lane: HTMLElement, chunks: string[]) {
  lane.innerHTML = chunks.join("");
  const viewport = lane.parentElement?.clientWidth || window.innerWidth;
  while (lane.scrollWidth < viewport * 1.08) {
    lane.innerHTML += chunks.join("");
  }
}

function renderGallery(posts: PostItem[]) {
  const laneA = document.getElementById("gallery-lane-a");
  if (!laneA || posts.length === 0) {
    return;
  }

  const clusterCount = Math.max(2, Math.ceil(Math.max(1, posts.length) / 2));
  const clusters = Array.from({ length: clusterCount }, (_, index) => buildCluster(posts, index));
  fillLane(laneA, clusters);
}

function renderPostCards(posts: PostItem[]) {
  const container = document.getElementById("post-list");
  const result = document.getElementById("blog-result-count");
  const pagination = document.getElementById("blog-pagination");
  if (!container || !result) {
    return;
  }

  const totalPages = Math.max(1, Math.ceil(posts.length / POSTS_PER_PAGE));
  currentPage = Math.min(currentPage, totalPages);
  const pageStart = (currentPage - 1) * POSTS_PER_PAGE;
  const pagePosts = posts.slice(pageStart, pageStart + POSTS_PER_PAGE);

  result.textContent = `共 ${posts.length} 篇，当前第 ${currentPage} / ${totalPages} 页`;

  if (pagePosts.length === 0) {
    container.innerHTML = '<p class="post-list-empty">没有匹配的文章。</p>';
  } else {
    container.innerHTML = pagePosts
      .map(
        (post) => {
          const safeTitle = escapeHtml(post.title);
          const safeExcerpt = escapeHtml(post.excerpt || "Read More");
          return `
        <article class="post-card">
          <a href="${resolvePostPath(post)}">
            <img src="${post.cover}" alt="${safeTitle}" loading="lazy" />
            <div class="body">
              <h3 class="post-card-title has-tooltip" data-tooltip="${safeTitle}">${safeTitle}</h3>
              <p class="post-date">${formatDate(post.date)}</p>
              <div class="post-tags-inline">
                ${(post.tags || []).map((tag) => `<span class="tag-chip">#${escapeHtml(tag)}</span>`).join("")}
              </div>
              <p class="post-card-excerpt has-tooltip" data-tooltip="${safeExcerpt}">${safeExcerpt}</p>
            </div>
          </a>
        </article>
      `;
        },
      )
      .join("");
  }

  if (!pagination) {
    return;
  }

  if (posts.length <= POSTS_PER_PAGE) {
    pagination.innerHTML = "";
    return;
  }

  const buttons = Array.from({ length: totalPages }, (_, index) => {
    const page = index + 1;
    return `<button class="blog-page-btn ${page === currentPage ? "is-active" : ""}" data-page="${page}">${page}</button>`;
  }).join("");

  pagination.innerHTML = `
    <button class="blog-page-btn" data-page-nav="prev" ${currentPage === 1 ? "disabled" : ""}>上一页</button>
    ${buttons}
    <button class="blog-page-btn" data-page-nav="next" ${currentPage === totalPages ? "disabled" : ""}>下一页</button>
  `;

  pagination.querySelectorAll<HTMLButtonElement>("[data-page]").forEach((button) => {
    button.addEventListener("click", () => {
      currentPage = Number(button.dataset.page || currentPage);
      renderPostCards(posts);
    });
  });

  pagination.querySelectorAll<HTMLButtonElement>("[data-page-nav]").forEach((button) => {
    button.addEventListener("click", () => {
      const action = button.dataset.pageNav;
      if (action === "prev") {
        currentPage = Math.max(1, currentPage - 1);
      }
      if (action === "next") {
        currentPage = Math.min(totalPages, currentPage + 1);
      }
      renderPostCards(posts);
    });
  });
}

function monthKey(dateValue: string) {
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) {
    return "unknown";
  }
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function renderDateNav(posts: PostItem[]) {
  const container = document.getElementById("blog-date-nav");
  if (!container) {
    return;
  }

  const monthMap = new Map<string, number>();
  posts.forEach((post) => {
    const key = monthKey(post.date);
    monthMap.set(key, (monthMap.get(key) || 0) + 1);
  });

  const monthItems = Array.from(monthMap.entries()).sort((a, b) => (a[0] > b[0] ? -1 : 1));
  container.innerHTML = `
    <button class="blog-month-btn ${activeMonthKey === "" ? "is-active" : ""}" data-month="">全部</button>
    ${monthItems.map(([key, count]) => `<button class="blog-month-btn ${activeMonthKey === key ? "is-active" : ""}" data-month="${key}">${key} (${count})</button>`).join("")}
  `;

  container.querySelectorAll<HTMLButtonElement>(".blog-month-btn").forEach((button) => {
    button.addEventListener("click", () => {
      activeMonthKey = button.dataset.month || "";
      applyFilters();
    });
  });
}

function renderTags(posts: PostItem[]) {
  const container = document.getElementById("blog-tags");
  if (!container) {
    return;
  }

  const tags = Array.from(new Set(posts.flatMap((post) => post.tags || []))).sort();
  container.innerHTML = `<button class="tag-filter ${activeTag === "" ? "is-active" : ""}" data-tag="">全部</button>${tags
    .map((tag) => `<button class="tag-filter ${activeTag === tag ? "is-active" : ""}" data-tag="${tag}">#${tag}</button>`)
    .join("")}`;

  container.querySelectorAll<HTMLButtonElement>(".tag-filter").forEach((button) => {
    button.addEventListener("click", () => {
      activeTag = button.dataset.tag || "";
      applyFilters();
    });
  });
}

function applyFilters() {
  const searchInput = document.getElementById("blog-search") as HTMLInputElement | null;
  const keyword = (searchInput?.value || "").trim().toLowerCase();

  const filtered = allPosts.filter((post) => {
    const titleHit = post.title.toLowerCase().includes(keyword);
    const tagHit = (post.tags || []).some((tag) => tag.toLowerCase().includes(keyword));
    const keywordHit = keyword.length === 0 ? true : titleHit || tagHit;
    const activeTagHit = activeTag.length === 0 ? true : (post.tags || []).includes(activeTag);
    const monthHit = activeMonthKey.length === 0 ? true : monthKey(post.date) === activeMonthKey;
    return keywordHit && activeTagHit && monthHit;
  });

  currentPage = 1;
  const targetPosts = filtered.length > 0 ? filtered : allPosts.slice(0, Math.min(6, allPosts.length));
  renderGallery(targetPosts.length > 0 ? targetPosts : allPosts);
  renderPostCards(filtered);
  renderTags(allPosts);
  renderDateNav(allPosts);
}

async function initBlogPage() {
  try {
    allPosts = await loadPosts();
    const searchInput = document.getElementById("blog-search") as HTMLInputElement | null;
    if (searchInput) {
      searchInput.addEventListener("input", () => applyFilters());
    }
    applyFilters();
  } catch (error) {
    const container = document.getElementById("post-list");
    if (container) {
      container.innerHTML = `<p>${error instanceof Error ? error.message : "加载失败"}</p>`;
    }
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    void initBlogPage();
  }, { once: true });
} else {
  void initBlogPage();
}
