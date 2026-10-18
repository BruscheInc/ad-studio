/* enhance.js — "finish for ads": upscale + clarity + fine grain, no AI generation cost.
 *
 * Pipeline
 *   1. Upscale ×2 (or ×4).  If REPLICATE_API_TOKEN is set, a real AI upscaler (Real-ESRGAN) recovers detail;
 *      otherwise a high-quality Lanczos3 resample (clean, but no new detail).
 *   2. Clarity — local-contrast pass (large-radius unsharp mask) so the image stops looking flat.
 *   3. Sharpen — small-radius unsharp mask for crisp edges, tuned to avoid halos.
 *   4. Tone — a touch of contrast and saturation, both mild.
 *   5. Grain — fine luminance grain at low opacity so smooth AI surfaces read as photographic.
 *   6. Encode — JPEG (quality 93, 4:4:4) by default, or PNG.
 */
const sharp = require("sharp");

const REPLICATE_TOKEN = process.env.REPLICATE_API_TOKEN || "";
const REPLICATE_MODEL = process.env.REPLICATE_UPSCALE_MODEL || "nightmareai/real-esrgan";

/** AI upscale through Replicate. `publicUrl` must be reachable from the internet (our /img/<id> link). */
async function replicateUpscale(publicUrl, scale) {
  const r = await fetch(`https://api.replicate.com/v1/models/${REPLICATE_MODEL}/predictions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${REPLICATE_TOKEN}`, "Content-Type": "application/json", Prefer: "wait=60" },
    body: JSON.stringify({ input: { image: publicUrl, scale, face_enhance: false } }),
  });
  let j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Replicate ${r.status}: ${(j && (j.detail || j.error)) || "request failed"}`);
  // If the prediction is still running after the wait, poll it (up to ~2 min).
  const deadline = Date.now() + 120000;
  while (j.status && !["succeeded", "failed", "canceled"].includes(j.status) && Date.now() < deadline) {
    await new Promise((s) => setTimeout(s, 2500));
    const p = await fetch(j.urls.get, { headers: { Authorization: `Bearer ${REPLICATE_TOKEN}` } });
    j = await p.json();
  }
  if (j.status !== "succeeded") throw new Error(`Replicate upscale ${j.status || "did not finish"}: ${j.error || ""}`.trim());
  const out = Array.isArray(j.output) ? j.output[0] : j.output;
  const f = await fetch(out);
  if (!f.ok) throw new Error(`Couldn't download the upscaled file (HTTP ${f.status}).`);
  return Buffer.from(await f.arrayBuffer());
}

/** Fine monochrome grain as an RGB buffer the size of the image, mean 128. */
function grainBuffer(w, h, amount) {
  const px = Buffer.alloc(w * h * 3);
  for (let i = 0; i < w * h; i++) {
    // Box–Muller-ish: sum of two uniforms ≈ triangular, which looks closer to film grain than flat noise.
    const n = (Math.random() + Math.random() - 1) * amount;
    const v = Math.max(0, Math.min(255, Math.round(128 + n)));
    px[i * 3] = v; px[i * 3 + 1] = v; px[i * 3 + 2] = v;
  }
  return px;
}

/**
 * @param {Buffer} bytes        source image
 * @param {object} opt
 * @param {2|4}    opt.scale    upscale factor (default 2)
 * @param {"auto"|"ai"|"resample"} opt.upscaler  auto = AI when a Replicate token exists, else resample
 * @param {number} opt.clarity  0–2  local-contrast strength (default 1)
 * @param {number} opt.sharpen  0–2  edge sharpening strength (default 1)
 * @param {number} opt.grain    0–2  grain strength (default 1)
 * @param {number} opt.contrast 0–2  global contrast (1 = unchanged; default 1.08)
 * @param {number} opt.saturation 0–2 (default 1.04)
 * @param {"jpeg"|"png"} opt.format
 * @param {string} opt.publicUrl  URL of the source (needed for the AI upscaler)
 */
async function enhance(bytes, opt = {}) {
  const scale = opt.scale === 4 ? 4 : 2;
  const clarity = clamp(opt.clarity, 0, 2, 1), sharpenAmt = clamp(opt.sharpen, 0, 2, 1), grain = clamp(opt.grain, 0, 2, 1);
  const contrast = clamp(opt.contrast, 0.5, 2, 1.08), saturation = clamp(opt.saturation, 0, 2, 1.04);
  const wantAI = opt.upscaler === "ai" || (opt.upscaler !== "resample" && !!REPLICATE_TOKEN);
  const meta = await sharp(bytes).metadata();
  const W = meta.width * scale, H = meta.height * scale;
  const notes = [];

  // 1. Upscale
  let base;
  if (wantAI) {
    if (!REPLICATE_TOKEN) throw new Error("AI upscaling needs REPLICATE_API_TOKEN on Railway (replicate.com → API tokens). Use upscaler='resample' for the free version.");
    if (!opt.publicUrl) throw new Error("AI upscaling needs a public URL for the source image.");
    try {
      const up = await replicateUpscale(opt.publicUrl, scale);
      base = sharp(up).resize(W, H, { kernel: "lanczos3", fit: "fill" });
      notes.push(`AI upscale ×${scale} (${REPLICATE_MODEL})`);
    } catch (e) {
      if (opt.upscaler === "ai") throw e;
      notes.push(`AI upscale unavailable (${e.message}) — used Lanczos ×${scale}`);
      base = sharp(bytes).resize(W, H, { kernel: "lanczos3", fit: "fill" });
    }
  } else {
    base = sharp(bytes).resize(W, H, { kernel: "lanczos3", fit: "fill" });
    notes.push(`Lanczos upscale ×${scale}`);
  }
  let img = await base.removeAlpha().toColourspace("srgb").raw().toBuffer({ resolveWithObject: true });
  const toSharp = (b) => sharp(b.data, { raw: { width: b.info.width, height: b.info.height, channels: 3 } });

  // 2. Clarity: unsharp mask with a large radius = local contrast. sigma scales with image size.
  if (clarity > 0) {
    const sigma = Math.max(4, Math.round(Math.min(W, H) / 110));
    const blurred = await toSharp(img).blur(sigma).raw().toBuffer();
    const k = 0.22 * clarity;                               // mix strength
    const d = img.data;
    for (let i = 0; i < d.length; i += 3) {
      // Midtone weight: no effect on near-white or near-black pixels, so a light backdrop never grows a halo.
      const L = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) / 255;
      const t = (L - 0.5) * 2; const wgt = Math.max(0, 1 - t * t * t * t);   // 1 at mid-grey → 0 at the extremes
      for (let c = 0; c < 3; c++) {
        const v = d[i + c] + k * wgt * (d[i + c] - blurred[i + c]);
        d[i + c] = v < 0 ? 0 : v > 255 ? 255 : v;
      }
    }
    notes.push(`clarity ${clarity}`);
  }

  // 3–4. Sharpen + tone (sharp's own sharpen is a tuned unsharp mask with flat/jagged control → fewer halos)
  let s = toSharp(img);
  if (sharpenAmt > 0) s = s.sharpen({ sigma: 0.9 + 0.3 * scale, m1: 0.6 * sharpenAmt, m2: 1.6 * sharpenAmt, x1: 2, y2: 10, y3: 20 });
  if (contrast !== 1) s = s.linear(contrast, 128 * (1 - contrast));     // pivot around mid-grey
  if (saturation !== 1) s = s.modulate({ saturation });
  img = await s.raw().toBuffer({ resolveWithObject: true });
  notes.push(`sharpen ${sharpenAmt}`, `contrast ${contrast}`, `saturation ${saturation}`);

  // 5. Grain — overlay blend keeps mid-tones textured and leaves highlights/shadows alone.
  let out = toSharp(img);
  if (grain > 0) {
    const amp = 18 * grain;
    const g = grainBuffer(W, H, amp);
    out = out.composite([{ input: g, raw: { width: W, height: H, channels: 3 }, blend: "overlay" }]);
    notes.push(`grain ${grain}`);
  }

  // 6. Encode
  const format = opt.format === "png" ? "png" : "jpeg";
  const buf = format === "png" ? await out.png({ compressionLevel: 8 }).toBuffer() : await out.jpeg({ quality: 93, chromaSubsampling: "4:4:4", mozjpeg: true }).toBuffer();
  return { bytes: buf, mime: format === "png" ? "image/png" : "image/jpeg", width: W, height: H, notes };
}

function clamp(v, lo, hi, dflt) { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt; }

module.exports = { enhance, hasAIUpscaler: () => !!REPLICATE_TOKEN };
