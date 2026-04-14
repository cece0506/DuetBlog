export {};

type ToolItem = {
  name: string;
  path: string;
  description?: string;
};

type WaveTrail = {
  points: Array<{ x: number; y: number }>;
  life: number;
  maxLife: number;
  amplitude: number;
  wavelength: number;
  phase: number;
  color: string;
};

type StarParticle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  rotation: number;
  spin: number;
  size: number;
  color: string;
  life: number;
  maxLife: number;
};

type ScrollRing = {
  x: number;
  y: number;
  radius: number;
  growth: number;
  color: string;
  life: number;
  maxLife: number;
};

const COLORS = ["#ff8ea1", "#ffcf6e", "#66e3d3", "#6e93ff", "#ff91de"];

function activateNavState() {
  const current = window.location.pathname || "/";
  document.querySelectorAll<HTMLAnchorElement>(".nav-links a[data-nav-link]").forEach((anchor) => {
    const href = anchor.getAttribute("href") || "";
    const normalizedHref = href === "/" ? "/" : href.replace(/\/$/, "");
    const normalizedCurrent = current === "/" ? "/" : current.replace(/\/$/, "");

    if (normalizedCurrent === normalizedHref) {
      anchor.classList.add("is-active");
    }
  });
}

function initInfiniteDuplication() {
  document.querySelectorAll<HTMLElement>("[data-duplicate-track]").forEach((track) => {
    if (track.dataset.duplicated === "true") {
      return;
    }
    track.innerHTML += track.innerHTML;
    track.dataset.duplicated = "true";
  });
}

function initToolsDropdownInteraction() {
  document.querySelectorAll<HTMLElement>(".tools-nav-group").forEach((group) => {
    let closeTimer = 0;

    const open = () => {
      if (closeTimer) {
        window.clearTimeout(closeTimer);
      }
      group.classList.add("is-open");
    };

    const close = () => {
      closeTimer = window.setTimeout(() => {
        group.classList.remove("is-open");
      }, 220);
    };

    group.addEventListener("pointerenter", open);
    group.addEventListener("pointerleave", close);
    group.addEventListener("focusin", open);
    group.addEventListener("focusout", close);
  });
}

async function loadToolsIntoMenus() {
  const menus = Array.from(document.querySelectorAll<HTMLElement>("[data-tools-menu]"));
  if (menus.length === 0) {
    return;
  }

  try {
    const response = await fetch("/data/tools.json");
    if (!response.ok) {
      throw new Error("Failed to load tools menu");
    }

    const tools = (await response.json()) as ToolItem[];
    for (const menu of menus) {
      const items = tools
        .map(
          (tool) => `
            <a class="tools-nav-item" href="/${tool.path}">
              <strong>${tool.name}</strong>
              <span>${tool.description || ""}</span>
            </a>
          `,
        )
        .join("");

      menu.innerHTML = `${items}<a class="tools-nav-item tools-nav-all" href="/pages/tools.html"><strong>All Tools</strong><span>进入工具页查看完整列表</span></a>`;
    }
  } catch {
    for (const menu of menus) {
      menu.innerHTML = '<a class="tools-nav-item tools-nav-all" href="/pages/tools.html"><strong>Tools</strong><span>打开工具页</span></a>';
    }
  }
}

function initPencilCursor() {
  if (window.matchMedia("(pointer: coarse)").matches) {
    return;
  }

  const cursor = document.createElement("div");
  cursor.className = "pencil-cursor";
  cursor.innerHTML = '<span class="pencil-tip"></span><span class="pencil-eraser"></span>';

  const canvas = document.createElement("canvas");
  canvas.className = "cursor-effects";
  document.body.append(canvas, cursor);
  document.body.classList.add("custom-cursor-active");

  const context = canvas.getContext("2d", { alpha: true });
  if (!context) {
    return;
  }

  let pointerX = window.innerWidth / 2;
  let pointerY = window.innerHeight / 2;
  let lastWaveStamp = 0;
  let frame = 0;
  let running = false;
  let rafId = 0;

  const waves: WaveTrail[] = [];
  const stars: StarParticle[] = [];
  const rings: ScrollRing[] = [];
  const pointerHistory: Array<{ x: number; y: number }> = [];

  const resizeCanvas = () => {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  };

  const startAnimation = () => {
    if (running) {
      return;
    }
    running = true;
    rafId = requestAnimationFrame(animate);
  };

  const stopAnimation = () => {
    running = false;
    cancelAnimationFrame(rafId);
    context.clearRect(0, 0, canvas.width, canvas.height);
  };

  const createWave = (intensity = 1) => {
    const points = pointerHistory.slice(-18);
    if (points.length < 4) {
      return;
    }
    waves.push({
      points,
      life: 0,
      maxLife: 84,
      amplitude: 3 + intensity * 1.6,
      wavelength: 5 + intensity * 2,
      phase: Math.random() * Math.PI * 2,
      color: COLORS[(waves.length + intensity) % COLORS.length],
    });
    startAnimation();
  };

  const createScrollRings = (delta: number) => {
    const count = Math.min(3, Math.max(1, Math.round(Math.abs(delta) / 140)));
    for (let index = 0; index < count; index += 1) {
      rings.push({
        x: pointerX,
        y: pointerY,
        radius: 10 + index * 4,
        growth: 1.4 + index * 0.4,
        color: COLORS[(index + Math.floor(Math.random() * 5)) % COLORS.length],
        life: 0,
        maxLife: 28 + index * 8,
      });
    }
    startAnimation();
  };

  const createStars = () => {
    for (let index = 0; index < 10; index += 1) {
      const angle = (Math.PI * 2 * index) / 10 + Math.random() * 0.3;
      const speed = 2.4 + Math.random() * 2.4;
      stars.push({
        x: pointerX,
        y: pointerY,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 0.8,
        rotation: Math.random() * Math.PI,
        spin: (Math.random() - 0.5) * 0.16,
        size: 3.5 + Math.random() * 5,
        color: COLORS[index % COLORS.length],
        life: 0,
        maxLife: 34 + Math.floor(Math.random() * 8),
      });
    }
    startAnimation();
  };

  const drawStar = (x: number, y: number, radius: number, rotation: number, color: string, alpha: number) => {
    context.save();
    context.translate(x, y);
    context.rotate(rotation);
    context.beginPath();
    for (let point = 0; point < 5; point += 1) {
      const outer = (Math.PI * 2 * point) / 5 - Math.PI / 2;
      const inner = outer + Math.PI / 5;
      const outerX = Math.cos(outer) * radius;
      const outerY = Math.sin(outer) * radius;
      const innerX = Math.cos(inner) * radius * 0.48;
      const innerY = Math.sin(inner) * radius * 0.48;
      if (point === 0) {
        context.moveTo(outerX, outerY);
      } else {
        context.lineTo(outerX, outerY);
      }
      context.lineTo(innerX, innerY);
    }
    context.closePath();
    context.fillStyle = `${color}${Math.round(alpha * 255).toString(16).padStart(2, "0")}`;
    context.shadowBlur = 12;
    context.shadowColor = color;
    context.fill();
    context.restore();
  };

  const drawWave = (wave: WaveTrail, progress: number, alpha: number) => {
    context.beginPath();
    const wobble = wave.amplitude * alpha;
    for (let step = 0; step < wave.points.length; step += 1) {
      const point = wave.points[step];
      const next = wave.points[Math.min(step + 1, wave.points.length - 1)];
      const vx = next.x - point.x;
      const vy = next.y - point.y;
      const length = Math.max(1, Math.hypot(vx, vy));
      const nx = -vy / length;
      const ny = vx / length;
      const offset = Math.sin(step / wave.wavelength + wave.phase + progress * 6) * wobble;
      const x = point.x + nx * offset;
      const y = point.y + ny * offset;
      if (step === 0) {
        context.moveTo(x, y);
      } else {
        context.lineTo(x, y);
      }
    }
    context.strokeStyle = `${wave.color}${Math.round(alpha * 175).toString(16).padStart(2, "0")}`;
    context.lineWidth = 1.9 - progress * 0.7;
    context.lineCap = "round";
    context.shadowBlur = 8;
    context.shadowColor = wave.color;
    context.stroke();
  };

  const animate = () => {
    frame += 1;
    context.clearRect(0, 0, canvas.width, canvas.height);

    for (let index = waves.length - 1; index >= 0; index -= 1) {
      const wave = waves[index];
      wave.life += 1;
      if (wave.life >= wave.maxLife) {
        waves.splice(index, 1);
        continue;
      }
      const progress = wave.life / wave.maxLife;
      const alpha = 1 - progress;
      drawWave(wave, progress, alpha);
    }

    for (let index = rings.length - 1; index >= 0; index -= 1) {
      const ring = rings[index];
      ring.life += 1;
      if (ring.life >= ring.maxLife) {
        rings.splice(index, 1);
        continue;
      }
      const alpha = 1 - ring.life / ring.maxLife;
      ring.radius += ring.growth;
      context.beginPath();
      context.arc(ring.x, ring.y, ring.radius, 0, Math.PI * 2);
      context.strokeStyle = `${ring.color}${Math.round(alpha * 180).toString(16).padStart(2, "0")}`;
      context.lineWidth = 1.8;
      context.stroke();
    }

    for (let index = stars.length - 1; index >= 0; index -= 1) {
      const star = stars[index];
      star.life += 1;
      if (star.life >= star.maxLife) {
        stars.splice(index, 1);
        continue;
      }

      const alpha = 1 - star.life / star.maxLife;
      star.x += star.vx;
      star.y += star.vy;
      star.vy += 0.03;
      star.rotation += star.spin;
      drawStar(star.x, star.y, star.size * alpha, star.rotation, star.color, alpha);
    }

    if (waves.length === 0 && stars.length === 0 && rings.length === 0) {
      stopAnimation();
      return;
    }

    rafId = requestAnimationFrame(animate);
  };

  const setCursorPosition = (clientX: number, clientY: number) => {
    pointerX = clientX;
    pointerY = clientY;
    pointerHistory.push({ x: pointerX, y: pointerY });
    if (pointerHistory.length > 28) {
      pointerHistory.shift();
    }
    cursor.style.left = `${pointerX}px`;
    cursor.style.top = `${pointerY}px`;
    cursor.classList.add("is-visible");
  };

  resizeCanvas();
  setCursorPosition(pointerX, pointerY);

  window.addEventListener("resize", resizeCanvas, { passive: true });
  document.addEventListener("pointermove", (event) => {
    setCursorPosition(event.clientX, event.clientY);
    const now = performance.now();
    if (now - lastWaveStamp > 64) {
      createWave(1 + (frame % 3));
      lastWaveStamp = now;
    }
  }, { passive: true });
  document.addEventListener("pointerenter", (event) => setCursorPosition(event.clientX, event.clientY), { passive: true });
  document.addEventListener("pointerdown", () => createStars());
  document.addEventListener("wheel", (event) => {
    createScrollRings(event.deltaY);
  }, { passive: true });

  document.querySelectorAll<HTMLElement>("a, button, .post-card, .gallery-bubble, .tool-card, .glance-card, .calendar-post-link").forEach((element) => {
    element.addEventListener("mouseenter", () => {
      cursor.style.transform = "translate(-50%, -50%) rotate(-12deg) scale(1.14)";
    });
    element.addEventListener("mouseleave", () => {
      cursor.style.transform = "translate(-50%, -50%) rotate(-24deg) scale(1)";
    });
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      stopAnimation();
      waves.splice(0, waves.length);
      stars.splice(0, stars.length);
      rings.splice(0, rings.length);
    }
  });
}

function init() {
  activateNavState();
  initInfiniteDuplication();
  initToolsDropdownInteraction();
  void loadToolsIntoMenus();
  initPencilCursor();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init, { once: true });
} else {
  init();
}
