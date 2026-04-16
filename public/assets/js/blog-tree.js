(function () {
  var STORAGE_KEY = "duet-tree-sidebar-collapsed";
  var JUMP_CLASS = "is-jump";

  function formatMonthLabel(monthKey) {
    var parts = monthKey.split("-");
    if (parts.length !== 2) {
      return monthKey;
    }
    return parts[0] + "年" + parts[1] + "月";
  }

  function groupPostsByDate(posts) {
    var yearMap = new Map();
    posts.forEach(function (post) {
      var date = new Date(post.date);
      if (Number.isNaN(date.getTime())) {
        return;
      }
      var year = String(date.getFullYear());
      var month = String(date.getMonth() + 1).padStart(2, "0");
      var monthKey = year + "-" + month;

      if (!yearMap.has(year)) {
        yearMap.set(year, new Map());
      }
      var monthMap = yearMap.get(year);
      if (!monthMap.has(monthKey)) {
        monthMap.set(monthKey, []);
      }
      monthMap.get(monthKey).push(post);
    });

    var years = Array.from(yearMap.entries()).sort(function (a, b) {
      return a[0] < b[0] ? 1 : -1;
    });

    return years.map(function (yearPair) {
      var year = yearPair[0];
      var monthMap = yearPair[1];
      var months = Array.from(monthMap.entries())
        .sort(function (a, b) {
          return a[0] < b[0] ? 1 : -1;
        })
        .map(function (monthPair) {
          var monthKey = monthPair[0];
          var monthPosts = monthPair[1].slice().sort(function (a, b) {
            return new Date(b.date) - new Date(a.date);
          });
          return { key: monthKey, label: formatMonthLabel(monthKey), posts: monthPosts };
        });
      return { year: year, months: months };
    });
  }

  function currentSlugFromPath() {
    var match = window.location.pathname.match(/\/posts\/(?:\d{4}\/\d{2}\/\d{2}\/)?([^/]+)\.html$/i);
    return match ? decodeURIComponent(match[1]) : "";
  }

  function resolvePostPath(post) {
    return post.path || "/posts/" + encodeURIComponent(post.slug) + ".html";
  }

  function matchesDate(postDate, mode) {
    var date = new Date(postDate);
    if (Number.isNaN(date.getTime())) {
      return false;
    }
    var now = new Date();
    if (mode === "today") {
      return (
        date.getFullYear() === now.getFullYear() &&
        date.getMonth() === now.getMonth() &&
        date.getDate() === now.getDate()
      );
    }

    if (mode === "month") {
      return (
        date.getFullYear() === now.getFullYear() &&
        date.getMonth() === now.getMonth()
      );
    }

    return false;
  }

  function renderTree(container, grouped, currentSlug) {
    var html = grouped
      .map(function (yearGroup) {
        var yearTotal = yearGroup.months.reduce(function (acc, month) {
          return acc + month.posts.length;
        }, 0);
        var monthHtml = yearGroup.months
          .map(function (month) {
            var hasCurrent = month.posts.some(function (post) {
              return post.slug === currentSlug;
            });
            var postHtml = month.posts
              .map(function (post) {
                var isCurrent = post.slug === currentSlug;
                return (
                  '<li>' +
                  '<a class="tree-post-link ' + (isCurrent ? "is-current" : "") + '" href="' +
                  resolvePostPath(post) +
                  '" data-tree-slug="' +
                  post.slug +
                  '" data-tree-search="' +
                  String((post.title || "") + " " + (post.date || "") + " " + ((post.tags || []).join(" ")) + " " + (post.slug || ""))
                    .toLowerCase()
                    .replace(/"/g, "&quot;") +
                  '">' +
                  '<span class="tree-post-date">' +
                  post.date +
                  "</span>" +
                  '<span class="tree-post-title">' +
                  post.title +
                  "</span>" +
                  "</a>" +
                  "</li>"
                );
              })
              .join("");

            return (
              '<details class="tree-month" ' + (hasCurrent ? "open" : "") + ">" +
              '<summary><span>' +
              month.label +
              "</span><em>" +
              month.posts.length +
              "</em></summary>" +
              '<ul class="tree-post-list">' +
              postHtml +
              "</ul>" +
              "</details>"
            );
          })
          .join("");

        return (
          '<section class="tree-year">' +
          '<h3>' +
          yearGroup.year +
          ' <small>' +
          yearTotal +
          " 篇</small></h3>" +
          monthHtml +
          "</section>"
        );
      })
      .join("");

    container.innerHTML = html || '<p class="tree-empty">暂无文章</p>';
  }

  function updateToggleState(sidebar, toggle, collapsed) {
    sidebar.classList.toggle("is-collapsed", collapsed);
    toggle.setAttribute("aria-expanded", collapsed ? "false" : "true");
    toggle.textContent = collapsed ? "☰" : "目录";
    toggle.setAttribute("aria-label", collapsed ? "展开博客目录" : "收起博客目录");
  }

  function revealPostBySlug(sidebar, slug) {
    var links = Array.from(sidebar.querySelectorAll(".tree-post-link"));
    var target = links.find(function (link) {
      return (link.getAttribute("data-tree-slug") || "") === slug;
    });
    if (!target) {
      return false;
    }

    var details = target.closest("details");
    if (details) {
      details.open = true;
    }

    target.classList.add(JUMP_CLASS);
    window.setTimeout(function () {
      target.classList.remove(JUMP_CLASS);
    }, 1200);

    target.scrollIntoView({ block: "center", behavior: "smooth" });
    return true;
  }

  function applyTreeFilter(sidebar, keyword) {
    var normalized = (keyword || "").trim().toLowerCase();
    var links = Array.from(sidebar.querySelectorAll(".tree-post-link"));
    links.forEach(function (link) {
      var searchText = link.getAttribute("data-tree-search") || "";
      var hit = normalized === "" || searchText.indexOf(normalized) !== -1;
      var item = link.closest("li");
      if (item) {
        item.style.display = hit ? "" : "none";
      }
    });

    Array.from(sidebar.querySelectorAll(".tree-month")).forEach(function (monthNode) {
      var visiblePost = Array.from(monthNode.querySelectorAll(".tree-post-list li")).some(function (item) {
        return item.style.display !== "none";
      });
      monthNode.style.display = visiblePost ? "" : "none";
      if (visiblePost && normalized) {
        monthNode.open = true;
      }
    });

    Array.from(sidebar.querySelectorAll(".tree-year")).forEach(function (yearNode) {
      var visibleMonth = Array.from(yearNode.querySelectorAll(".tree-month")).some(function (monthNode) {
        return monthNode.style.display !== "none";
      });
      yearNode.style.display = visibleMonth ? "" : "none";
    });
  }

  function initTreeSidebars(posts) {
    var sidebars = Array.from(document.querySelectorAll(".tree-sidebar"));
    if (sidebars.length === 0) {
      return;
    }

    var grouped = groupPostsByDate(posts);
    var currentSlug = currentSlugFromPath();

    sidebars.forEach(function (sidebar) {
      var body = sidebar.querySelector("[data-tree-body]");
      var toggle = sidebar.querySelector("[data-tree-toggle]");
      if (!body || !toggle) {
        return;
      }

      body.innerHTML =
        '<div class="tree-controls">' +
        '<div class="tree-quick-actions">' +
        '<button type="button" class="tree-quick-btn" data-tree-quick="today">今天</button>' +
        '<button type="button" class="tree-quick-btn" data-tree-quick="month">本月</button>' +
        "</div>" +
        '<input class="tree-search-input" type="search" data-tree-search-input placeholder="搜索标题/标签" />' +
        "</div>" +
        '<div class="tree-list" data-tree-list></div>';

      var listContainer = body.querySelector("[data-tree-list]");
      if (!listContainer) {
        return;
      }

      renderTree(listContainer, grouped, currentSlug);

      var collapsed = localStorage.getItem(STORAGE_KEY) === "1";
      updateToggleState(sidebar, toggle, collapsed);

      toggle.addEventListener("click", function () {
        var willCollapse = !sidebar.classList.contains("is-collapsed");
        updateToggleState(sidebar, toggle, willCollapse);
        localStorage.setItem(STORAGE_KEY, willCollapse ? "1" : "0");
      });

      var searchInput = body.querySelector("[data-tree-search-input]");
      if (searchInput) {
        searchInput.addEventListener("input", function () {
          applyTreeFilter(sidebar, searchInput.value);
        });
      }

      Array.from(body.querySelectorAll("[data-tree-quick]"))
        .forEach(function (button) {
          button.addEventListener("click", function () {
            var mode = button.getAttribute("data-tree-quick") || "";
            var match = posts.find(function (post) {
              return matchesDate(post.date, mode);
            });
            if (match) {
              revealPostBySlug(sidebar, match.slug);
            }
          });
        });

      if (currentSlug) {
        revealPostBySlug(sidebar, currentSlug);
      }
    });
  }

  function initScrollTopButton() {
    Array.from(document.querySelectorAll("[data-scroll-top]")).forEach(function (button) {
      button.addEventListener("click", function () {
        window.scrollTo({ top: 0, behavior: "smooth" });
      });
    });
  }

  async function run() {
    initScrollTopButton();

    var hasTreeSidebar = document.querySelector(".tree-sidebar");
    if (!hasTreeSidebar) {
      return;
    }

    try {
      var response = await fetch("/data/posts.json");
      if (!response.ok) {
        throw new Error("加载目录失败");
      }
      var posts = await response.json();
      initTreeSidebars(Array.isArray(posts) ? posts : []);
    } catch (error) {
      Array.from(document.querySelectorAll("[data-tree-body]")).forEach(function (container) {
        container.innerHTML = "<p class=\"tree-empty\">目录加载失败</p>";
      });
      console.warn("[blog-tree] failed to load tree data", error);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      void run();
    }, { once: true });
  } else {
    void run();
  }
})();
