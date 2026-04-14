export {};

type PostItem = {
  slug: string;
  title: string;
  date: string;
  cover: string;
  excerpt?: string;
  tags?: string[];
};

let postsCache: PostItem[] = [];
let activeYear = new Date().getFullYear();
let activeMonth = new Date().getMonth();

function formatDate(dateValue: string) {
  const date = new Date(dateValue);
  return Number.isNaN(date.getTime())
    ? dateValue
    : date.toLocaleDateString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" });
}

function escapeHtml(input: string) {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function shorten(text: string, max = 20) {
  return text.length <= max ? text : `${text.slice(0, max)}...`;
}

async function loadPosts() {
  const response = await fetch("/data/posts.json");
  if (!response.ok) {
    throw new Error("无法读取 posts.json");
  }
  return (await response.json()) as PostItem[];
}

function buildYearMonthSelectors() {
  const yearSelect = document.getElementById("calendar-year-select") as HTMLSelectElement | null;
  const monthSelect = document.getElementById("calendar-month-select") as HTMLSelectElement | null;
  if (!yearSelect || !monthSelect) {
    return;
  }

  const allYears = postsCache
    .map((post) => new Date(post.date).getFullYear())
    .filter((year) => Number.isFinite(year));
  const minYear = Math.min(...allYears, activeYear - 1);
  const maxYear = Math.max(...allYears, activeYear + 1);

  yearSelect.innerHTML = Array.from({ length: maxYear - minYear + 1 }, (_, index) => minYear + index)
    .map((year) => `<option value="${year}" ${year === activeYear ? "selected" : ""}>${year}年</option>`)
    .join("");

  monthSelect.innerHTML = Array.from({ length: 12 }, (_, index) => index)
    .map((month) => `<option value="${month}" ${month === activeMonth ? "selected" : ""}>${month + 1}月</option>`)
    .join("");
}

function positionTooltip(tooltip: HTMLElement, clientX: number, clientY: number) {
  const padding = 14;
  const width = tooltip.offsetWidth;
  const height = tooltip.offsetHeight;
  let left = clientX + 16;
  let top = clientY + 18;

  if (left + width + padding > window.innerWidth) {
    left = clientX - width - 16;
  }
  if (top + height + padding > window.innerHeight) {
    top = clientY - height - 12;
  }

  tooltip.style.left = `${Math.max(padding, left)}px`;
  tooltip.style.top = `${Math.max(padding, top)}px`;
}

function bindTooltipEvents() {
  const tooltip = document.getElementById("calendar-post-tooltip") as HTMLElement | null;
  if (!tooltip) {
    return;
  }

  document.querySelectorAll<HTMLElement>(".calendar-post-title").forEach((entry) => {
    const title = entry.dataset.title || "";
    const date = entry.dataset.date || "";
    const excerpt = entry.dataset.excerpt || "";
    const cover = entry.dataset.cover || "";
    const href = entry.dataset.href || "#";

    const show = (event: MouseEvent | FocusEvent) => {
      tooltip.innerHTML = `
        <a class="calendar-tooltip-card" href="${href}">
          <img src="${cover}" alt="${escapeHtml(title)}" loading="lazy" />
          <div class="calendar-tooltip-body">
            <p>${formatDate(date)}</p>
            <h4>${escapeHtml(title)}</h4>
            <span>${escapeHtml(excerpt || "点击查看全文")}</span>
          </div>
        </a>
      `;
      tooltip.classList.add("is-show");
      tooltip.setAttribute("aria-hidden", "false");

      if (event instanceof MouseEvent) {
        positionTooltip(tooltip, event.clientX, event.clientY);
      }
    };

    const move = (event: MouseEvent) => {
      if (!tooltip.classList.contains("is-show")) {
        return;
      }
      positionTooltip(tooltip, event.clientX, event.clientY);
    };

    const hide = () => {
      tooltip.classList.remove("is-show");
      tooltip.setAttribute("aria-hidden", "true");
    };

    entry.addEventListener("mouseenter", show);
    entry.addEventListener("mousemove", move);
    entry.addEventListener("mouseleave", hide);
    entry.addEventListener("focus", show);
    entry.addEventListener("blur", hide);
  });
}

function buildCalendar() {
  const board = document.getElementById("calendar-board");
  if (!board) {
    return;
  }

  const firstDay = new Date(activeYear, activeMonth, 1);
  const startWeekday = firstDay.getDay();
  const daysInMonth = new Date(activeYear, activeMonth + 1, 0).getDate();
  const today = new Date();

  const postsByDay = new Map<number, PostItem[]>();
  postsCache.forEach((post) => {
    const date = new Date(post.date);
    if (Number.isNaN(date.getTime())) {
      return;
    }
    if (date.getFullYear() === activeYear && date.getMonth() === activeMonth) {
      const day = date.getDate();
      const bucket = postsByDay.get(day) || [];
      bucket.push(post);
      postsByDay.set(day, bucket);
    }
  });

  const headers = ["日", "一", "二", "三", "四", "五", "六"]
    .map((name) => `<div class="calendar-weekday">${name}</div>`)
    .join("");

  const blanks = Array.from({ length: startWeekday }, () => '<div class="calendar-cell is-empty"></div>').join("");

  const cells = Array.from({ length: daysInMonth }, (_, dayIndex) => {
    const day = dayIndex + 1;
    const dayPosts = postsByDay.get(day) || [];
    const isToday = day === today.getDate() && activeMonth === today.getMonth() && activeYear === today.getFullYear();

    if (dayPosts.length === 0) {
      return `<div class="calendar-cell ${isToday ? "is-today" : ""}"><span>${day}</span></div>`;
    }

    const titles = dayPosts.slice(0, 3)
      .map((post) => `
        <a
          class="calendar-post-title"
          href="/posts/${post.slug}.html"
          data-href="/posts/${post.slug}.html"
          data-title="${escapeHtml(post.title)}"
          data-date="${post.date}"
          data-excerpt="${escapeHtml(post.excerpt || "")}" 
          data-cover="${post.cover}">
          ${escapeHtml(shorten(post.title, 16))}
        </a>
      `)
      .join("");

    return `
      <div class="calendar-cell has-post ${isToday ? "is-today" : ""}">
        <div class="calendar-cell-head">
          <span>${day}</span>
          <em>${dayPosts.length}篇</em>
        </div>
        <div class="calendar-post-list">${titles}</div>
      </div>
    `;
  }).join("");

  board.innerHTML = `<div class="calendar-grid">${headers}${blanks}${cells}</div>`;
  bindTooltipEvents();
}

function shiftMonth(step: number) {
  const next = new Date(activeYear, activeMonth + step, 1);
  activeYear = next.getFullYear();
  activeMonth = next.getMonth();
  buildYearMonthSelectors();
  buildCalendar();
}

function wireCalendarControls() {
  const prevBtn = document.getElementById("calendar-prev-month");
  const nextBtn = document.getElementById("calendar-next-month");
  const yearSelect = document.getElementById("calendar-year-select") as HTMLSelectElement | null;
  const monthSelect = document.getElementById("calendar-month-select") as HTMLSelectElement | null;

  prevBtn?.addEventListener("click", () => shiftMonth(-1));
  nextBtn?.addEventListener("click", () => shiftMonth(1));

  yearSelect?.addEventListener("change", () => {
    activeYear = Number(yearSelect.value);
    buildCalendar();
  });

  monthSelect?.addEventListener("change", () => {
    activeMonth = Number(monthSelect.value);
    buildCalendar();
  });
}

async function initHomeCalendar() {
  try {
    postsCache = await loadPosts();
    buildYearMonthSelectors();
    buildCalendar();
    wireCalendarControls();
  } catch {
    const board = document.getElementById("calendar-board");
    if (board) {
      board.textContent = "日历加载失败";
    }
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    void initHomeCalendar();
  }, { once: true });
} else {
  void initHomeCalendar();
}
