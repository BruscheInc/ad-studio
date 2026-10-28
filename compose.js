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
};
const LOGO_DIR = path.join(__dirname, "brand");

/* Larkspur-friendly palette names the caller can use instead of hex. */
const COLORS = {
  cream: "#FBF7F0", oat: "#F3ECE1", sand: "#E9DFD0", white: "#FFFFFF", navy: "#1F2A44", ink: "#2B2B2B",
  red: "#C8473D", berry: "#B5475A", sage: "#7E9A7A", pine: "#2F5D50", sky: "#DCE8F2", blush: "#F5E1DC", gold: "#E9C46A",
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
  radius = radius ?? Math.round(size * 0.35);
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

async function solid(W, H, bg) {
  return sharp({ create: { width: W, height: H, channels: 4, background: col(bg, COLORS.cream) } }).png().toBuffer();
}

/** Stack text pieces (eyebrow, headline, body, buttons) centred in a W-wide column; returns layers + total height. */
async function textStack(b, W, S, defaults = {}) {
  const color = col(b.color, defaults.color || COLORS.navy);
  const inner = Math.round(W - 2 * (b.pad_x ?? 0.09 * S));
  const pieces = [];
  if (b.eyebrow) pieces.push({ ...(await text(b.eyebrow.toUpperCase(), { font: "sans", weight: "SemiBold", size: Math.round(0.019 * S), color, width: inner, spacing: Math.round(0.006 * S) })), gap: Math.round(0.022 * S) });
  if (b.script) pieces.push({ ...(await text(b.script, { font: "hand", weight: "Regular", size: Math.round(0.05 * S), color: col(b.accent, color), width: inner })), gap: Math.round(0.012 * S) });
  if (b.headline) pieces.push({ ...(await text(b.headline, { font: "serif", weight: b.headline_weight || "Regular", size: Math.round((b.headline_size || (defaults.headline_size || 0.072)) * S), color, width: inner, lineHeight: 0.95 })), gap: Math.round(0.026 * S) });
  if (b.body) pieces.push({ ...(await text(b.body, { font: "sans", weight: "Regular", size: Math.round((defaults.body_size || 0.026) * S), color, width: Math.min(inner, Math.round(0.78 * W)), lineHeight: 1.25 })), gap: Math.round(0.038 * S) });
  const btns = b.buttons || (b.button ? [b.button] : []);
  for (const bt of btns) {
    const lbl = typeof bt === "string" ? bt : bt.label;
    pieces.push({ ...(await button(lbl, { bg: bt.bg || b.button_bg || "red", color: bt.color || "white", size: Math.round(0.026 * S), minWidth: Math.round(Math.min(0.5 * S, 0.8 * W)) })), gap: Math.round(0.018 * S) });
  }
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
      return sharp(await solid(W, H, bg)).composite([{ input: logo, left: Math.round((W - lw) / 2), top: pad }]).png().toBuffer();
    }
    case "spacer": return solid(W, Math.round(b.height || 0.04 * S), bg);
    case "text": {
      const st = await textStack(b, W, S);
      const pad = Math.round((b.pad ?? 0.06) * S), H = st.h + pad * 2;
      return sharp(await solid(W, H, bg)).composite(placeStack(st, W, pad)).png().toBuffer();
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
      const img = layers.length ? await sharp(photo).composite(layers).png().toBuffer() : photo;
      const H = PH + inset * (b.inset_bottom === false ? 1 : 2);
      return sharp(await solid(W, H, bg)).composite([{ input: img, left: inset, top: inset }]).png().toBuffer();
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
    default: throw new Error(`Unknown block type "${b.type}".`);
  }
}

/** Compose a full section. Returns { bytes, width, height, mime, notes }. */
async function composeEmail({ width = 1800, height, blocks, fit = "stretch-last", format = "jpeg" }, getBytes) {
  const W = Math.round(width), S = W;     // all sizes scale with the width
  const bufs = [];
  for (const b of blocks) bufs.push(await renderBlock(b, W, S, getBytes));
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
