/* compose.js — build an email section the way real brand emails are built: photos laid out in a clean grid,
 * with real typography, buttons and small hand-written callouts set on top in code. No AI generation, no cost.
 *
 * Why: when the image model paints the headline, stickers, doodles and buttons into the photo, the whole thing
 * reads as "made by AI". Brand emails (e.g. Little Sleepies) use real photos + designed type on flat colour panels.
 *
 * Fonts live in fonts/ (Google Fonts, OFL): Fraunces (soft serif headlines), DM Sans (body, buttons), Caveat (callouts).
 */
const sharp = require("sharp");
const path = require("path");
const fs = require("fs");

const FONT_DIR = path.join(__dirname, "fonts");
const FONTS = {
  serif: { file: path.join(FONT_DIR, "Fraunces.ttf"), family: "Fraunces" },
  sans: { file: path.join(FONT_DIR, "DMSans.ttf"), family: "DM Sans" },
  hand: { file: path.join(FONT_DIR, "Caveat.ttf"), family: "Caveat" },
  script: { file: path.join(FONT_DIR, "DancingScript.ttf"), family: "Dancing Script" },
};
const LOGO_DIR = path.join(__dirname, "brand");

/* Larkspur-friendly palette names the caller can use instead of hex. */
const COLORS = {
  cream: "#FBF7F0", oat: "#F3ECE1", sand: "#E9DFD0", white: "#FFFFFF", navy: "#1F2A44", ink: "#2B2B2B",
  red: "#C8473D", berry: "#B5475A", sage: "#7E9A7A", pine: "#2F5D50", sky: "#DCE8F2", blush: "#F5E1DC", gold: "#E9C46A",
  ice: "#EAF2F7", frost: "#F4F8FA", cranberry: "#9E2B33", evergreen: "#5E7F6E", snow: "#FFFFFF",
};
const col = (c, d) => (c ? (COLORS[c] || c) : d);
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Render text with a real font. Returns { buf, w, h } (transparent PNG). size in px. */
async function text(str, o = {}) {
  const { size = 40, lineHeight, align = "centre" } = o;
  const lines = String(str ?? "").split("\n");
  if (lines.length > 1 && lineHeight) {          // stack lines ourselves so line spacing can be tighter than the font's
    const parts = [];
    for (const l of lines) parts.push(await text1(l || " ", { ...o, lineHeight: undefined }));
    const step = Math.round(size * lineHeight * 1.18);
    const W = Math.max(...parts.map((p) => p.w)), H = step * (lines.length - 1) + parts[parts.length - 1].h;
    const layers = parts.map((p, i) => ({ input: p.buf, top: i * step, left: align === "left" ? 0 : align === "right" ? W - p.w : Math.round((W - p.w) / 2) }));
    const buf = await sharp({ create: { width: W, height: H, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite(layers).png().toBuffer();
    return { buf, w: W, h: H };
  }
  return text1(str, o);
}
async function text1(str, { font = "sans", weight = "Regular", size = 40, color = "#000", width, align = "centre", spacing = 0, lineHeight } = {}) {
  const f = FONTS[font] || FONTS.sans;
  let markup = `<span foreground="${col(color)}"${spacing ? ` letter_spacing="${Math.round(spacing * 1024)}"` : ""}>${esc(str)}</span>`;
  const opts = { text: markup, font: `${f.family} ${weight} ${size}`, fontfile: f.file, rgba: true, dpi: 72, align };
  if (width) { opts.width = Math.round(width); opts.wrap = "word"; }
  if (lineHeight && lineHeight > 1) opts.spacing = Math.round(size * (lineHeight - 1));
  const img = sharp({ text: opts });
  const buf = await img.png().toBuffer();
  const m = await sharp(buf).metadata();
  return { buf, w: m.width, h: m.height };
}

/** Rounded pill/rect button. */
async function button(label, { bg = "red", color = "white", size = 44, padX, padY, radius, minWidth = 0 } = {}) {
  const t = await text(label, { font: "sans", weight: "SemiBold", size, color });
  padX = padX ?? Math.round(size * 1.3); padY = padY ?? Math.round(size * 0.62);
  const w = Math.max(minWidth, t.w + padX * 2), h = t.h + padY * 2;
  radius = Math.min(radius ?? Math.round(size * 0.35), h / 2);
  const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${h}" rx="${radius}" fill="${col(bg)}"/></svg>`);
  const buf = await sharp(svg).composite([{ input: t.buf, left: Math.round((w - t.w) / 2), top: Math.round((h - t.h) / 2) }]).png().toBuffer();
  return { buf, w, h };
}

/** A thin hand-drawn arrow (SVG) pointing in a direction. */
async function arrow(dir = "down", len = 120, color = "navy", stroke = 4) {
  const L = len, s = stroke;
  // drawn pointing right then rotated
  const pathD = `M ${s} ${L * 0.35} C ${L * 0.3} ${L * 0.05}, ${L * 0.6} ${L * 0.05}, ${L - s * 2} ${L * 0.3}`;
  const head = `M ${L - s * 2 - L * 0.16} ${L * 0.18} L ${L - s * 2} ${L * 0.3} L ${L - s * 2 - L * 0.12} ${L * 0.43}`;
  const rot = { right: 0, down: 90, left: 180, up: 270, "down-left": 135, "down-right": 45, "up-left": 225, "up-right": 315 }[dir] ?? 90;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${L}" height="${L}" viewBox="0 0 ${L} ${L}"><g transform="rotate(${rot} ${L / 2} ${L / 2})" fill="none" stroke="${col(color)}" stroke-width="${s}" stroke-linecap="round" stroke-linejoin="round"><path d="${pathD}"/><path d="${head}"/></g></svg>`;
  const buf = await sharp(Buffer.from(svg)).png().toBuffer();
  return { buf, w: L, h: L };
}

/** Cover-crop a photo into W×H, keeping the focus point (0–1) in view. */
async function coverPhoto(bytes, W, H, fx = 0.5, fy = 0.5, zoom = 1) {
  const base = await sharp(bytes).rotate().toBuffer();
  const m = await sharp(base).metadata();
  const a = W / H;
  let cw, ch;
  if (m.width / m.height > a) { ch = m.height; cw = ch * a; } else { cw = m.width; ch = cw / a; }
  cw = Math.round(cw / zoom); ch = Math.round(ch / zoom);
  const left = Math.max(0, Math.min(m.width - cw, Math.round(m.width * fx - cw / 2)));
  const top = Math.max(0, Math.min(m.height - ch, Math.round(m.height * fy - ch / 2)));
  return sharp(base).extract({ left, top, width: cw, height: ch }).resize(W, H, { kernel: "lanczos3" }).png().toBuffer();
}

/* Seeded random so the same layout always draws the same snow. */
function rng(seed) { let x = (seed >>> 0) || 1; return () => ((x = (x * 1664525 + 1013904223) >>> 0) / 4294967296); }
/** Playful holiday decoration as an SVG overlay: falling snow dots and/or little sparkle stars. */
function decorSvg(W, H, kind = "snow", { color = "#FFFFFF", accent = "#E9C46A", density = 1, seed = 7, avoid = null } = {}) {
  const r = rng(seed + W + H), els = [];
  const area = (W * H) / 1e6;
  const inAvoid = (x, y) => avoid && x > avoid.x0 && x < avoid.x1 && y > avoid.y0 && y < avoid.y1;
  if (kind === "snow" || kind === "both") {
    const n = Math.round(14 * area * density);
    for (let i = 0; i < n; i++) { const x = r() * W, y = r() * H; if (inAvoid(x, y)) continue; const rad = (0.0025 + r() * 0.0055) * W; els.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${rad.toFixed(1)}" fill="${color}" opacity="${(0.55 + r() * 0.45).toFixed(2)}"/>`); }
  }
  if (kind === "sparkles" || kind === "both") {
    const n = Math.max(3, Math.round(2.2 * area * density));
    for (let i = 0; i < n; i++) {
      const x = r() * W, y = r() * H; if (inAvoid(x, y)) continue; const s = (0.008 + r() * 0.012) * W;
      const d = `M ${x} ${y - s} C ${x + s * 0.12} ${y - s * 0.12}, ${x + s * 0.12} ${y - s * 0.12}, ${x + s} ${y} C ${x + s * 0.12} ${y + s * 0.12}, ${x + s * 0.12} ${y + s * 0.12}, ${x} ${y + s} C ${x - s * 0.12} ${y + s * 0.12}, ${x - s * 0.12} ${y + s * 0.12}, ${x - s} ${y} C ${x - s * 0.12} ${y - s * 0.12}, ${x - s * 0.12} ${y - s * 0.12}, ${x} ${y - s} Z`;
      els.push(`<path d="${d}" fill="${accent}" opacity="${(0.7 + r() * 0.3).toFixed(2)}"/>`);
    }
  }
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${els.join("")}</svg>`);
}
/** Rounded rectangle with a scalloped (bumpy) edge all around — like a cookie-cutter frame. */
function scallopPath(W, H) {
  const r = Math.max(10, Math.min(W, H) * 0.035), nx = Math.max(4, Math.round(W / (r * 2))), ny = Math.max(4, Math.round(H / (r * 2)));
  const sx = W / nx, sy = H / ny; let d = `M${r} ${r}`;
  for (let i = 0; i < nx; i++) d += ` Q ${r + (i + 0.5) * ((W - 2 * r) / nx)} ${0} ${r + (i + 1) * ((W - 2 * r) / nx)} ${r}`;
  for (let i = 0; i < ny; i++) d += ` Q ${W} ${r + (i + 0.5) * ((H - 2 * r) / ny)} ${W - r} ${r + (i + 1) * ((H - 2 * r) / ny)}`;
  for (let i = 0; i < nx; i++) d += ` Q ${W - r - (i + 0.5) * ((W - 2 * r) / nx)} ${H} ${W - r - (i + 1) * ((W - 2 * r) / nx)} ${H - r}`;
  for (let i = 0; i < ny; i++) d += ` Q ${0} ${H - r - (i + 0.5) * ((H - 2 * r) / ny)} ${r} ${H - r - (i + 1) * ((H - 2 * r) / ny)}`;
  return d + " Z";
}
/** Mask an image to a shape: rounded corners, an arch top, or a soft wave along the bottom/top edge. */
async function shapeMask(buf, W, H, { shape = "rect", radius = 0 }) {
  if (shape === "rect" && !radius) return buf;
  let d;
  const rr = Math.min(radius, W / 2, H / 2);
  if (shape === "circle") { const r = Math.min(W, H) / 2; d = `M${W / 2 - r} ${H / 2} A${r} ${r} 0 1 0 ${W / 2 + r} ${H / 2} A${r} ${r} 0 1 0 ${W / 2 - r} ${H / 2} Z`; }
  else if (shape === "scallop") { d = scallopPath(W, H); }
  else if (shape === "arch") { const R = W / 2; d = `M0 ${H} L0 ${R} A${R} ${R} 0 0 1 ${W} ${R} L${W} ${H} Z`; }
  else if (shape === "wave-bottom" || shape === "wave-both") {
    const a = H * 0.035, y = H - a * 1.6;
    const top = shape === "wave-both" ? `M0 ${a * 1.6} C ${W * 0.25} ${-a * 0.4}, ${W * 0.55} ${a * 3.2}, ${W} ${a * 0.6}` : `M0 0 L${W} 0`;
    d = `${top} L${W} ${y} C ${W * 0.72} ${y + a * 2.4}, ${W * 0.38} ${y - a * 1.4}, 0 ${y + a * 0.8} Z`;
  } else if (shape === "wave-top") { const a = H * 0.035; d = `M0 ${a * 1.6} C ${W * 0.25} ${-a * 0.4}, ${W * 0.55} ${a * 3.2}, ${W} ${a * 0.6} L${W} ${H} L0 ${H} Z`; }
  else d = `M${rr} 0 H${W - rr} A${rr} ${rr} 0 0 1 ${W} ${rr} V${H - rr} A${rr} ${rr} 0 0 1 ${W - rr} ${H} H${rr} A${rr} ${rr} 0 0 1 0 ${H - rr} V${rr} A${rr} ${rr} 0 0 1 ${rr} 0 Z`;
  const mask = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><path d="${d}" fill="#fff"/></svg>`);
  return sharp(buf).ensureAlpha().composite([{ input: mask, blend: "dest-in" }]).png().toBuffer();
}


/* ---------- little doodle stickers (vector, clean, a few per section) ---------- */
const STICKERS = {
  sparkle: (c) => `<path d="M50 4 C54 38 62 46 96 50 C62 54 54 62 50 96 C46 62 38 54 4 50 C38 46 46 38 50 4 Z" fill="${c}"/>`,
  star: (c) => `<path d="M50 6 L61 38 L95 38 L67 58 L78 92 L50 71 L22 92 L33 58 L5 38 L39 38 Z" fill="${c}" stroke="${c}" stroke-width="4" stroke-linejoin="round"/>`,
  snowflake: (c) => `<g stroke="${c}" stroke-width="6" stroke-linecap="round" fill="none">${[0, 60, 120].map((r) => `<g transform="rotate(${r} 50 50)"><path d="M50 8 V92"/><path d="M38 18 L50 30 L62 18"/><path d="M38 82 L50 70 L62 82"/></g>`).join("")}</g>`,
  bow: (c) => `<g stroke="${c}" stroke-width="5" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M50 46 C36 26 12 24 12 38 C12 52 34 52 50 46 Z"/><path d="M50 46 C64 26 88 24 88 38 C88 52 66 52 50 46 Z"/><path d="M47 49 C40 62 32 76 26 90"/><path d="M53 49 C60 62 68 76 74 90"/></g><circle cx="50" cy="47" r="6" fill="${c}"/>`,
  ornament: (c) => `<rect x="42" y="14" width="16" height="12" rx="3" fill="${c}"/><path d="M50 14 C44 4 56 4 50 14" stroke="${c}" stroke-width="4" fill="none"/><circle cx="50" cy="58" r="32" fill="${c}"/><path d="M22 52 C40 60 60 44 78 52" stroke="#FFFFFF" stroke-width="4" fill="none" opacity="0.7"/>`,
  holly: (c, a) => `<path d="M48 54 C40 34 22 30 8 34 C14 38 12 44 18 46 C14 50 16 56 22 56 C26 62 36 58 48 54 Z" fill="${c}"/><path d="M52 54 C60 34 78 30 92 34 C86 38 88 44 82 46 C86 50 84 56 78 56 C74 62 64 58 52 54 Z" fill="${c}"/><circle cx="44" cy="62" r="8" fill="${a}"/><circle cx="58" cy="62" r="8" fill="${a}"/><circle cx="51" cy="74" r="8" fill="${a}"/>`,
  heart: (c) => `<path d="M50 88 C20 66 6 50 6 32 C6 18 18 8 30 8 C40 8 46 14 50 22 C54 14 60 8 70 8 C82 8 94 18 94 32 C94 50 80 66 50 88 Z" fill="${c}"/>`,
  gift: (c) => `<g stroke="${c}" stroke-width="5" fill="none" stroke-linejoin="round" stroke-linecap="round"><rect x="14" y="40" width="72" height="50" rx="4"/><rect x="8" y="28" width="84" height="14" rx="3"/><path d="M50 28 V90"/><path d="M50 28 C40 10 22 14 30 24 C34 28 44 28 50 28 C56 28 66 28 70 24 C78 14 60 10 50 28"/></g>`,
  candycane: (c) => `<path d="M62 92 V34 C62 14 34 14 34 32" stroke="${c}" stroke-width="12" fill="none" stroke-linecap="round"/><path d="M62 92 V34 C62 14 34 14 34 32" stroke="#FFFFFF" stroke-width="12" fill="none" stroke-linecap="round" stroke-dasharray="7 9"/>`,
  moon: (c) => `<path d="M64 8 C36 12 20 36 24 60 C28 84 54 98 78 88 C58 86 42 70 42 50 C42 30 52 16 64 8 Z" fill="${c}"/>`,
  dot: (c) => `<circle cx="50" cy="50" r="40" fill="${c}"/>`,
};
async function addStickers(buf, list, W) {
  if (!list || !list.length) return buf;
  const H = (await sharp(buf).metadata()).height;
  const els = list.map((s) => {
    const k = STICKERS[s.kind] ? s.kind : "sparkle";
    const size = (s.size || 0.05) * W, x = s.x * W - size / 2, y = (s.y <= 1.5 ? s.y * H : s.y) - size / 2;
    return `<g transform="translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${s.rotate || 0} ${size / 2} ${size / 2}) scale(${(size / 100).toFixed(4)})" opacity="${s.opacity ?? 1}">${STICKERS[k](col(s.color, COLORS.gold), col(s.accent, COLORS.cranberry))}</g>`;
  });
  return sharp(buf).composite([{ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${els.join("")}</svg>`), left: 0, top: 0 }]).png().toBuffer();
}

/* Edge between two colour bands: soft wave, a row of scallops, or puffy cloud bumps. Optional thin wavy accent line. */
function edgeSvg(W, H, { style = "wave", from, to, line, seed = 1 }) {
  let d;
  if (style === "scallop") {
    const n = Math.max(8, Math.round(W / (H * 1.6))), w = W / n, r = w / 2, ry = Math.min(r, H * 0.8), base = H * 0.92;
    d = `M0 ${H} L0 ${base}` + Array.from({ length: n }, (_, i) => ` A${r} ${ry} 0 0 1 ${(i + 1) * w} ${base}`).join("") + ` L${W} ${H} Z`;
  } else if (style === "cloud") {
    const rnd = rng(seed + 31); let x = 0; d = `M0 ${H} L0 ${H * 0.6}`;
    while (x < W) { const w = W * (0.07 + rnd() * 0.07), h = H * (0.35 + rnd() * 0.5); d += ` C ${x + w * 0.05} ${H * 0.6 - h}, ${x + w * 0.95} ${H * 0.6 - h}, ${Math.min(W, x + w)} ${H * 0.6}`; x += w; }
    d += ` L${W} ${H} Z`;
  } else d = `M0 ${H * 0.55} C ${W * 0.22} ${H * 0.05}, ${W * 0.48} ${H * 0.95}, ${W * 0.74} ${H * 0.4} S ${W * 0.95} ${H * 0.2}, ${W} ${H * 0.35} L${W} ${H} L0 ${H} Z`;
  let acc = "";
  if (line) { const yy = H * 0.86, a = H * 0.06, n = 9; let p = `M0 ${yy}`; for (let i = 0; i < n; i++) { const x0 = (i * W) / n, x1 = ((i + 1) * W) / n; p += ` Q ${(x0 + x1) / 2} ${yy + (i % 2 ? a : -a)} ${x1} ${yy}`; } acc = `<path d="${p}" stroke="${col(line)}" stroke-width="${Math.max(3, W * 0.003)}" fill="none" stroke-linecap="round"/>`; }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect width="${W}" height="${H}" fill="${col(from)}"/><path d="${d}" fill="${col(to)}"/>${acc}</svg>`;
}

/* Pill tag ("Last Call!") — text on a soft highlight. */
async function pillTag(label, { bg = "gold", color = "navy", size = 34 } = {}) {
  const t = await text(label, { font: "sans", weight: "SemiBold", size, color });
  const px = Math.round(size * 0.8), py = Math.round(size * 0.32), w = t.w + px * 2, h = t.h + py * 2;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${h}" rx="${h / 2}" fill="${col(bg)}"/></svg>`;
  return { buf: await sharp(Buffer.from(svg)).composite([{ input: t.buf, left: px, top: py }]).png().toBuffer(), w, h };
}
/* Coupon-code chip: dashed rounded box with a small label and the code. */
async function codeChip(c, S, fallbackColor) {
  const color = col(c.color, fallbackColor), size = Math.round((c.size || 0.034) * S);
  const lab = c.label ? await text(c.label.toUpperCase(), { font: "sans", weight: "Medium", size: Math.round(size * 0.48), color, spacing: Math.round(size * 0.12) }) : null;
  const val = await text(c.value, { font: "sans", weight: "Bold", size, color, spacing: Math.round(size * 0.1) });
  const px = Math.round(size * 1.1), py = Math.round(size * 0.55), gap = lab ? Math.round(size * 0.25) : 0;
  const w = Math.max(val.w, lab ? lab.w : 0) + px * 2, h = (lab ? lab.h + gap : 0) + val.h + py * 2, sw = Math.max(3, Math.round(size * 0.07));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect x="${sw / 2}" y="${sw / 2}" width="${w - sw}" height="${h - sw}" rx="${Math.round(size * 0.4)}" fill="${c.bg ? col(c.bg) : "none"}" stroke="${color}" stroke-width="${sw}" stroke-dasharray="${sw * 3} ${sw * 2.2}"/></svg>`;
  const layers = []; let y = py;
  if (lab) { layers.push({ input: lab.buf, left: Math.round((w - lab.w) / 2), top: y }); y += lab.h + gap; }
  layers.push({ input: val.buf, left: Math.round((w - val.w) / 2), top: y });
  return { buf: await sharp(Buffer.from(svg)).composite(layers).png().toBuffer(), w, h };
}
/* Headline where lines starting with "*" take the accent colour (two-tone, like brand emails). */
async function twoTone(str, o, accent) {
  const lines = String(str).split("\n");
  if (!lines.some((l) => l.startsWith("*"))) return text(str, o);
  const parts = [];
  for (const l of lines) parts.push(await text1(l.replace(/^\*|\*$/g, "") || " ", { ...o, lineHeight: undefined, color: l.startsWith("*") ? accent : o.color }));
  const step = Math.round(o.size * (o.lineHeight || 1) * 1.18);
  const W = Math.max(...parts.map((p) => p.w)), H = step * (parts.length - 1) + parts[parts.length - 1].h;
  const buf = await sharp({ create: { width: W, height: H, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite(parts.map((p, i) => ({ input: p.buf, top: i * step, left: Math.round((W - p.w) / 2) }))).png().toBuffer();
  return { buf, w: W, h: H };
}
/* Underlined link label ("Shop Dresses"). */
async function linkLabel(label, size, color) {
  const t = await text(label, { font: "serif", weight: "Medium", size, color });
  const th = Math.max(2, Math.round(size * 0.07)), gap = Math.round(size * 0.12), H = t.h + gap + th;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${t.w}" height="${H}"><rect y="${t.h + gap - th}" width="${t.w}" height="${th}" fill="${color}"/></svg>`;
  return { buf: await sharp(Buffer.from(svg)).composite([{ input: t.buf, left: 0, top: 0 }]).png().toBuffer(), w: t.w, h: H };
}

/* Add a thin coloured outline around an already-shaped image (circle, arch, rounded rect). */
async function ringed(img, W, H, shape, radius, color, sw) {
  let d;
  const i = sw / 2;
  if (shape === "circle") { const r = Math.min(W, H) / 2 - i; d = `M${W / 2 - r} ${H / 2} A${r} ${r} 0 1 0 ${W / 2 + r} ${H / 2} A${r} ${r} 0 1 0 ${W / 2 - r} ${H / 2} Z`; }
  else if (shape === "arch") { const R = W / 2 - i; d = `M${i} ${H - i} L${i} ${W / 2} A${R} ${R} 0 0 1 ${W - i} ${W / 2} L${W - i} ${H - i} Z`; }
  else { const r = Math.max(0, radius - i); d = `M${i + r} ${i} H${W - i - r} A${r} ${r} 0 0 1 ${W - i} ${i + r} V${H - i - r} A${r} ${r} 0 0 1 ${W - i - r} ${H - i} H${i + r} A${r} ${r} 0 0 1 ${i} ${H - i - r} V${i + r} A${r} ${r} 0 0 1 ${i + r} ${i} Z`; }
  return sharp(img).composite([{ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><path d="${d}" fill="none" stroke="${color}" stroke-width="${sw}"/></svg>`) }]).png().toBuffer();
}
async function addStickersBox(buf, list, W) { return addStickers(buf, list, W); }

async function solid(W, H, bg) {
  return sharp({ create: { width: W, height: H, channels: 4, background: col(bg, COLORS.cream) } }).png().toBuffer();
}

/** Stack text pieces (eyebrow, headline, body, buttons) centred in a W-wide column; returns layers + total height. */
async function textStack(b, W, S, defaults = {}) {
  const color = col(b.color, defaults.color || COLORS.navy);
  const accent = col(b.accent, color);
  const inner = Math.round(W - 2 * (b.pad_x ?? 0.09 * S));
  const pieces = [];
  if (b.tag) { const tg = typeof b.tag === "string" ? { label: b.tag } : b.tag; pieces.push({ ...(await pillTag(tg.label, { bg: tg.bg || "gold", color: tg.color || color, size: Math.round((tg.size || 0.024) * S) })), gap: Math.round(0.02 * S) }); }
  if (b.eyebrow) pieces.push({ ...(await text(b.eyebrow.toUpperCase(), { font: "sans", weight: "SemiBold", size: Math.round(0.019 * S), color, width: inner, spacing: Math.round(0.006 * S) })), gap: Math.round(0.022 * S) });
  if (b.script) pieces.push({ ...(await text(b.script, { font: b.script_font || "script", weight: b.script_font === "hand" ? "Regular" : "SemiBold", size: Math.round((b.script_size || (b.script_font === "hand" ? 0.05 : 0.058)) * S), color: accent, width: inner })), gap: Math.round(0.006 * S) });
  if (b.headline) pieces.push({ ...(await twoTone(b.headline, { font: "serif", weight: b.headline_weight || "Regular", size: Math.round((b.headline_size || (defaults.headline_size || 0.072)) * S), color: col(b.headline_color, color), width: inner, lineHeight: 0.95 }, accent)), gap: Math.round(0.026 * S) });
  if (b.body) pieces.push({ ...(await text(b.body, { font: "sans", weight: "Regular", size: Math.round((b.body_size || defaults.body_size || 0.026) * S), color, width: Math.min(inner, Math.round((b.body_width || 0.78) * W)), lineHeight: 1.25 })), gap: Math.round(0.034 * S) });
  if (b.code) pieces.push({ ...(await codeChip(typeof b.code === "string" ? { label: "Use code", value: b.code } : b.code, S, color)), gap: Math.round(0.032 * S) });
  const btns = b.buttons || (b.button ? [b.button] : []);
  for (const bt of btns) {
    const lbl = typeof bt === "string" ? bt : bt.label;
    pieces.push({ ...(await button(lbl, { bg: bt.bg || b.button_bg || "red", color: bt.color || "white", size: Math.round(0.026 * S), radius: bt.pill ? 999 : undefined, minWidth: Math.round(Math.min(0.5 * S, 0.8 * W)) })), gap: Math.round(0.018 * S) });
  }
  if (b.fine) pieces.push({ ...(await text(b.fine, { font: "sans", size: Math.round(0.016 * S), color, width: inner, lineHeight: 1.2 })), gap: 0 });
  if (pieces.length && b.fine && pieces.length > 1) pieces[pieces.length - 2].gap = Math.round(0.016 * S);
  const h = pieces.reduce((s, p, i) => s + p.h + (i < pieces.length - 1 ? p.gap : 0), 0);
  return { pieces, h };
}
function placeStack(stack, W, top, leftOffset = 0) {
  const layers = []; let y = top;
  stack.pieces.forEach((p, i) => { layers.push({ input: p.buf, left: leftOffset + Math.round((W - p.w) / 2), top: Math.round(y) }); y += p.h + (i < stack.pieces.length - 1 ? p.gap : 0); });
  return layers;
}

/** Callouts on a photo: [{text, x, y, arrow}] with x,y as fractions of the block. */
async function callouts(list, W, H, S, color = "navy") {
  const layers = [];
  for (const c of list || []) {
    const t = await text(c.text, { font: "hand", weight: "Regular", size: Math.round((c.size || 0.038) * S), color: col(c.color, col(color)), width: Math.round(0.3 * S), align: "centre" });
    const x = Math.round(c.x * W - t.w / 2), y = Math.round(c.y * H - t.h / 2);
    layers.push({ input: t.buf, left: Math.max(0, Math.min(W - t.w, x)), top: Math.max(0, Math.min(H - t.h, y)) });
    if (c.arrow && c.arrow !== "none") {
      const a = await arrow(c.arrow, Math.round(0.07 * S), c.color || color, Math.max(2, Math.round(0.0022 * S)));
      const off = { down: [0, t.h / 2 + a.h * 0.45], up: [0, -t.h / 2 - a.h * 0.45], left: [-t.w / 2 - a.w * 0.4, 0], right: [t.w / 2 + a.w * 0.4, 0],
        "down-left": [-t.w * 0.35, t.h / 2 + a.h * 0.35], "down-right": [t.w * 0.35, t.h / 2 + a.h * 0.35], "up-left": [-t.w * 0.35, -t.h / 2 - a.h * 0.35], "up-right": [t.w * 0.35, -t.h / 2 - a.h * 0.35] }[c.arrow] || [0, 0];
      const ax = Math.round(c.x * W + off[0] - a.w / 2), ay = Math.round(c.y * H + off[1] - a.h / 2);
      layers.push({ input: a.buf, left: Math.max(0, Math.min(W - a.w, ax)), top: Math.max(0, Math.min(H - a.h, ay)) });
    }
  }
  return layers;
}

/**
 * Render one block → PNG buffer W wide.
 * getBytes(id) → Promise<Buffer> loads a stored image.
 */
async function renderBlock(b, W, S, getBytes) {
  const bg = col(b.bg, COLORS.cream);
  switch (b.type) {
    case "bar": {
      const t = await text(b.text, { font: "sans", weight: "Medium", size: Math.round(0.022 * S), color: col(b.color, "#FFFFFF"), width: W * 0.9 });
      const H = t.h + Math.round(0.03 * S);
      return sharp(await solid(W, H, b.bg || "navy")).composite([{ input: t.buf, left: Math.round((W - t.w) / 2), top: Math.round((H - t.h) / 2) }]).png().toBuffer();
    }
    case "logo": {
      const variant = b.variant || "dark-navy";
      const file = path.join(LOGO_DIR, `larkspur-primary-${variant}.svg`);
      if (!fs.existsSync(file)) throw new Error(`Unknown logo "${variant}".`);
      const lw = Math.round((b.width || 0.36) * W), lh = Math.round(lw / 5);
      const logo = await sharp(file, { density: 600 }).resize(lw, lh).png().toBuffer();
      const pad = Math.round((b.pad ?? 0.04) * S), H = lh + pad * 2;
      const under = b.decor ? [{ input: decorSvg(W, H, b.decor, { color: col(b.decor_color, "#FFFFFF"), accent: col(b.decor_accent, COLORS.gold), density: b.decor_density || 1, seed: 9, avoid: { x0: (W - lw) / 2 - 20, x1: (W + lw) / 2 + 20, y0: pad - 20, y1: pad + lh + 20 } }), left: 0, top: 0 }] : [];
      return sharp(await solid(W, H, bg)).composite([...under, { input: logo, left: Math.round((W - lw) / 2), top: pad }]).png().toBuffer();
    }
    case "spacer": return solid(W, Math.round(b.height || 0.04 * S), bg);
    case "wave": {   // soft transition from one colour (top) to another (bottom): style wave | scallop | cloud
      const H = Math.round((b.height || 0.06) * W);
      return sharp(Buffer.from(edgeSvg(W, H, { style: b.style || "wave", from: b.from || "cream", to: b.to || "ice", line: b.line, seed: b.seed || 1 }))).png().toBuffer();
    }
    case "text": {
      if (b.card) {               // text set on a rounded card floating on the section colour
        const cd = typeof b.card === "object" ? b.card : {};
        const inset = Math.round((cd.inset ?? 0.06) * W), CW = W - inset * 2;
        const st = await textStack({ ...b, pad_x: b.pad_x ?? 0.06 * S }, CW, S);
        const cpad = Math.round((cd.pad ?? 0.05) * S), CH = st.h + cpad * 2;
        const pad = Math.round((b.pad ?? 0.05) * S), H = CH + pad * 2;
        const card = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${CW}" height="${CH}">${cd.shape === "scallop" ? `<path d="${scallopPath(CW, CH)}" fill="${col(cd.bg, COLORS.white)}"/>` : `<rect width="${CW}" height="${CH}" rx="${Math.round((cd.radius ?? 0.03) * W)}" fill="${col(cd.bg, COLORS.white)}"/>`}</svg>`);
        const layers = [{ input: card, left: inset, top: pad }, ...placeStack(st, CW, pad + cpad, inset)];
        if (b.decor) layers.unshift({ input: decorSvg(W, H, b.decor, { color: col(b.decor_color, "#DCE8F2"), accent: col(b.decor_accent, COLORS.gold), density: b.decor_density || 1, seed: 13, avoid: { x0: inset, x1: W - inset, y0: pad, y1: pad + CH } }), left: 0, top: 0 });
        return sharp(await solid(W, H, bg)).composite(layers).png().toBuffer();
      }
      const st = await textStack(b, W, S);
      const pad = Math.round((b.pad ?? 0.06) * S), padTop = Math.round((b.pad_top ?? b.pad ?? 0.06) * S), padBottom = Math.round((b.pad_bottom ?? b.pad ?? 0.06) * S), H = st.h + padTop + padBottom;
      const layers = placeStack(st, W, padTop);
      if (b.decor) layers.unshift({ input: decorSvg(W, H, b.decor, { color: col(b.decor_color, "#DCE8F2"), accent: col(b.decor_accent, COLORS.gold), density: b.decor_density || 1, seed: 11, avoid: { x0: W * 0.12, x1: W * 0.88, y0: pad * 0.6, y1: H - pad * 0.6 } }), left: 0, top: 0 });
      return sharp(await solid(W, H, bg)).composite(layers).png().toBuffer();
    }
    case "photo": {
      const inset = Math.round((b.inset || 0) * W);
      const PW = W - inset * 2, PH = Math.round(b.height ? (b.height <= 3 ? PW * b.height : b.height) : PW * 1.0);
      const photo = await coverPhoto(await getBytes(b.image_id), PW, PH, b.focus_x ?? 0.5, b.focus_y ?? 0.5, b.zoom || 1);
      const layers = [...(await callouts(b.callouts, PW, PH, S, b.callout_color || "navy"))];
      if (b.button) {
        const bt = await button(b.button.label || b.button, { bg: b.button.bg || "red", color: b.button.color || "white", size: Math.round(0.026 * S), minWidth: Math.round(0.5 * S) });
        layers.push({ input: bt.buf, left: Math.round((PW - bt.w) / 2), top: PH - bt.h - Math.round((b.button_bottom ?? 0.05) * PH) });
      }
      if (b.snow) layers.unshift({ input: decorSvg(PW, PH, b.snow === true ? "snow" : b.snow, { color: col(b.snow_color, "#FFFFFF"), accent: col(b.decor_accent, COLORS.gold), density: b.snow_density || 1, seed: 3 }), left: 0, top: 0 });
      let img = layers.length ? await sharp(photo).composite(layers).png().toBuffer() : photo;
      img = await shapeMask(img, PW, PH, { shape: b.shape || "rect", radius: Math.round((b.radius || 0) * W) });
      if (b.ring) img = await ringed(img, PW, PH, b.shape || "rect", Math.round((b.radius || 0) * W), col(b.ring), Math.round((b.ring_width || 0.006) * W));
      const padTop = Math.round((b.pad_top ?? b.inset ?? 0) * W), padBottom = Math.round((b.pad_bottom ?? (b.inset_bottom === false ? 0 : b.inset ?? 0)) * W);
      const H = PH + padTop + padBottom;
      const under = b.decor ? [{ input: decorSvg(W, H, b.decor, { color: col(b.decor_color, "#DCE8F2"), accent: col(b.decor_accent, COLORS.gold), density: b.decor_density || 1, seed: 5 }), left: 0, top: 0 }] : [];
      return sharp(await solid(W, H, bg)).composite([...under, { input: img, left: inset, top: padTop }]).png().toBuffer();
    }
    case "split": {
      const half = Math.round(W / 2);
      const H = Math.round(b.height ? (b.height <= 3 ? half * b.height : b.height) : half * 1.25);
      const photo = await coverPhoto(await getBytes(b.image_id), half, H, b.focus_x ?? 0.5, b.focus_y ?? 0.5, b.zoom || 1);
      const st = await textStack({ ...b, pad_x: 0.05 * S }, W - half, S, { headline_size: b.headline_size || 0.058 });
      const photoLeft = b.side === "right" ? W - half : 0, textLeft = b.side === "right" ? 0 : half;
      return sharp(await solid(W, H, bg)).composite([{ input: photo, left: photoLeft, top: 0 }, ...placeStack(st, W - half, Math.round((H - st.h) / 2), textLeft)]).png().toBuffer();
    }
    case "pair": {
      const gap = Math.round((b.gap ?? 0.025) * W), pad = Math.round((b.pad ?? 0.05) * W);
      const padTop = Math.round((b.pad_top ?? b.pad ?? 0.05) * W), padBottom = Math.round((b.pad_bottom ?? b.pad ?? 0.05) * W);
      const items = (b.items || []).slice(0, 3);
      const cw = Math.round((W - pad * 2 - gap * (items.length - 1)) / items.length);
      const ch = Math.round(cw * (b.ratio || 1.25));
      const color = col(b.color, COLORS.navy);
      const rows = [[], [], [], []];            // photo, label, sub, button — each row lined up across the tiles
      for (const it of items) {
        rows[0].push({ buf: await coverPhoto(await getBytes(it.image_id), cw, ch, it.focus_x ?? 0.5, it.focus_y ?? 0.5, it.zoom || 1), w: cw, h: ch });
        rows[1].push(it.label ? await text(it.label, { font: "serif", size: Math.round(0.036 * S), color, width: cw }) : null);
        rows[2].push(it.sub ? await text(it.sub, { font: "sans", size: Math.round(0.021 * S), color, width: cw }) : null);
        rows[3].push(it.button ? await button(it.button.label || it.button, { bg: it.button.bg || b.button_bg || "red", size: Math.round(0.021 * S), minWidth: Math.round(cw * 0.72) }) : null);
      }
      const gaps = [Math.round(0.016 * S), Math.round(0.004 * S), Math.round(0.016 * S), 0];
      const layers = []; let y = padTop;
      rows.forEach((row, ri) => {
        const rh = Math.max(0, ...row.map((p) => (p ? p.h : 0)));
        if (!rh) return;
        row.forEach((p, i) => { if (p) layers.push({ input: p.buf, left: pad + i * (cw + gap) + Math.round((cw - p.w) / 2), top: Math.round(y) }); });
        y += rh + gaps[ri];
      });
      return sharp(await solid(W, Math.round(y) + padBottom, bg)).composite(layers).png().toBuffer();
    }
    case "links": {
      const pad = Math.round(0.05 * W), gap = Math.round(0.02 * W), cw = Math.round((W - pad * 2 - gap) / 2);
      const btns = [];
      for (const l of b.buttons || []) btns.push(await button(l.label || l, { bg: l.bg || b.button_bg || "pine", size: Math.round(0.022 * S), minWidth: cw, padX: 10 }));
      const bh = btns.length ? btns[0].h : 0, rows = Math.ceil(btns.length / 2);
      const H = pad * 2 + rows * bh + (rows - 1) * gap;
      const layers = btns.map((bt, i) => ({ input: bt.buf, left: pad + (i % 2) * (cw + gap), top: pad + Math.floor(i / 2) * (bh + gap) }));
      return sharp(await solid(W, H, bg)).composite(layers).png().toBuffer();
    }
    case "collage": {   // photo collage on a colour panel (like a brand hero): layouts hero5 | trio | duo
      const pad = Math.round((b.pad ?? 0.045) * W), gap = Math.round((b.gap ?? 0.018) * W), rad = Math.round((b.radius ?? 0.012) * W);
      const padTop = Math.round((b.pad_top ?? b.pad ?? 0.045) * W), padBottom = Math.round((b.pad_bottom ?? b.pad ?? 0.045) * W);
      const IW = W - pad * 2, it = b.items || [];
      const boxes = [];
      if ((b.layout || "hero5") === "hero5") {
        const lw = Math.round((IW - gap) * 0.6), rw = IW - gap - lw, h1 = Math.round((b.height || 0.78) * IW), sh = Math.round((h1 - gap) / 2);
        const h2 = Math.round((b.height2 || 0.48) * IW), tw = Math.round((IW - gap) * 0.42), ww = IW - gap - tw;
        boxes.push([0, 0, lw, h1], [lw + gap, 0, rw, sh], [lw + gap, sh + gap, rw, h1 - sh - gap], [0, h1 + gap, tw, h2], [tw + gap, h1 + gap, ww, h2]);
      } else if (b.layout === "trio") {
        const h1 = Math.round((b.height || 0.62) * IW), hw = Math.round((IW - gap) / 2), h2 = Math.round((b.height2 || 0.6) * hw * 2 / 2);
        boxes.push([0, 0, IW, h1], [0, h1 + gap, hw, h2], [hw + gap, h1 + gap, IW - gap - hw, h2]);
      } else {
        const hw = Math.round((IW - gap) / 2), h1 = Math.round((b.height || 1.25) * hw);
        boxes.push([0, 0, hw, h1], [hw + gap, 0, IW - gap - hw, h1]);
      }
      const layers = []; let maxY = 0;
      for (let i = 0; i < boxes.length && i < it.length; i++) {
        const [x, y, w, h] = boxes[i], item = it[i];
        let tile;
        if (item.tile) {
          const t = item.tile, lines = t.lines || [];
          const size = Math.round((t.size || 0.075) * W);
          const parts = [];
          for (const ln of lines) parts.push(await text1(ln.text, { font: ln.font || "serif", weight: ln.weight || "Bold", size: Math.round(size * (ln.scale || 1)), color: col(ln.color, COLORS.cranberry) }));
          const step = Math.round(size * (t.line_height || 1.0));
          const th = step * (parts.length - 1) + (parts.length ? parts[parts.length - 1].h : 0);
          let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${h}" fill="${col(t.bg, COLORS.cream)}"/></svg>`;
          tile = await sharp(Buffer.from(svg)).composite(parts.map((p, j) => ({ input: p.buf, left: Math.round((w - p.w) / 2), top: Math.round((h - th) / 2 + j * step) }))).png().toBuffer();
          if (t.stickers) tile = await addStickersBox(tile, t.stickers, w, h);
        } else tile = await coverPhoto(await getBytes(item.image_id), w, h, item.focus_x ?? 0.5, item.focus_y ?? 0.5, item.zoom || 1);
        tile = await shapeMask(tile, w, h, { shape: "rect", radius: rad });
        layers.push({ input: tile, left: pad + x, top: padTop + y }); maxY = Math.max(maxY, y + h);
      }
      const H = padTop + maxY + padBottom;
      const under = b.decor ? [{ input: decorSvg(W, H, b.decor, { color: col(b.decor_color, "#FFFFFF"), accent: col(b.decor_accent, COLORS.gold), density: b.decor_density || 1, seed: 17 }), left: 0, top: 0 }] : [];
      const over = b.snow ? [{ input: decorSvg(W, H, "snow", { color: col(b.snow_color, "#FFFFFF"), density: b.snow_density || 0.6, seed: 23 }), left: 0, top: 0 }] : [];
      return sharp(await solid(W, H, bg)).composite([...under, ...layers, ...over]).png().toBuffer();
    }
    case "products": {   // product cards with an underlined "Shop X" link under each (2–4 columns)
      const cols = b.columns || 2, pad = Math.round((b.pad ?? 0.06) * W), gap = Math.round((b.gap ?? 0.04) * W);
      const padTop = Math.round((b.pad_top ?? 0.03) * W), padBottom = Math.round((b.pad_bottom ?? 0.05) * W);
      const cw = Math.round((W - pad * 2 - gap * (cols - 1)) / cols), ch = Math.round(cw * (b.ratio || 1.15));
      const color = col(b.color, COLORS.cranberry), card = b.card || "frame";
      const border = Math.round(cw * 0.045), rowGap = Math.round((b.row_gap ?? 0.045) * W);
      const items = b.items || [], layers = []; let y = padTop;
      for (let r = 0; r < Math.ceil(items.length / cols); r++) {
        let rowH = 0;
        for (let c = 0; c < cols; c++) {
          const item = items[r * cols + c]; if (!item) continue;
          const x = pad + c * (cw + gap);
          let photo;
          if (card === "frame") {
            const inner = await shapeMask(await coverPhoto(await getBytes(item.image_id), cw - border * 2, ch - border * 2, item.focus_x ?? 0.5, item.focus_y ?? 0.5, item.zoom || 1), cw - border * 2, ch - border * 2, { radius: Math.round(cw * 0.025) });
            const frame = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${cw}" height="${ch}"><path d="${scallopPath(cw, ch)}" fill="${col(b.frame_color, COLORS.white)}"/></svg>`);
            photo = await sharp(frame).composite([{ input: inner, left: border, top: border }]).png().toBuffer();
          } else {
            const shape = card === "arch" ? "arch" : card === "circle" ? "circle" : "rect";
            const hh = card === "circle" ? cw : ch;
            photo = await shapeMask(await coverPhoto(await getBytes(item.image_id), cw, hh, item.focus_x ?? 0.5, item.focus_y ?? 0.5, item.zoom || 1), cw, hh, { shape, radius: Math.round(cw * 0.04) });
            if (item.ring || b.ring) photo = await ringed(photo, cw, hh, shape, Math.round(cw * 0.04), col(item.ring || b.ring), Math.round(W * 0.005));
          }
          const ph = (await sharp(photo).metadata()).height;
          layers.push({ input: photo, left: x, top: y });
          let hh = ph;
          if (item.label) {
            const lb = await linkLabel(item.label, Math.round((b.label_size || 0.036) * W), col(item.color, color));
            layers.push({ input: lb.buf, left: x + Math.round((cw - lb.w) / 2), top: y + ph + Math.round(0.02 * W) }); hh += Math.round(0.02 * W) + lb.h;
          }
          if (item.sub) {
            const sb = await text(item.sub, { font: "sans", size: Math.round(0.021 * W), color: col(b.sub_color, COLORS.navy), width: cw });
            layers.push({ input: sb.buf, left: x + Math.round((cw - sb.w) / 2), top: y + hh + Math.round(0.008 * W) }); hh += Math.round(0.008 * W) + sb.h;
          }
          rowH = Math.max(rowH, hh);
        }
        y += rowH + rowGap;
      }
      const H = Math.round(y - rowGap + padBottom);
      return sharp(await solid(W, H, bg)).composite(layers).png().toBuffer();
    }
    case "swatches": {   // print swatches cropped into circles, with names
      const items = b.items || [], cols = b.columns || Math.min(4, items.length || 1);
      const pad = Math.round((b.pad ?? 0.07) * W), gap = Math.round((b.gap ?? 0.035) * W);
      const padTop = Math.round((b.pad_top ?? 0.02) * W), padBottom = Math.round((b.pad_bottom ?? 0.05) * W);
      const d = Math.round((W - pad * 2 - gap * (cols - 1)) / cols), color = col(b.color, COLORS.navy);
      const layers = []; let y = padTop;
      for (let r = 0; r < Math.ceil(items.length / cols); r++) {
        let rowH = 0;
        const n = Math.min(cols, items.length - r * cols), offset = Math.round((W - pad * 2 - (n * d + (n - 1) * gap)) / 2);
        for (let c = 0; c < n; c++) {
          const item = items[r * cols + c], x = pad + offset + c * (d + gap);
          let img = await shapeMask(await coverPhoto(await getBytes(item.image_id), d, d, item.focus_x ?? 0.5, item.focus_y ?? 0.5, item.zoom || 3), d, d, { shape: "circle" });
          if (b.ring) img = await ringed(img, d, d, "circle", 0, col(b.ring), Math.round(W * 0.005));
          layers.push({ input: img, left: x, top: y }); let hh = d;
          if (item.label) { const t = await text(item.label, { font: "sans", weight: "Medium", size: Math.round((b.label_size || 0.022) * W), color, width: d + gap, lineHeight: 1.1 }); layers.push({ input: t.buf, left: x + Math.round((d - t.w) / 2), top: y + d + Math.round(0.014 * W) }); hh += Math.round(0.014 * W) + t.h; }
          rowH = Math.max(rowH, hh);
        }
        y += rowH + gap;
      }
      return sharp(await solid(W, Math.round(y - gap + padBottom), bg)).composite(layers).png().toBuffer();
    }
    default: throw new Error(`Unknown block type "${b.type}".`);
  }
}

/** Compose a full section. Returns { bytes, width, height, mime, notes }. */
async function composeEmail({ width = 1800, height, blocks, fit = "stretch-last", format = "jpeg" }, getBytes) {
  const W = Math.round(width), S = W;     // all sizes scale with the width
  const bufs = [];
  for (const b of blocks) bufs.push(await addStickers(await renderBlock(b, W, S, getBytes), b.stickers, W));
  const hs = await Promise.all(bufs.map(async (x) => (await sharp(x).metadata()).height));
  let total = hs.reduce((a, b) => a + b, 0);
  const notes = [];
  let H = total;
  if (height) {
    H = Math.round(height);
    if (total !== H) notes.push(`blocks add up to ${total}px; ${total < H ? "padded" : "trimmed"} to ${H}px — adjust photo heights for a perfect fit`);
  }
  const layers = []; let y = 0;
  bufs.forEach((x, i) => { layers.push({ input: x, left: 0, top: y }); y += hs[i]; });
  let out = sharp({ create: { width: W, height: Math.max(H, total), channels: 3, background: col(blocks[blocks.length - 1]?.bg, COLORS.cream) } }).composite(layers);
  let buf = await out.png().toBuffer();
  if (H < total) buf = await sharp(buf).extract({ left: 0, top: 0, width: W, height: H }).png().toBuffer();
  const enc = format === "png" ? sharp(buf).png() : sharp(buf).jpeg({ quality: 92, chromaSubsampling: "4:4:4" });
  return { bytes: await enc.toBuffer(), width: W, height: H, mime: format === "png" ? "image/png" : "image/jpeg", notes, natural_height: total };
}

module.exports = { composeEmail, COLORS };
