/* social.js — resize an approved image to a placement size (Instagram post / portrait, Story / Reel, …).
 * No AI generation and no cost. Two modes:
 *   crop   — fill the frame by cropping. Either a crop box from the page (fractions of the image) or a
 *            position (center / top / bottom / left / right) for the largest box of the right shape.
 *   extend — keep the whole image and fill the extra space with a soft blurred continuation of its edges
 *            (uses the same edge-blur as make_formats, passed in as extendFn).
 * Output is a JPEG (quality 92, 4:4:4) — what Meta and Instagram want.
 */
const sharp = require("sharp");

const PRESETS = {
  "ig-post":     { label: "Instagram post",     ratio: "1:1",    w: 1080, h: 1080 },
  "ig-portrait": { label: "Instagram portrait", ratio: "4:5",    w: 1080, h: 1350 },
  "ig-story":    { label: "Story / Reel",       ratio: "9:16",   w: 1080, h: 1920 },
  "fb-link":     { label: "Facebook link",      ratio: "1.91:1", w: 1200, h: 628 },
  "pinterest":   { label: "Pinterest pin",      ratio: "2:3",    w: 1000, h: 1500 },
  "square-hd":   { label: "Square HD",          ratio: "1:1",    w: 2048, h: 2048 },
};

const clampInt = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.round(v)));

/** Largest box with aspect W:H inside sw×sh, shrunk by zoom, placed by gravity. */
function frameFor(sw, sh, W, H, gravity = "center", zoom = 1) {
  const a = W / H;
  let cw, ch;
  if (sw / sh > a) { ch = sh; cw = sh * a; } else { cw = sw; ch = sw / a; }
  cw = Math.max(1, Math.round(cw / zoom)); ch = Math.max(1, Math.round(ch / zoom));
  let x = Math.round((sw - cw) / 2), y = Math.round((sh - ch) / 2);
  if (gravity === "top") y = 0;
  if (gravity === "bottom") y = sh - ch;
  if (gravity === "left") x = 0;
  if (gravity === "right") x = sw - cw;
  return { left: x, top: y, width: cw, height: ch };
}

/**
 * @param {Buffer} bytes
 * @param {object} opt  { preset?, width?, height?, mode: "crop"|"extend", crop?: {x,y,w,h} (0–1), position? }
 * @param {(buf:Buffer, W:number, H:number)=>Promise<Buffer>} extendFn
 */
async function resizeImage(bytes, opt, extendFn) {
  const p = PRESETS[opt.preset] || null;
  const W = clampInt(Number(opt.width) || (p && p.w) || 1080, 64, 4096);
  const H = clampInt(Number(opt.height) || (p && p.h) || 1080, 64, 4096);
  const mode = opt.mode === "extend" ? "extend" : "crop";
  const base = await sharp(bytes).rotate().toBuffer();            // apply phone EXIF rotation once
  const meta = await sharp(base).metadata();
  const sw = meta.width, sh = meta.height;
  const notes = [];
  let out;
  if (mode === "extend") {
    out = await sharp(await extendFn(base, W, H)).jpeg({ quality: 92, chromaSubsampling: "4:4:4" }).toBuffer();
  } else {
    let rect;
    const c = opt.crop;
    if (c && [c.x, c.y, c.w, c.h].every((v) => Number.isFinite(Number(v))) && c.w > 0 && c.h > 0) {
      const left = clampInt(c.x * sw, 0, sw - 1), top = clampInt(c.y * sh, 0, sh - 1);
      rect = { left, top, width: clampInt(c.w * sw, 1, sw - left), height: clampInt(c.h * sh, 1, sh - top) };
      // Never stretch: trim the box to the exact target shape around its centre.
      const a = W / H;
      if (Math.abs(rect.width / rect.height - a) > 0.005) {
        const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
        if (rect.width / rect.height > a) rect.width = Math.max(1, Math.round(rect.height * a));
        else rect.height = Math.max(1, Math.round(rect.width / a));
        rect.left = clampInt(cx - rect.width / 2, 0, sw - rect.width);
        rect.top = clampInt(cy - rect.height / 2, 0, sh - rect.height);
      }
    } else {
      rect = frameFor(sw, sh, W, H, opt.position || "center", 1);
    }
    if (rect.width < W * 0.9) notes.push(`upscaled from ${rect.width}px wide — may look a little soft`);
    out = await sharp(base).extract(rect).resize(W, H, { fit: "fill", kernel: "lanczos3" })
      .jpeg({ quality: 92, chromaSubsampling: "4:4:4" }).toBuffer();
  }
  return { bytes: out, width: W, height: H, mime: "image/jpeg", mode, notes };
}

/** Short slug for the file name, e.g. "ig-portrait-1080x1350". */
function sizeSlug(preset, W, H) {
  return `${PRESETS[preset] ? preset : "custom"}-${W}x${H}`;
}

module.exports = { PRESETS, resizeImage, sizeSlug };
