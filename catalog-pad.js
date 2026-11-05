/* catalog-pad.js — v1.18: website catalog images need empty backdrop above the head and below the feet, or the
 * product grid crops the head (Jose, Nov 2026). The model rarely leaves enough room, so after generation we measure
 * where the person is and, if the margins are too small, shrink the photo and continue its own plain backdrop
 * outward. The person is never repainted or cropped — only backdrop is added. No AI cost. */
const sharp = require("sharp");

const TOP = 0.12, BOTTOM = 0.10;   // minimum empty backdrop above the head / below the feet (fraction of height)

async function catalogPad(bytes) {
  const { data, info } = await sharp(bytes).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const W = info.width, H = info.height, px = (x, y, c) => data[(y * W + x) * 3 + c];
  // 1) backdrop model: per row, average of a strip at each side; across the row, straight blend left → right
  const S = Math.max(8, Math.round(W * 0.05)), L = new Float32Array(H * 3), R = new Float32Array(H * 3);
  for (let y = 0; y < H; y++) for (let c = 0; c < 3; c++) {
    let a = 0, b = 0; for (let x = 0; x < S; x++) { a += px(x, y, c); b += px(W - 1 - x, y, c); }
    L[y * 3 + c] = a / S; R[y * 3 + c] = b / S;
  }
  // close-up / detail shot: the side strips are fabric, not plain backdrop (they change a lot from row to row)
  let rough = 0; for (let y = 8; y < H; y++) for (let c = 0; c < 3; c++) rough += Math.abs(L[y * 3 + c] - L[(y - 8) * 3 + c]) + Math.abs(R[y * 3 + c] - R[(y - 8) * 3 + c]);
  rough /= (H - 8) * 6;
  if (rough > 0.5) return { bytes, changed: false, note: "catalog framing: close-up, left as is" };
  const bg = (x, y, c) => { const t = x / (W - 1); return L[y * 3 + c] * (1 - t) + R[y * 3 + c] * t; };
  // 2) where is the person? rows/cols with enough pixels that differ clearly from the backdrop
  const mask = new Uint8Array(W * H); const rowHits = new Int32Array(H);
  for (let y = 0; y < H; y++) for (let x = S; x < W - S; x++) {
    let d = 0; for (let c = 0; c < 3; c++) d += Math.abs(px(x, y, c) - bg(x, y, c));
    if (d > 42) { mask[y * W + x] = 1; rowHits[y]++; }
  }
  const minHits = Math.max(4, W * 0.004);
  let top = 0; while (top < H && rowHits[top] < minHits) top++;
  let bot = H - 1; while (bot > 0 && rowHits[bot] < minHits) bot--;
  if (top >= bot) return { bytes, changed: false, note: "catalog framing: no person found, left as is" };
  const topM = top / H, botM = (H - 1 - bot) / H;
  // cropped shot (body runs off the bottom, e.g. knees-up) → only add room above the head, keep the bottom edge where it is
  const cropped = botM < 0.015;
  if (cropped && topM >= TOP - 0.01) return { bytes, changed: false, note: `catalog framing OK (${Math.round(topM * 100)}% above head, cropped shot)` };
  if (!cropped && topM >= TOP - 0.01 && botM >= BOTTOM - 0.01) return { bytes, changed: false, note: `catalog framing OK (${Math.round(topM * 100)}% above head, ${Math.round(botM * 100)}% below feet)` };
  // 3) scale so the person fits between the margins, centred on the person
  const s = cropped ? Math.min(1, (H * (1 - TOP)) / (H - top)) : Math.min(1, (H * (1 - TOP - BOTTOM)) / (bot - top + 1));
  const w = Math.round(W * s), h = Math.round(H * s);
  const x0 = Math.round((W - w) / 2);
  let y0 = cropped ? H - h : Math.round(H * TOP - top * s);       // cropped: bottom edge stays put; else head lands at the top margin…
  if (!cropped) { const freeBelow = H - (y0 + bot * s); if (freeBelow < H * BOTTOM) y0 -= Math.round(H * BOTTOM - freeBelow); }
  // dilated, softened person mask so hair edges stay solid
  const m8 = Buffer.alloc(W * H); for (let i = 0; i < W * H; i++) m8[i] = mask[i] ? 255 : 0;
  const soft = await sharp(m8, { raw: { width: W, height: H, channels: 1 } }).blur(10).resize(w, h).raw().toBuffer();
  const small = await sharp(data, { raw: { width: W, height: H, channels: 3 } }).resize(w, h, { kernel: "lanczos3" }).raw().toBuffer();
  // 4) new canvas = the backdrop model stretched outward, then the shrunk photo with feathered edges
  const out = Buffer.alloc(W * H * 3); const F = Math.round(W * 0.035);
  let seed = 7; const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff - 0.5; };
  for (let Y = 0; Y < H; Y++) {
    const sy = Math.min(H - 1, Math.max(0, Math.round((Y - y0) / s)));      // source row (clamped = continue edge row)
    for (let X = 0; X < W; X++) {
      const sx = Math.min(W - 1, Math.max(0, Math.round((X - x0) / s)));
      const lx = X - x0, ly = Y - y0, inside = lx >= 0 && ly >= 0 && lx < w && ly < h;
      let a = 0;
      if (inside) {
        a = Math.min(1, lx / F, (w - 1 - lx) / F, ly / F, cropped ? 1 : (h - 1 - ly) / F);
        a = Math.max(a, Math.min(1, soft[ly * w + lx] / 40));
      }
      const n = inside && a >= 1 ? 0 : rnd() * 2.4;
      for (let c = 0; c < 3; c++) {
        const b = bg(sx, sy, c) + n;
        const v = inside ? small[(ly * w + lx) * 3 + c] * a + b * (1 - a) : b;
        out[(Y * W + X) * 3 + c] = Math.max(0, Math.min(255, Math.round(v)));
      }
    }
  }
  const png = await sharp(out, { raw: { width: W, height: H, channels: 3 } }).png().toBuffer();
  return { bytes: png, changed: true, note: `catalog framing: added backdrop so the head has ${Math.round(TOP * 100)}%+ room above${cropped ? "" : ` and the feet ${Math.round(BOTTOM * 100)}%+ below`} (was ${Math.round(topM * 100)}% / ${Math.round(botM * 100)}%)` };
}

const CATALOG_PROMPT = `\n\nCATALOG FRAMING (website product image — the store grid crops the edges): leave generous plain backdrop around the person. The top of the head sits about 12–15% of the frame height below the top edge and the feet end about 10–12% above the bottom edge; nothing is cut off. Centre the person left to right.`;

module.exports = { catalogPad, CATALOG_PROMPT };
