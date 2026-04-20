const CM_TO_INCH = 1 / 2.54;
const CSS_PIXELS_PER_CM = 37.7952755906;

const PRESETS = {
  A5: { width: 14.4, height: 21.0 },
  A5s: { width: 11.0, height: 21.0 },
  "A6 Personal": { width: 9.5, height: 17.0 },
  "A6 fc": { width: 10.8, height: 17.0 },
  "A6 pw": { width: 12.0, height: 17.0 },
  "A6 奇葩": { width: 10.5, height: 14.8 },
  A6方方子: { width: 15.0, height: 17.0 },
  A7: { width: 8.0, height: 12.0 },
  A7大纸: { width: 8.5, height: 12.7 },
  M5: { width: 6.2, height: 10.5 },
  A8: { width: 6.7, height: 10.5 },
  A9: { width: 6.0, height: 7.8 },
};

const PATTERN_LABELS = {
  dot: "波点",
  heart: "爱心",
  star: "五角星",
};

const PATTERN_LAYOUT_LABELS = {
  dot: "梅花桩式波点网格",
  heart: "梅花桩式爱心网格",
  star: "梅花桩式五角星网格",
};

const PATTERN_DEFAULT_SPACING = {
  dot: 5,
  heart: 6,
  star: 6.5,
};

const DEFAULT_OUTLINE_WIDTH_MM = 0.35;
const MAX_LAYER_COLORS = 8;

const form = {
  preset: document.getElementById("paper-preset"),
  paperWidth: document.getElementById("paper-width"),
  paperHeight: document.getElementById("paper-height"),
  marginMm: document.getElementById("page-margin-mm"),
  bleedMm: document.getElementById("bleed-mm"),
  overlapMode: document.getElementById("overlap-mode"),
  backgroundColor: document.getElementById("background-color"),
  randomBgColor: document.getElementById("random-bg-color"),
  layerControlList: document.getElementById("layer-control-list"),
  addLayer: document.getElementById("add-layer"),
  exportSettings: document.getElementById("export-settings"),
  importSettings: document.getElementById("import-settings"),
  importSettingsFile: document.getElementById("import-settings-file"),
  dpi: document.getElementById("paper-dpi"),
  zoom: document.getElementById("preview-zoom"),
  zoomLabel: document.getElementById("zoom-label"),
  pixelSize: document.getElementById("pixel-size"),
  patternLayout: document.getElementById("pattern-layout"),
  download: document.getElementById("download-pattern"),
  zoomIn: document.getElementById("zoom-in"),
  zoomOut: document.getElementById("zoom-out"),
  previewScroll: document.getElementById("preview-scroll"),
  previewLayerSelector: document.getElementById("preview-layer-selector"),
  moveLayerUp: document.getElementById("move-layer-up"),
  moveLayerDown: document.getElementById("move-layer-down"),
  rulerOverlay: document.getElementById("dot-ruler-overlay"),
  showRuler: document.getElementById("show-ruler"),
  rulerColor: document.getElementById("ruler-color"),
};

const canvas = document.getElementById("dot-pattern-canvas");
const context = canvas?.getContext("2d", { alpha: false }) || null;
const rulerContext = form.rulerOverlay?.getContext("2d", { alpha: true }) || null;

let renderTimer = 0;
let manualZoom = false;

const dragState = {
  dragging: false,
  pointerId: null,
  startClientX: 0,
  startClientY: 0,
  startOffsetCmX: 0,
  startOffsetCmY: 0,
};

const state = {
  nextLayerId: 2,
  activeLayerId: 1,
  overlapMode: "cover",
  layers: [createLayer(1)],
};

const OVERLAP_MODE_COMPOSITE = {
  cover: "source-over",
  multiply: "multiply",
  screen: "screen",
  overlay: "overlay",
  "soft-light": "soft-light",
};

function createLayer(id, base = {}) {
  const patternType = base.patternType || "dot";
  const colors = Array.isArray(base.colors) && base.colors.length > 0 ? [...base.colors] : ["#f3c0d4"];
  return {
    id,
    name: base.name || `图层 ${id}`,
    patternType,
    renderMode: base.renderMode || "fill",
    outlineWidthMm: clamp(Number(base.outlineWidthMm) || DEFAULT_OUTLINE_WIDTH_MM, 0.1, 8),
    randomRotate: Boolean(base.randomRotate),
    radiusCm: clamp(Number(base.radiusCm) || 1, 0.03, 10),
    spacingCm: clamp(Number(base.spacingCm) || PATTERN_DEFAULT_SPACING[patternType], 0.2, 10),
    colors,
    offsetCmX: Number(base.offsetCmX) || 0,
    offsetCmY: Number(base.offsetCmY) || 0,
    isCollapsed: Boolean(base.isCollapsed),
  };
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function round(value, digits = 2) {
  return Number(value.toFixed(digits));
}

function randomColor() {
  const hue = Math.floor(Math.random() * 360);
  const saturation = 65 + Math.floor(Math.random() * 20);
  const lightness = 55 + Math.floor(Math.random() * 18);
  const rgb = hslToRgb(hue / 360, saturation / 100, lightness / 100);
  return `#${rgb.map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}

function hslToRgb(h, s, l) {
  if (s === 0) {
    const gray = Math.round(l * 255);
    return [gray, gray, gray];
  }

  const hue2rgb = (p, q, t) => {
    let current = t;
    if (current < 0) {
      current += 1;
    }
    if (current > 1) {
      current -= 1;
    }
    if (current < 1 / 6) {
      return p + (q - p) * 6 * current;
    }
    if (current < 1 / 2) {
      return q;
    }
    if (current < 2 / 3) {
      return p + (q - p) * (2 / 3 - current) * 6;
    }
    return p;
  };

  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;

  return [
    Math.round(hue2rgb(p, q, h + 1 / 3) * 255),
    Math.round(hue2rgb(p, q, h) * 255),
    Math.round(hue2rgb(p, q, h - 1 / 3) * 255),
  ];
}

function pickTextColor(hex) {
  const normalized = hex.replace("#", "");
  if (normalized.length !== 6) {
    return "#1c1c1e";
  }
  const red = parseInt(normalized.slice(0, 2), 16);
  const green = parseInt(normalized.slice(2, 4), 16);
  const blue = parseInt(normalized.slice(4, 6), 16);
  const luminance = (red * 299 + green * 587 + blue * 114) / 1000;
  return luminance > 160 ? "#1c1c1e" : "#ffffff";
}

function buildGradient(colors) {
  if (!Array.isArray(colors) || colors.length === 0) {
    return "#f3c0d4";
  }
  if (colors.length === 1) {
    return colors[0];
  }
  const step = 100 / Math.max(colors.length - 1, 1);
  const stops = colors.map((color, index) => `${color} ${Math.round(index * step)}%`).join(", ");
  return `linear-gradient(135deg, ${stops})`;
}

function activateNavState() {
  const current = window.location.pathname || "/";
  document.querySelectorAll(".nav-links a[data-nav-link], .side-nav a[data-nav-link]").forEach((anchor) => {
    const href = anchor.getAttribute("href") || "";
    const normalizedHref = href === "/" ? "/" : href.replace(/\/$/, "");
    const normalizedCurrent = current === "/" ? "/" : current.replace(/\/$/, "");
    if (normalizedCurrent === normalizedHref) {
      anchor.classList.add("is-active");
    }
  });
}

function initScrollTop() {
  const button = document.querySelector("[data-scroll-top]");
  if (!button) {
    return;
  }
  button.addEventListener("click", () => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
}

function initToolsDropdownInteraction() {
  document.querySelectorAll(".tools-nav-group").forEach((group) => {
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
  const menus = Array.from(document.querySelectorAll("[data-tools-menu]"));
  if (menus.length === 0) {
    return;
  }
  try {
    const response = await fetch("/data/tools.json");
    if (!response.ok) {
      throw new Error("Failed to load tools menu");
    }
    const tools = await response.json();
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

function updatePresetFromDimensions() {
  const width = round(Number(form.paperWidth.value), 1);
  const height = round(Number(form.paperHeight.value), 1);
  const matchedPreset = Object.entries(PRESETS).find(([, size]) => size.width === width && size.height === height);
  form.preset.value = matchedPreset ? matchedPreset[0] : "custom";
}

function applyPreset(presetName) {
  const preset = PRESETS[presetName];
  if (!preset) {
    return;
  }
  form.paperWidth.value = preset.width.toString();
  form.paperHeight.value = preset.height.toString();
}

function getActiveLayer() {
  return state.layers.find((layer) => layer.id === state.activeLayerId) || state.layers[0];
}

function getGlobalConfig() {
  const widthCm = clamp(Number(form.paperWidth.value) || 14.4, 3, 60);
  const heightCm = clamp(Number(form.paperHeight.value) || 21, 3, 60);
  const marginMm = clamp(Number(form.marginMm.value) || 0, 0, 50);
  const bleedMm = clamp(Number(form.bleedMm.value) || 3, 0, 20);
  const dpi = clamp(Number(form.dpi.value) || 300, 96, 300);
  const zoom = clamp(Number(form.zoom.value) || 1, 0.35, 2.5);
  const showRuler = Boolean(form.showRuler.checked);
  const rulerColor = form.rulerColor.value || "#7a3657";

  form.paperWidth.value = round(widthCm, 1).toString();
  form.paperHeight.value = round(heightCm, 1).toString();
  form.marginMm.value = round(marginMm, 1).toString();
  form.bleedMm.value = round(bleedMm, 1).toString();
  form.zoom.value = round(zoom).toString();

  return {
    widthCm,
    heightCm,
    marginMm,
    bleedMm,
    dpi,
    zoom,
    showRuler,
    rulerColor,
    backgroundColor: form.backgroundColor.value || "#ec94b6",
  };
}

function serializeSettings() {
  const config = getGlobalConfig();
  return {
    version: 1,
    preset: form.preset.value || "custom",
    overlapMode: state.overlapMode,
    paper: {
      widthCm: config.widthCm,
      heightCm: config.heightCm,
      marginMm: config.marginMm,
      bleedMm: config.bleedMm,
      dpi: config.dpi,
      backgroundColor: config.backgroundColor,
    },
    preview: {
      zoom: config.zoom,
      showRuler: config.showRuler,
      rulerColor: config.rulerColor,
      activeLayerId: state.activeLayerId,
    },
    layers: state.layers.map((layer) => ({
      id: layer.id,
      name: layer.name,
      patternType: layer.patternType,
      renderMode: layer.renderMode,
      outlineWidthMm: layer.outlineWidthMm,
      randomRotate: layer.randomRotate,
      radiusCm: layer.radiusCm,
      spacingCm: layer.spacingCm,
      colors: [...layer.colors],
      offsetCmX: layer.offsetCmX,
      offsetCmY: layer.offsetCmY,
      isCollapsed: layer.isCollapsed,
    })),
  };
}

function applyImportedSettings(data) {
  if (!data || typeof data !== "object") {
    throw new Error("设置文件格式无效");
  }

  const paper = typeof data.paper === "object" && data.paper ? data.paper : {};
  const preview = typeof data.preview === "object" && data.preview ? data.preview : {};
  const rawLayers = Array.isArray(data.layers) && data.layers.length > 0 ? data.layers : [createLayer(1)];

  form.preset.value = typeof data.preset === "string" ? data.preset : "custom";
  form.paperWidth.value = round(clamp(Number(paper.widthCm) || 14.4, 3, 60), 1).toString();
  form.paperHeight.value = round(clamp(Number(paper.heightCm) || 21, 3, 60), 1).toString();
  form.marginMm.value = round(clamp(Number(paper.marginMm) || 0, 0, 50), 1).toString();
  form.bleedMm.value = round(clamp(Number(paper.bleedMm) || 3, 0, 20), 1).toString();
  form.dpi.value = String(clamp(Number(paper.dpi) || 300, 96, 300));
  form.backgroundColor.value = typeof paper.backgroundColor === "string" ? paper.backgroundColor : "#ec94b6";
  form.zoom.value = round(clamp(Number(preview.zoom) || 1, 0.35, 2.5), 2).toString();
  form.showRuler.checked = Boolean(preview.showRuler);
  form.rulerColor.value = typeof preview.rulerColor === "string" ? preview.rulerColor : "#7a3657";

  const importedOverlapMode = data.overlapMode === "blend" ? "multiply" : data.overlapMode;
  state.overlapMode =
    typeof importedOverlapMode === "string" && OVERLAP_MODE_COMPOSITE[importedOverlapMode] ? importedOverlapMode : "cover";
  form.overlapMode.value = state.overlapMode;

  state.layers = rawLayers.map((layer, index) => createLayer(Number(layer.id) || index + 1, layer));
  state.nextLayerId = Math.max(...state.layers.map((layer) => layer.id), 0) + 1;
  state.activeLayerId = state.layers.some((layer) => layer.id === Number(preview.activeLayerId))
    ? Number(preview.activeLayerId)
    : state.layers[0].id;

  updatePresetFromDimensions();
  syncLayerUi();
  manualZoom = false;
  renderPattern();
}

function exportSettings() {
  const payload = serializeSettings();
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `pattern-settings-${Date.now()}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

async function importSettings(file) {
  const text = await file.text();
  const data = JSON.parse(text);
  applyImportedSettings(data);
}

function renderLayerControls() {
  const cards = state.layers
    .map((layer) => {
      const colorItems = layer.colors
        .map(
          (color, index) => `
            <div class="dot-color-item">
              <input type="color" class="pattern-color-input" data-layer-id="${layer.id}" data-layer-color-index="${index}" value="${color}" />
              <button type="button" class="dot-icon-btn dot-color-action" data-layer-action="random-color" data-layer-id="${layer.id}" data-layer-color-index="${index}" title="随机该颜色" aria-label="随机该颜色">↻</button>
              <button type="button" class="dot-icon-btn dot-color-action" data-layer-action="remove-color" data-layer-id="${layer.id}" data-layer-color-index="${index}" title="删除该颜色" aria-label="删除该颜色" ${layer.colors.length <= 1 ? "disabled" : ""}>×</button>
            </div>
          `,
        )
        .join("");

      return `
        <article class="dot-layer-card ${layer.isCollapsed ? "is-collapsed" : ""}" data-layer-id="${layer.id}">
          <header class="dot-layer-card-head">
            <label class="dot-check-field">
              <input type="radio" name="active-layer-control" value="${layer.id}" ${layer.id === state.activeLayerId ? "checked" : ""} />
              <span>${layer.name}</span>
            </label>
            <div class="dot-layer-head-actions">
              <button type="button" class="dot-icon-btn" data-layer-action="duplicate-layer" data-layer-id="${layer.id}" title="复制该图层" aria-label="复制该图层">⧉</button>
              <button type="button" class="dot-icon-btn" data-layer-action="remove-layer" data-layer-id="${layer.id}" title="删除该图层" aria-label="删除该图层" ${state.layers.length <= 1 ? "disabled" : ""}>－</button>
              <button type="button" class="dot-icon-btn" data-layer-action="toggle-layer" data-layer-id="${layer.id}" title="${layer.isCollapsed ? "展开图层" : "收起图层"}" aria-label="${layer.isCollapsed ? "展开图层" : "收起图层"}">${layer.isCollapsed ? "▸" : "▾"}</button>
            </div>
          </header>
          <div class="dot-layer-card-body">
            <label class="dot-field">
              <span>图案类型</span>
              <select data-layer-field="patternType" data-layer-id="${layer.id}">
                <option value="dot" ${layer.patternType === "dot" ? "selected" : ""}>波点</option>
                <option value="heart" ${layer.patternType === "heart" ? "selected" : ""}>爱心</option>
                <option value="star" ${layer.patternType === "star" ? "selected" : ""}>五角星</option>
              </select>
            </label>
            <div class="dot-field-row dot-field-row-2">
              <label class="dot-field">
                <span>图案样式</span>
                <select data-layer-field="renderMode" data-layer-id="${layer.id}">
                  <option value="fill" ${layer.renderMode === "fill" ? "selected" : ""}>实心填充</option>
                  <option value="outline" ${layer.renderMode === "outline" ? "selected" : ""}>空心描边</option>
                </select>
              </label>
              ${
                layer.renderMode === "outline"
                  ? `<label class="dot-field">
                <span>描边宽度 (MM)</span>
                <input type="number" min="0.1" max="8" step="0.1" data-layer-field="outlineWidthMm" data-layer-id="${layer.id}" value="${layer.outlineWidthMm}" />
              </label>`
                  : ""
              }
            </div>
            <label class="dot-field">
              <div class="dot-field-head">
                <span>图案颜色</span>
                <button type="button" class="dot-icon-btn" data-layer-action="add-color" data-layer-id="${layer.id}" title="添加颜色" aria-label="添加颜色">＋</button>
              </div>
              <div class="dot-color-list dot-color-list-stacked">${colorItems}</div>
            </label>
            <div class="dot-field-row dot-field-row-2 dot-slider-row">
              <label class="dot-field">
                <span>图案半径 (CM)</span>
                <input type="range" min="0.03" max="10" step="0.1" data-layer-field="radiusRange" data-layer-id="${layer.id}" value="${layer.radiusCm}" />
                <input type="number" min="0.03" max="10" step="0.01" data-layer-field="radiusCm" data-layer-id="${layer.id}" value="${layer.radiusCm}" />
              </label>
              <label class="dot-field">
                <span>图案间距 (CM)</span>
                <input type="range" min="0.2" max="10" step="0.1" data-layer-field="spacingRange" data-layer-id="${layer.id}" value="${layer.spacingCm}" />
                <input type="number" min="0.2" max="10" step="0.1" data-layer-field="spacingCm" data-layer-id="${layer.id}" value="${layer.spacingCm}" />
              </label>
            </div>
            <label class="dot-check-field">
              <input type="checkbox" data-layer-field="randomRotate" data-layer-id="${layer.id}" ${layer.randomRotate ? "checked" : ""} />
              <span>随机旋转（波点除外）</span>
            </label>
          </div>
        </article>
      `;
    })
    .join("");

  form.layerControlList.innerHTML = cards;
}

function renderPreviewLayerSelector() {
  form.previewLayerSelector.innerHTML = state.layers
    .map((layer) => {
      const gradient = buildGradient(layer.colors);
      const textColor = pickTextColor(layer.colors[0]);
      return `
        <label class="dot-layer-chip ${layer.id === state.activeLayerId ? "is-active" : ""}" style="background: ${gradient}; color: ${textColor};" title="拖动时操作 ${layer.name}">
          <input type="radio" name="active-layer-preview" value="${layer.id}" ${layer.id === state.activeLayerId ? "checked" : ""} />
          <span class="dot-layer-chip-check" aria-hidden="true">√</span>
          <span>${layer.name}</span>
        </label>
      `;
    })
    .join("");
}

function syncLayerUi() {
  renderLayerControls();
  renderPreviewLayerSelector();

  const onlyOneLayer = state.layers.length <= 1;
  const activeIndex = state.layers.findIndex((layer) => layer.id === state.activeLayerId);

  if (form.moveLayerUp) {
    form.moveLayerUp.disabled = onlyOneLayer || activeIndex <= 0;
  }
  if (form.moveLayerDown) {
    form.moveLayerDown.disabled = onlyOneLayer || activeIndex < 0 || activeIndex >= state.layers.length - 1;
  }
}

function updatePreviewScale(config) {
  const cssWidth = config.widthCm * CSS_PIXELS_PER_CM * config.zoom;
  const cssHeight = config.heightCm * CSS_PIXELS_PER_CM * config.zoom;
  canvas.style.width = `${cssWidth}px`;
  canvas.style.height = `${cssHeight}px`;
  if (form.rulerOverlay) {
    form.rulerOverlay.style.width = `${cssWidth}px`;
    form.rulerOverlay.style.height = `${cssHeight}px`;
  }
  form.zoomLabel.textContent = `${Math.round(config.zoom * 100)}%`;
}

function autoFitZoom(config) {
  if (!form.previewScroll || manualZoom) {
    return config;
  }
  const availableWidth = Math.max(240, form.previewScroll.clientWidth - 72);
  const availableHeight = Math.max(240, window.innerHeight - 320);
  const baseWidth = config.widthCm * CSS_PIXELS_PER_CM;
  const baseHeight = config.heightCm * CSS_PIXELS_PER_CM;
  const fitZoom = clamp(Math.min(availableWidth / baseWidth, availableHeight / baseHeight, 1), 0.35, 2.5);
  form.zoom.value = round(fitZoom).toString();
  return { ...config, zoom: fitZoom };
}

function getPatternRotation(rowIndex, columnIndex, layer) {
  if (!layer.randomRotate || layer.patternType === "dot") {
    return 0;
  }
  const seed = Math.sin((rowIndex + layer.id * 0.73) * 12.9898 + (columnIndex + layer.id * 0.31) * 78.233) * 43758.5453;
  return (seed - Math.floor(seed)) * Math.PI * 2;
}

function paintCurrentPath(layer, pixelsPerCm) {
  if (layer.renderMode === "outline") {
    context.lineWidth = Math.max(0.5, (layer.outlineWidthMm / 10) * pixelsPerCm);
    context.stroke();
    return;
  }
  context.fill();
}

function drawDotShape(radiusPx) {
  context.beginPath();
  context.arc(0, 0, radiusPx, 0, Math.PI * 2);
}

function drawHeartShape(radiusPx) {
  const size = radiusPx * 1.75;
  const topY = -size * 0.52;
  context.beginPath();
  context.moveTo(0, size * 0.52);
  context.bezierCurveTo(-size * 1.15, size * 0.08, -size * 0.92, topY - size * 0.35, 0, topY);
  context.bezierCurveTo(size * 0.92, topY - size * 0.35, size * 1.15, size * 0.08, 0, size * 0.52);
  context.closePath();
}

function drawStarShape(radiusPx) {
  const outerRadius = radiusPx * 1.1;
  const innerRadius = outerRadius * 0.45;
  const startAngle = -Math.PI / 2;
  context.beginPath();
  for (let index = 0; index < 10; index += 1) {
    const angle = startAngle + (Math.PI / 5) * index;
    const radius = index % 2 === 0 ? outerRadius : innerRadius;
    const pointX = Math.cos(angle) * radius;
    const pointY = Math.sin(angle) * radius;
    if (index === 0) {
      context.moveTo(pointX, pointY);
      continue;
    }
    context.lineTo(pointX, pointY);
  }
  context.closePath();
}

function drawPatternShape(layer, x, y, radiusPx, rowIndex, columnIndex, pixelsPerCm) {
  context.save();
  context.translate(x, y);
  const rotation = getPatternRotation(rowIndex, columnIndex, layer);
  if (rotation !== 0) {
    context.rotate(rotation);
  }
  if (layer.patternType === "heart") {
    drawHeartShape(radiusPx);
    paintCurrentPath(layer, pixelsPerCm);
    context.restore();
    return;
  }
  if (layer.patternType === "star") {
    drawStarShape(radiusPx);
    paintCurrentPath(layer, pixelsPerCm);
    context.restore();
    return;
  }
  drawDotShape(radiusPx);
  paintCurrentPath(layer, pixelsPerCm);
  context.restore();
}

function renderRulerOverlay(config, widthPx, heightPx, pixelsPerCm, marginPx, bleedPx) {
  if (!form.rulerOverlay || !rulerContext) {
    return;
  }
  form.rulerOverlay.width = widthPx;
  form.rulerOverlay.height = heightPx;
  rulerContext.clearRect(0, 0, widthPx, heightPx);

  const drawVerticalLine = (x) => {
    rulerContext.beginPath();
    rulerContext.moveTo(x, 0);
    rulerContext.lineTo(x, heightPx);
    rulerContext.stroke();
  };
  const drawHorizontalLine = (y) => {
    rulerContext.beginPath();
    rulerContext.moveTo(0, y);
    rulerContext.lineTo(widthPx, y);
    rulerContext.stroke();
  };

  rulerContext.save();
  rulerContext.strokeStyle = config.rulerColor;
  rulerContext.lineWidth = 1;

  if (config.showRuler) {
    rulerContext.setLineDash([Math.max(4, pixelsPerCm * 0.22), Math.max(3, pixelsPerCm * 0.14)]);
    const columns = Math.floor(widthPx / pixelsPerCm);
    const rows = Math.floor(heightPx / pixelsPerCm);
    for (let index = 0; index <= columns; index += 1) {
      const x = Math.min(widthPx - 0.5, Math.round(index * pixelsPerCm) + 0.5);
      drawVerticalLine(x);
    }
    for (let index = 0; index <= rows; index += 1) {
      const y = Math.min(heightPx - 0.5, Math.round(index * pixelsPerCm) + 0.5);
      drawHorizontalLine(y);
    }
    drawVerticalLine(0.5);
    drawVerticalLine(widthPx - 0.5);
    drawHorizontalLine(0.5);
    drawHorizontalLine(heightPx - 0.5);
  }

  rulerContext.setLineDash([10, 8]);
  if (bleedPx > 0 && widthPx > bleedPx * 2 && heightPx > bleedPx * 2) {
    rulerContext.globalAlpha = 0.85;
    rulerContext.strokeRect(bleedPx + 0.5, bleedPx + 0.5, widthPx - bleedPx * 2 - 1, heightPx - bleedPx * 2 - 1);
  }

  rulerContext.setLineDash([]);
  if (marginPx > 0 && widthPx > marginPx * 2 && heightPx > marginPx * 2) {
    rulerContext.globalAlpha = 1;
    rulerContext.lineWidth = 1.5;
    rulerContext.strokeRect(marginPx + 0.5, marginPx + 0.5, widthPx - marginPx * 2 - 1, heightPx - marginPx * 2 - 1);
  }

  rulerContext.restore();
}

function renderPattern() {
  if (!context) {
    return;
  }

  const config = autoFitZoom(getGlobalConfig());
  const widthPx = Math.max(1, Math.round(config.widthCm * CM_TO_INCH * config.dpi));
  const heightPx = Math.max(1, Math.round(config.heightCm * CM_TO_INCH * config.dpi));
  const pixelsPerCm = config.dpi * CM_TO_INCH;
  const marginPx = (config.marginMm / 10) * pixelsPerCm;
  const bleedPx = (config.bleedMm / 10) * pixelsPerCm;
  const drawLeft = marginPx;
  const drawTop = marginPx;
  const drawRight = widthPx - marginPx;
  const drawBottom = heightPx - marginPx;

  canvas.width = widthPx;
  canvas.height = heightPx;

  context.save();
  context.fillStyle = config.backgroundColor;
  context.fillRect(0, 0, widthPx, heightPx);

  if (drawRight > drawLeft && drawBottom > drawTop) {
    context.beginPath();
    context.rect(drawLeft, drawTop, drawRight - drawLeft, drawBottom - drawTop);
    context.clip();

    state.layers.forEach((layer, layerIndex) => {
      const radiusPx = Math.max(1, layer.radiusCm * pixelsPerCm);
      const spacingPx = Math.max(radiusPx * 2, layer.spacingCm * pixelsPerCm);
      const rowStep = spacingPx * Math.sqrt(3) * 0.5;
      const centerX = (drawLeft + drawRight) / 2 + layer.offsetCmX * pixelsPerCm;
      const centerY = (drawTop + drawBottom) / 2 + layer.offsetCmY * pixelsPerCm;
      const rowCount = Math.ceil((drawBottom - drawTop) / rowStep) + 4;
      const columnCount = Math.ceil((drawRight - drawLeft) / spacingPx) + 4;

      const blendMode = OVERLAP_MODE_COMPOSITE[state.overlapMode] || "source-over";
      context.globalCompositeOperation = layerIndex > 0 ? blendMode : "source-over";
      context.lineJoin = "round";
      context.lineCap = "round";
      context.imageSmoothingEnabled = false;

      for (let rowIndex = -rowCount; rowIndex <= rowCount; rowIndex += 1) {
        const y = centerY + rowIndex * rowStep;
        if (y < drawTop - radiusPx || y > drawBottom + radiusPx) {
          continue;
        }
        const staggerOffset = Math.abs(rowIndex) % 2 === 0 ? 0 : spacingPx / 2;
        for (let columnIndex = -columnCount; columnIndex <= columnCount; columnIndex += 1) {
          const x = centerX + staggerOffset + columnIndex * spacingPx;
          if (x < drawLeft - radiusPx || x > drawRight + radiusPx) {
            continue;
          }
          const colorIndex = Math.abs(rowIndex * 131 + columnIndex * 17 + layer.id * 7);
          const color = layer.colors[colorIndex % layer.colors.length];
          context.fillStyle = color;
          context.strokeStyle = color;
          drawPatternShape(layer, x, y, radiusPx, rowIndex, columnIndex, pixelsPerCm);
        }
      }
    });
  }

  context.restore();

  updatePreviewScale(config);
  renderRulerOverlay(config, widthPx, heightPx, pixelsPerCm, marginPx, bleedPx);
  form.pixelSize.textContent = `${widthPx} x ${heightPx} px`;
  const activeLayer = getActiveLayer();
  form.patternLayout.textContent = activeLayer ? PATTERN_LAYOUT_LABELS[activeLayer.patternType] : PATTERN_LAYOUT_LABELS.dot;
}

function debounceRender() {
  window.clearTimeout(renderTimer);
  renderTimer = window.setTimeout(() => {
    renderPattern();
  }, 120);
}

function updateLayerValue(layerId, field, value) {
  const layer = state.layers.find((item) => item.id === layerId);
  if (!layer) {
    return;
  }

  if (field === "patternType") {
    layer.patternType = value;
    layer.spacingCm = clamp(layer.spacingCm || PATTERN_DEFAULT_SPACING[value] || PATTERN_DEFAULT_SPACING.dot, 0.2, 10);
    return;
  }
  if (field === "renderMode") {
    layer.renderMode = value;
    return;
  }
  if (field === "outlineWidthMm") {
    layer.outlineWidthMm = clamp(Number(value) || DEFAULT_OUTLINE_WIDTH_MM, 0.1, 8);
    return;
  }
  if (field === "radiusRange" || field === "radiusCm") {
    layer.radiusCm = clamp(Number(value) || 1, 0.03, 10);
    return;
  }
  if (field === "spacingRange" || field === "spacingCm") {
    layer.spacingCm = clamp(Number(value) || PATTERN_DEFAULT_SPACING.dot, 0.2, 10);
    return;
  }
  if (field === "randomRotate") {
    layer.randomRotate = Boolean(value);
  }
}

function handleLayerAction(action, layerId, colorIndex = -1) {
  const layer = state.layers.find((item) => item.id === layerId);
  if (!layer && action !== "remove-layer" && action !== "duplicate-layer") {
    return;
  }

  if (action === "toggle-layer") {
    layer.isCollapsed = !layer.isCollapsed;
    syncLayerUi();
    return;
  }
  if (action === "add-color") {
    if (layer.colors.length < MAX_LAYER_COLORS) {
      layer.colors.push("#f3c0d4");
      syncLayerUi();
      debounceRender();
    }
    return;
  }
  if (action === "random-color") {
    if (colorIndex >= 0 && colorIndex < layer.colors.length) {
      layer.colors[colorIndex] = randomColor();
      syncLayerUi();
      debounceRender();
    }
    return;
  }
  if (action === "remove-color") {
    if (layer.colors.length > 1 && colorIndex >= 0 && colorIndex < layer.colors.length) {
      layer.colors.splice(colorIndex, 1);
      syncLayerUi();
      debounceRender();
    }
    return;
  }
  if (action === "duplicate-layer") {
    const sourceLayer = state.layers.find((item) => item.id === layerId);
    if (!sourceLayer) {
      return;
    }
    const id = state.nextLayerId;
    state.nextLayerId += 1;
    const clone = createLayer(id, {
      ...sourceLayer,
      name: `图层 ${id}`,
      offsetCmX: sourceLayer.offsetCmX + 0.2,
      offsetCmY: sourceLayer.offsetCmY + 0.2,
      isCollapsed: false,
    });
    const sourceIndex = state.layers.findIndex((item) => item.id === layerId);
    if (sourceIndex >= 0) {
      state.layers.splice(sourceIndex + 1, 0, clone);
    } else {
      state.layers.push(clone);
    }
    state.activeLayerId = id;
    syncLayerUi();
    debounceRender();
    return;
  }
  if (action === "remove-layer") {
    if (state.layers.length <= 1) {
      return;
    }
    const removeIndex = state.layers.findIndex((item) => item.id === layerId);
    if (removeIndex < 0) {
      return;
    }
    state.layers.splice(removeIndex, 1);
    if (state.activeLayerId === layerId) {
      const fallbackIndex = Math.min(removeIndex, state.layers.length - 1);
      state.activeLayerId = state.layers[fallbackIndex].id;
    }
    syncLayerUi();
    debounceRender();
  }
}

function bindLayerManager() {
  form.addLayer.addEventListener("click", () => {
    const id = state.nextLayerId;
    state.nextLayerId += 1;
    state.layers.push(createLayer(id));
    state.activeLayerId = id;
    syncLayerUi();
    debounceRender();
  });

  form.moveLayerUp?.addEventListener("click", () => {
    const activeIndex = state.layers.findIndex((layer) => layer.id === state.activeLayerId);
    if (activeIndex <= 0) {
      return;
    }
    const temp = state.layers[activeIndex - 1];
    state.layers[activeIndex - 1] = state.layers[activeIndex];
    state.layers[activeIndex] = temp;
    syncLayerUi();
    debounceRender();
  });

  form.moveLayerDown?.addEventListener("click", () => {
    const activeIndex = state.layers.findIndex((layer) => layer.id === state.activeLayerId);
    if (activeIndex < 0 || activeIndex >= state.layers.length - 1) {
      return;
    }
    const temp = state.layers[activeIndex + 1];
    state.layers[activeIndex + 1] = state.layers[activeIndex];
    state.layers[activeIndex] = temp;
    syncLayerUi();
    debounceRender();
  });

  form.layerControlList.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }
    const button = target.closest("button[data-layer-action]");
    if (!button) {
      return;
    }
    const action = button.dataset.layerAction;
    const layerId = Number(button.dataset.layerId || 0);
    const colorIndex = Number(button.dataset.layerColorIndex || -1);
    handleLayerAction(action, layerId, colorIndex);
  });

  form.layerControlList.addEventListener("change", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }
    if (target.matches('input[name="active-layer-control"]')) {
      state.activeLayerId = Number(target.value);
      syncLayerUi();
      renderPattern();
      return;
    }
    if (target.matches("[data-layer-field]")) {
      const layerId = Number(target.dataset.layerId || 0);
      const field = target.dataset.layerField;
      const value = target instanceof HTMLInputElement && target.type === "checkbox" ? target.checked : target.value;
      updateLayerValue(layerId, field, value);
      syncLayerUi();
      debounceRender();
      return;
    }
    if (target.matches("[data-layer-color-index]")) {
      const layerId = Number(target.dataset.layerId || 0);
      const colorIndex = Number(target.dataset.layerColorIndex || -1);
      const layer = state.layers.find((item) => item.id === layerId);
      if (!layer || colorIndex < 0 || colorIndex >= layer.colors.length) {
        return;
      }
      layer.colors[colorIndex] = target.value;
      renderPreviewLayerSelector();
      debounceRender();
    }
  });

  form.layerControlList.addEventListener("input", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }
    if (target.matches("[data-layer-field]")) {
      const layerId = Number(target.dataset.layerId || 0);
      const field = target.dataset.layerField;
      const value = target instanceof HTMLInputElement && target.type === "checkbox" ? target.checked : target.value;
      updateLayerValue(layerId, field, value);
      if (field === "radiusRange" || field === "spacingRange") {
        syncLayerUi();
      }
      debounceRender();
      return;
    }
    if (target.matches("[data-layer-color-index]")) {
      const layerId = Number(target.dataset.layerId || 0);
      const colorIndex = Number(target.dataset.layerColorIndex || -1);
      const layer = state.layers.find((item) => item.id === layerId);
      if (!layer || colorIndex < 0 || colorIndex >= layer.colors.length) {
        return;
      }
      layer.colors[colorIndex] = target.value;
      renderPreviewLayerSelector();
      debounceRender();
    }
  });

  form.previewLayerSelector.addEventListener("change", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) {
      return;
    }
    if (target.name === "active-layer-preview") {
      state.activeLayerId = Number(target.value);
      syncLayerUi();
      renderPattern();
    }
  });
}

function bindGlobalControls() {
  form.preset.addEventListener("change", () => {
    if (form.preset.value !== "custom") {
      applyPreset(form.preset.value);
    }
    manualZoom = false;
    debounceRender();
  });

  [form.paperWidth, form.paperHeight].forEach((input) => {
    input.addEventListener("input", () => {
      updatePresetFromDimensions();
      manualZoom = false;
      debounceRender();
    });
  });

  [form.marginMm, form.bleedMm, form.backgroundColor, form.dpi, form.showRuler, form.rulerColor, form.overlapMode].forEach((input) => {
    input.addEventListener("input", () => {
      state.overlapMode = OVERLAP_MODE_COMPOSITE[form.overlapMode.value] ? form.overlapMode.value : "cover";
      debounceRender();
    });
    input.addEventListener("change", () => {
      state.overlapMode = OVERLAP_MODE_COMPOSITE[form.overlapMode.value] ? form.overlapMode.value : "cover";
      debounceRender();
    });
  });

  form.randomBgColor.addEventListener("click", () => {
    form.backgroundColor.value = randomColor();
    debounceRender();
  });

  form.exportSettings.addEventListener("click", exportSettings);
  form.importSettings.addEventListener("click", () => {
    form.importSettingsFile.click();
  });
  form.importSettingsFile.addEventListener("change", async () => {
    const [file] = form.importSettingsFile.files || [];
    if (!file) {
      return;
    }
    try {
      await importSettings(file);
    } catch {
      window.alert("导入设置失败，请检查 JSON 文件格式。");
    } finally {
      form.importSettingsFile.value = "";
    }
  });
}

function bindZoomControls() {
  const applyZoom = (nextZoom) => {
    manualZoom = true;
    form.zoom.value = clamp(nextZoom, 0.35, 2.5).toString();
    updatePreviewScale(getGlobalConfig());
  };

  form.zoom.addEventListener("input", () => {
    manualZoom = true;
    updatePreviewScale(getGlobalConfig());
  });
  form.zoomIn.addEventListener("click", () => applyZoom(Number(form.zoom.value) + 0.1));
  form.zoomOut.addEventListener("click", () => applyZoom(Number(form.zoom.value) - 0.1));
}

function bindPatternDragging() {
  const stopDragging = () => {
    if (!dragState.dragging) {
      return;
    }
    dragState.dragging = false;
    dragState.pointerId = null;
    canvas.classList.remove("is-dragging");
  };

  canvas.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 && event.pointerType !== "touch") {
      return;
    }
    const activeLayer = getActiveLayer();
    if (!activeLayer) {
      return;
    }
    event.preventDefault();
    dragState.dragging = true;
    dragState.pointerId = event.pointerId;
    dragState.startClientX = event.clientX;
    dragState.startClientY = event.clientY;
    dragState.startOffsetCmX = activeLayer.offsetCmX;
    dragState.startOffsetCmY = activeLayer.offsetCmY;
    canvas.classList.add("is-dragging");
    canvas.setPointerCapture(event.pointerId);
  });

  canvas.addEventListener("pointermove", (event) => {
    if (!dragState.dragging || dragState.pointerId !== event.pointerId) {
      return;
    }
    const activeLayer = getActiveLayer();
    if (!activeLayer) {
      return;
    }
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) {
      return;
    }
    const config = getGlobalConfig();
    const deltaCmX = ((event.clientX - dragState.startClientX) / rect.width) * config.widthCm;
    const deltaCmY = ((event.clientY - dragState.startClientY) / rect.height) * config.heightCm;
    activeLayer.offsetCmX = dragState.startOffsetCmX + deltaCmX;
    activeLayer.offsetCmY = dragState.startOffsetCmY + deltaCmY;
    debounceRender();
  });

  canvas.addEventListener("pointerup", stopDragging);
  canvas.addEventListener("pointercancel", stopDragging);
  canvas.addEventListener("lostpointercapture", stopDragging);
}

function downloadPattern() {
  const config = getGlobalConfig();
  const safePreset = form.preset.value === "custom" ? `${config.widthCm}x${config.heightCm}cm` : form.preset.value;
  const link = document.createElement("a");
  link.href = canvas.toDataURL("image/png");
  link.download = `pattern-${safePreset}-${state.layers.length}layers-${config.dpi}dpi.png`;
  link.click();
}

function init() {
  if (!canvas || !context) {
    return;
  }
  activateNavState();
  initScrollTop();
  initToolsDropdownInteraction();
  void loadToolsIntoMenus();

  syncLayerUi();
  bindLayerManager();
  bindGlobalControls();
  bindZoomControls();
  bindPatternDragging();
  form.download.addEventListener("click", downloadPattern);

  window.addEventListener("resize", () => {
    if (!manualZoom) {
      renderPattern();
      return;
    }
    updatePreviewScale(getGlobalConfig());
  });

  renderPattern();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init, { once: true });
} else {
  init();
}
