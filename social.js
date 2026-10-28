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
  "email-hero":  { label: "Email hero (logo added)", ratio: "9:17", w: 900, h: 1700, logo: "dark-navy" },
};

/* Brand logo, stamped on in exactly the same spot every time (measured from the approved Larkspur email:
 * centred, about 37.6% of the width, top edge 3.9% of the width down). Variants live in brand/. */
const path = require("path");
const fs = require("fs");
const LOGO_DIR = path.join(__dirname, "brand");
const LOGOS = fs.existsSync(LOGO_DIR)
  ? fs.readdirSync(LOGO_DIR).filter((f) => /^larkspur-primary-.+\.svg$/.test(f)).map((f) => f.replace(/^larkspur-primary-|\.svg$/g, ""))
  : [];
/** If the photo's own content (headline text etc.) starts inside the logo area, slide the whole picture down so there is
 * clear space under the logo: the top is filled with a soft stretch of the image's own top edge (a plain wall) and the
 * same amount is trimmed off the bottom. Returns { buf, shift }. */
async function clearLogoZone(buf, W, H, logoBottom) {
  const want = logoBottom + Math.round(W * 0.035);                 // first content row should start at least here
  const { data, info } = await sharp(buf).removeAlpha().greyscale().raw().toBuffer({ resolveWithObject: true });
  const x0 = Math.round(W * 0.2), x1 = Math.round(W * 0.8);
  let ref = 0; for (let x = x0; x < x1; x++) ref += data[2 * info.width + x]; ref /= (x1 - x0);
  let first = H;
  for (let y = 4; y < Math.min(H, want + Math.round(W * 0.2)); y++) {
    let dark = 0; for (let x = x0; x < x1; x++) if (Math.abs(data[y * info.width + x] - ref) > 45) dark++;
    if (dark > (x1 - x0) * 0.004) { first = y; break; }
  }
  if (first >= want) return { buf, shift: 0 };
  const shift = Math.min(want - first, Math.round(H * 0.12));
  const strip = Math.max(6, Math.round(H * 0.01));
  const fill = await sharp(buf).extract({ left: 0, top: 0, width: W, height: strip }).resize(W, shift + 40, { fit: "fill" }).blur(12).toBuffer();
  const body = await sharp(buf).extract({ left: 0, top: 0, width: W, height: H - shift }).toBuffer();
  const out = await sharp({ create: { width: W, height: H, channels: 3, background: "#ffffff" } })
    .composite([{ input: fill, left: 0, top: 0 }, { input: body, left: 0, top: shift }]).png().toBuffer();
  return { buf: out, shift };
}
async function addLogo(buf, W, H, variant, notes) {
  const file = path.join(LOGO_DIR, `larkspur-primary-${variant}.svg`);
  if (!fs.existsSync(file)) throw new Error(`Unknown logo "${variant}". Options: ${LOGOS.join(", ")}`);
  const lw = Math.round((W * 513) / 1364 / 0.995), lh = Math.round(lw / 5);
  const left = Math.round((W * 433) / 1364 - 0.0025 * lw), top = Math.round((W * 53) / 1364 - 0.02125 * lh);
  const cleared = await clearLogoZone(buf, W, H, top + lh);
  if (cleared.shift && notes) notes.push(`moved the picture down ${cleared.shift}px to clear the logo`);
  const logo = await sharp(file, { density: 600 }).resize(lw, lh).png().toBuffer();
  return sharp(cleared.buf).composite([{ input: logo, left, top }]).toBuffer();
}

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
  let W = clampInt(Number(opt.width) || (p && p.w) || 1080, 64, 4096);
  let H = clampInt(Number(opt.height) || (p && p.h) || 1080, 64, 4096);
  const mode = opt.mode === "extend" ? "extend" : "crop";
  const base = await sharp(bytes).rotate().toBuffer();            // apply phone EXIF rotation once
  const meta = await sharp(base).metadata();
  const sw = meta.width, sh = meta.height;
  const notes = [];
  let out;
  // Full quality: keep every pixel the photo has instead of shrinking to the preset's pixel size (same shape).
  const fit = (w, h) => { const k = Math.min(1, 4096 / Math.max(w, h)); return [Math.round(w * k / 2) * 2, Math.round(h * k / 2) * 2]; };
  if (mode === "extend") {
    if (opt.full) { const a = W / H; [W, H] = sw / sh > a ? fit(sw, sw / a) : fit(sh * a, sh); }
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
    if (opt.full) { [W, H] = fit(rect.width, rect.height); notes.push("full quality — every pixel of the crop kept"); }
    if (rect.width < W * 0.9) notes.push(`upscaled from ${rect.width}px wide — may look a little soft`);
    out = await sharp(base).extract(rect).resize(W, H, { fit: "fill", kernel: "lanczos3" })
      .jpeg({ quality: 92, chromaSubsampling: "4:4:4" }).toBuffer();
  }
  const logo = opt.logo === "none" ? null : (opt.logo || (p && p.logo) || null);
  if (logo) {
    out = await sharp(await addLogo(out, W, H, logo, notes)).jpeg({ quality: 92, chromaSubsampling: "4:4:4" }).toBuffer();
    notes.push(`logo: ${logo}`);
  }
  return { bytes: out, width: W, height: H, mime: "image/jpeg", mode, notes, full: !!opt.full };
}

/** Short slug for the file name, e.g. "ig-portrait-1080x1350". */
function sizeSlug(preset, W, H, full) {
  return `${PRESETS[preset] ? preset : "custom"}${full ? "-full" : ""}-${W}x${H}`;
}

module.exports = { PRESETS, LOGOS, resizeImage, sizeSlug };
