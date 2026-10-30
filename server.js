/* Ad Studio v1.6 — a small image-generation connector for Claude.
 *
 * What it does
 *   • Exposes an MCP server (Streamable HTTP) at  /mcp/<MCP_TOKEN>  with tools:
 *       generate_image  — text → image(s) with OpenAI's gpt-image model
 *       edit_image      — edit/extend/restyle one or more uploaded or generated images (keeps subjects with input_fidelity=high)
 *       fetch_product   — read a Shopify product link (title, price, compare-at, sizes, image URLs)
 *       import_image    — pull a product photo from a URL into Ad Studio for editing
 *       make_formats    — 1:1 / 4:5 / 9:16 from an approved image, no generation cost
 *       resize_image    — Instagram post / portrait, Story / Reel and other placement sizes (crop or extend), no generation cost (v1.6)
 *       organize_images — folders, favorites, rename (v1.6)
 *       enhance         — upscale ×2/×4 + clarity + sharpen (+ optional grain) for ad delivery, no generation cost (v1.3)
 *       list_images     — recent uploads + generations
 *       get_image       — look at one image again
 *       usage           — how many images were made today / this month
 *   • A tiny web page at  /?key=<MCP_TOKEN>  to upload your own photos (so Claude can edit them) and browse/download results.
 *   • Every image is stored in Postgres so links keep working after a redeploy.
 *
 * Env
 *   OPENAI_API_KEY        required
 *   OPENAI_IMAGE_MODEL    default gpt-image-1
 *   MCP_TOKEN             required — long random string; the connector URL is https://<host>/mcp/<MCP_TOKEN>
 *   DATABASE_URL          Postgres (Railway: ${{Postgres.DATABASE_URL}})
 *   PUBLIC_URL            https://<host>  (Railway: https://${{RAILWAY_PUBLIC_DOMAIN}})
 *   MAX_IMAGES_PER_DAY    default 80 — stops a runaway loop from burning credits
 *   REPLICATE_API_TOKEN   optional — turns on AI upscaling (Real-ESRGAN) inside the enhance tool
 *   REPLICATE_UPSCALE_MODEL optional — default nightmareai/real-esrgan
 */
// Text in compose_email is drawn by sharp (Pango/fontconfig). The container has no system fontconfig file, so point
// fontconfig at our own config (fonts/ in this repo) BEFORE sharp loads.
process.env.FONTCONFIG_FILE = process.env.FONTCONFIG_FILE || require("path").join(__dirname, "fonts", "fonts.conf");
try { require("fs").mkdirSync("/tmp/ad-studio-fontcache", { recursive: true }); } catch (e) {}
const express = require("express");
const crypto = require("crypto");
const { Pool } = require("pg");
const { z } = require("zod");
const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { StreamableHTTPServerTransport } = require("@modelcontextprotocol/sdk/server/streamableHttp.js");
const { enhance, hasAIUpscaler } = require("./enhance.js");
const sharp = require("sharp");
const { PRESETS, LOGOS, resizeImage, sizeSlug } = require("./social.js");
const guard = require("./garment-guard.js");
const { composeEmail, COLORS } = require("./compose.js");
const playbook = require("./playbook.js");

const VERSION = require("./package.json").version;
const PORT = process.env.PORT || 8080;
const OPENAI_KEY = process.env.OPENAI_API_KEY || "";
const MODEL = process.env.OPENAI_IMAGE_MODEL || "gpt-image-1";
const TOKEN = process.env.MCP_TOKEN || "";
const PUBLIC_URL = (process.env.PUBLIC_URL || "").replace(/\/$/, "");
const MAX_PER_DAY = Number(process.env.MAX_IMAGES_PER_DAY || 80);
const OPENAI_BASE = process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";

if (!TOKEN) { console.error("MCP_TOKEN is not set — refusing to start without one (anyone could spend your credits)."); process.exit(1); }
if (!OPENAI_KEY) console.error("⚠️  OPENAI_API_KEY is not set — generation will fail until it is.");

/* ---------------- storage ---------------- */
const pool = process.env.DATABASE_URL ? new Pool({ connectionString: process.env.DATABASE_URL, ssl: /railway|sslmode=require/.test(process.env.DATABASE_URL) ? { rejectUnauthorized: false } : undefined }) : null;
const mem = new Map();                       // fallback when there is no database (images vanish on restart)
async function db(q, p) { return pool.query(q, p); }
async function migrate() {
  if (!pool) { console.log("🗄️  no DATABASE_URL — images are kept in memory only"); return; }
  await db(`CREATE TABLE IF NOT EXISTS ad_images (
    id TEXT PRIMARY KEY, kind TEXT NOT NULL, title TEXT, prompt TEXT, model TEXT, size TEXT, quality TEXT,
    mime TEXT NOT NULL, bytes BYTEA NOT NULL, width INT, height INT, parents TEXT[], meta JSONB,
    created_at TIMESTAMPTZ DEFAULT now())`);
  await db(`CREATE INDEX IF NOT EXISTS idx_ad_images_created ON ad_images(created_at DESC)`);
  // v1.6 — organizing: folders, favorites, custom order
  await db(`ALTER TABLE ad_images ADD COLUMN IF NOT EXISTS folder TEXT`);
  await db(`ALTER TABLE ad_images ADD COLUMN IF NOT EXISTS favorite BOOLEAN DEFAULT false`);
  await db(`ALTER TABLE ad_images ADD COLUMN IF NOT EXISTS sort_order DOUBLE PRECISION`);
  await db(`ALTER TABLE ad_images ADD COLUMN IF NOT EXISTS product_url TEXT`);
  await db(`ALTER TABLE ad_images ADD COLUMN IF NOT EXISTS product_title TEXT`);
  await db(`CREATE TABLE IF NOT EXISTS ad_folders (name TEXT PRIMARY KEY, created_at TIMESTAMPTZ DEFAULT now())`);
  console.log("🗄️  Ad Studio schema ready");
}
const newId = () => crypto.randomBytes(6).toString("base64url");
async function saveImage(rec) {
  const id = newId();
  const row = { id, created_at: new Date().toISOString(), folder: null, favorite: false, sort_order: null, product_url: null, product_title: null, ...rec };
  if (pool) await db(`INSERT INTO ad_images (id,kind,title,prompt,model,size,quality,mime,bytes,width,height,parents,meta,folder,product_url,product_title) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
    [id, rec.kind, rec.title || null, rec.prompt || null, rec.model || null, rec.size || null, rec.quality || null, rec.mime, rec.bytes, rec.width || null, rec.height || null, rec.parents || [], rec.meta || {}, rec.folder || null, rec.product_url || null, rec.product_title || null]);
  else mem.set(id, row);
  if (!rec.product_url) setImmediate(() => autoLinkOne(id, rec.title, rec.parents).catch((e) => console.error("autolink:", e.message)));
  return id;
}
async function getImage(id) {
  if (pool) return (await db(`SELECT * FROM ad_images WHERE id=$1`, [id])).rows[0] || null;
  return mem.get(id) || null;
}
async function listImages(limit = 24, kind = null) {
  if (pool) return (await db(`SELECT id, kind, title, prompt, model, size, quality, mime, width, height, parents, created_at, folder, favorite, sort_order, product_url, product_title, length(bytes) AS bytes_len FROM ad_images ${kind ? "WHERE kind=$2" : ""} ORDER BY created_at DESC LIMIT $1`, kind ? [limit, kind] : [limit])).rows;
  return [...mem.values()].filter((r) => !kind || r.kind === kind).sort((a, b) => (a.created_at < b.created_at ? 1 : -1)).slice(0, limit).map((r) => ({ ...r, bytes: undefined, bytes_len: r.bytes.length }));
}
async function countSince(iso) {
  if (pool) return Number((await db(`SELECT count(*) FROM ad_images WHERE kind IN ('generated','edited') AND coalesce(model,'') NOT IN ('format','enhance','resize') AND created_at >= $1`, [iso])).rows[0].count);
  return [...mem.values()].filter((r) => r.kind !== "upload" && !["format", "enhance", "resize"].includes(r.model) && r.created_at >= iso).length;
}
/* ---------------- organizing (v1.6) ---------------- */
const memFolders = new Set();
const cleanFolder = (f) => (f == null || String(f).trim() === "" ? null : String(f).trim().slice(0, 60));
async function ensureFolder(name) {
  if (!name) return;
  if (pool) await db(`INSERT INTO ad_folders (name) VALUES ($1) ON CONFLICT DO NOTHING`, [name]); else memFolders.add(name);
}
async function listFolders() {
  if (pool) return (await db(`SELECT name FROM ad_folders UNION SELECT DISTINCT folder FROM ad_images WHERE folder IS NOT NULL ORDER BY 1`)).rows.map((r) => r.name);
  return [...new Set([...memFolders, ...[...mem.values()].map((r) => r.folder).filter(Boolean)])].sort();
}
async function updateImages(ids, patch) {
  ids = [...new Set((ids || []).map(String).filter(Boolean))].slice(0, 500);
  if (!ids.length) return 0;
  const p = {};
  if ("title" in patch && String(patch.title || "").trim()) p.title = String(patch.title).trim().slice(0, 160);
  if ("folder" in patch) { p.folder = cleanFolder(patch.folder); await ensureFolder(p.folder); }
  if ("favorite" in patch) p.favorite = !!patch.favorite;
  if ("product_url" in patch) {
    p.product_url = patch.product_url ? String(patch.product_url).slice(0, 400) : null;
    p.product_title = p.product_url ? (String(patch.product_title || "").trim().slice(0, 200) || null) : null;
  }
  const keys = Object.keys(p); if (!keys.length) return 0;
  if (pool) {
    const vals = [ids, ...keys.map((k) => p[k])];
    return (await db(`UPDATE ad_images SET ${keys.map((k, i) => `${k}=$${i + 2}`).join(", ")} WHERE id = ANY($1::text[])`, vals)).rowCount;
  }
  let n = 0; for (const id of ids) { const r = mem.get(id); if (r) { Object.assign(r, p); n++; } } return n;
}
async function relinkAfterRename(id) { const r = await getImage(id); if (r && !r.product_url) await autoLinkOne(id, r.title, r.parents).catch(() => {}); }
async function setOrder(ids) {
  ids = [...new Set((ids || []).map(String).filter(Boolean))].slice(0, 2000);
  if (pool) { if (ids.length) await db(`UPDATE ad_images AS a SET sort_order = o.ord FROM unnest($1::text[]) WITH ORDINALITY AS o(id, ord) WHERE a.id = o.id`, [ids]); }
  else ids.forEach((id, i) => { const r = mem.get(id); if (r) r.sort_order = i + 1; });
  return ids.length;
}
async function renameFolder(from, to) {
  from = cleanFolder(from); to = cleanFolder(to); if (!from || !to) throw new Error("Folder names can't be empty.");
  if (pool) { await ensureFolder(to); await db(`UPDATE ad_images SET folder=$2 WHERE folder=$1`, [from, to]); await db(`DELETE FROM ad_folders WHERE name=$1`, [from]); }
  else { memFolders.delete(from); memFolders.add(to); for (const r of mem.values()) if (r.folder === from) r.folder = to; }
}
async function deleteFolder(name) {
  name = cleanFolder(name); if (!name) return;
  if (pool) { await db(`UPDATE ad_images SET folder=NULL WHERE folder=$1`, [name]); await db(`DELETE FROM ad_folders WHERE name=$1`, [name]); }
  else { memFolders.delete(name); for (const r of mem.values()) if (r.folder === name) r.folder = null; }
}
/* ---------------- product links (v1.6) ---------------- */
const STORE_URL = (process.env.STORE_URL || "https://larkspurbaby.com").replace(/\/$/, "");
/** Resolve a product page URL to { title, url, image, price } using the store's public .json endpoint. */
async function resolveProduct(url) {
  const u = new URL(url); const m = u.pathname.match(/\/products\/([^\/?#]+)/);
  if (!m) throw new Error("That isn't a product link (expected …/products/<name>).");
  const r = await fetch(`${u.origin}/products/${m[1]}.json`, { headers: { Accept: "application/json" } });
  if (!r.ok) throw new Error(`The store returned HTTP ${r.status} for that product.`);
  const p = (await r.json()).product;
  return { title: p.title, url: `${u.origin}/products/${p.handle}`, image: p.image ? p.image.src : (p.images && p.images[0] && p.images[0].src) || null, price: (p.variants && p.variants[0] && p.variants[0].price) || null };
}
/* Auto-link: match an image to a store product from its parents or its name.
 * Names follow larkspur-baby-<Product-Name>-<date>[-<size>] (or "Kids Long Sleeve Pajamas – Festive Trees (product shot)"),
 * so comparing the words with the store catalog finds the product. */
let catalog = { at: 0, list: [], error: null };
async function loadCatalog(force) {
  if (!force && catalog.list.length && Date.now() - catalog.at < 30 * 60e3) return catalog.list;
  const list = [];
  try {
    for (let page = 1; page <= 20; page++) {
      const r = await fetch(`${STORE_URL}/products.json?limit=250&page=${page}`, { headers: { Accept: "application/json" } });
      if (!r.ok) throw new Error(`store catalog HTTP ${r.status}`);
      const ps = (await r.json()).products || [];
      for (const p of ps) list.push({ title: p.title, url: `${STORE_URL}/products/${p.handle}`, image: (p.images && p.images[0] && p.images[0].src) || null, price: (p.variants && p.variants[0] && p.variants[0].price) || null, toks: tokens(p.title) });
      if (ps.length < 250) break;
    }
    catalog = { at: Date.now(), list, error: null };
  } catch (e) { catalog.error = e.message; if (!catalog.list.length) throw new Error(`Couldn't read the store catalog (${e.message}).`); }
  return catalog.list;
}
const STOP = new Set(["in", "the", "and", "a", "of", "kids", "kid", "product", "shot", "larkspur", "baby", "lb", "copy", "source", "enhanced", "format"]);
function tokens(t) {
  let s = String(t || "").toLowerCase().replace(/[’']/g, "").replace(/\(.*?\)/g, " ");
  s = s.replace(/\b\d{4}-\d{2}-\d{2}\b[\s\S]*$/, "");                // drop the date and anything after it
  return new Set(s.replace(/[^a-z0-9]+/g, " ").split(" ").filter((w) => w && !STOP.has(w) && !/^\d+$/.test(w)));
}
function matchProduct(title, list) {
  const tt = tokens(title); if (tt.size < 2) return null;
  const eq = list.filter((p) => p.toks.size === tt.size && [...p.toks].every((w) => tt.has(w)));
  if (eq.length === 1) return eq[0];
  if (eq.length > 1) return null;
  // e.g. "Zipper Footie and Headband in Festive Trees" → the biggest product name fully inside the image name
  const sub = list.filter((p) => p.toks.size >= 3 && [...p.toks].every((w) => tt.has(w)) && tt.size - p.toks.size <= 2)
    .sort((a, b) => b.toks.size - a.toks.size);
  if (sub.length && (sub.length === 1 || sub[0].toks.size > sub[1].toks.size)) return sub[0];
  return null;
}
async function productOfParents(parents) {
  for (const pid of parents || []) {
    const r = pool ? (await db(`SELECT product_url, product_title FROM ad_images WHERE id=$1`, [pid])).rows[0] : mem.get(pid);
    if (r && r.product_url) return { url: r.product_url, title: r.product_title };
  }
  return null;
}
async function autoLinkOne(id, title, parents) {
  let hit = await productOfParents(parents);
  if (!hit) { const list = await loadCatalog().catch(() => []); const m = matchProduct(title, list); if (m) hit = { url: m.url, title: m.title }; }
  if (!hit) return false;
  if (pool) await db(`UPDATE ad_images SET product_url=$2, product_title=$3 WHERE id=$1 AND product_url IS NULL`, [id, hit.url, hit.title]);
  else { const r = mem.get(id); if (r && !r.product_url) Object.assign(r, { product_url: hit.url, product_title: hit.title }); }
  return true;
}
/** Link every image that has no product yet. Oldest first, so edits can inherit from the product shot they came from. */
async function autoLinkAll(ids) {
  await loadCatalog(true);
  const rows = pool
    ? (await db(`SELECT id, title, parents FROM ad_images WHERE product_url IS NULL ${ids ? "AND id = ANY($1::text[])" : ""} ORDER BY created_at ASC`, ids ? [ids] : [])).rows
    : [...mem.values()].filter((r) => !r.product_url && (!ids || ids.includes(r.id))).sort((a, b) => (a.created_at < b.created_at ? -1 : 1));
  let linked = 0; const missed = [];
  for (const r of rows) { if (await autoLinkOne(r.id, r.title, r.parents)) linked++; else missed.push(r.id); }
  return { checked: rows.length, linked, missed };
}
/** Search the store's products (Shopify predictive search, no key needed). */
async function searchProducts(q) {
  try {
    const list = await loadCatalog(); const qt = [...tokens(q)];
    if (qt.length) {
      const hits = list.map((p) => ({ p, n: qt.filter((w) => p.toks.has(w)).length })).filter((x) => x.n === qt.length)
        .sort((a, b) => a.p.toks.size - b.p.toks.size).slice(0, 12).map(({ p }) => ({ title: p.title, url: p.url, image: p.image, price: p.price }));
      if (hits.length) return hits;
    }
  } catch {}
  const u = `${STORE_URL}/search/suggest.json?q=${encodeURIComponent(q)}&resources[type]=product&resources[limit]=10&resources[options][unavailable_products]=last`;
  let r;
  try { r = await fetch(u, { headers: { Accept: "application/json" } }); }
  catch (e) { throw new Error(`Couldn't reach the store (${STORE_URL}). Paste the product link instead.`); }
  if (!r.ok) throw new Error(`Store search returned HTTP ${r.status}.`);
  const j = await r.json();
  const list = (j.resources && j.resources.results && j.resources.results.products) || [];
  return list.map((p) => ({
    title: p.title, url: `${STORE_URL}${String(p.url || `/products/${p.handle}`).split("?")[0]}`,
    image: p.image || (p.featured_image && p.featured_image.url) || null, price: p.price || null,
  }));
}
/* ---------------- product failsafe (v1.8): fresh product photos + tech pack on every product image ---------------- */
function isCreatedImage(r) {
  const src = r.meta && (typeof r.meta === "string" ? (JSON.parse(r.meta || "{}").source_url) : r.meta.source_url);
  return r.kind !== "upload" || guard.isAiName(r.title) || guard.isAiName(src);
}
async function findStoreProduct(name) {
  if (/^https?:\/\//i.test(name)) { const u = new URL(name); const m = u.pathname.match(/\/products\/([^\/?#]+)/); if (!m) throw new Error(`Not a product link: ${name}`); return `${u.origin}/products/${m[1]}`; }
  const list = await loadCatalog();
  const exact = list.find((p) => p.title.toLowerCase() === String(name).trim().toLowerCase());
  const hit = exact || matchProduct(name, list);
  if (!hit) throw new Error(`Couldn't find "${name}" in the store. Use the exact product title or paste its product link.`);
  return hit.url;
}
/** Pull the product's ORIGINAL photos fresh from the store (never our own "larkspur-baby-…" uploads) + its spec text. */
async function freshProductRefs(products) {
  const refs = [], specs = [], notes = [];
  for (const pr of products) {
    const url = await findStoreProduct(pr.name);
    const r = await fetch(`${url}.json`, { headers: { Accept: "application/json" } });
    if (!r.ok) throw new Error(`Store returned HTTP ${r.status} for ${url}`);
    const p = (await r.json()).product;
    const originals = (p.images || []).map((i) => i.src).filter((src) => !guard.isAiName(src.split("?")[0].split("/").pop()));
    if (!originals.length) throw new Error(`"${p.title}" has no original product photo on the store (only AI images). Upload one before making images of it.`);
    for (const src of originals.slice(0, 2)) {
      const ir = await fetch(src); if (!ir.ok) throw new Error(`HTTP ${ir.status} downloading ${src}`);
      const mime = (ir.headers.get("content-type") || "image/jpeg").split(";")[0].trim();
      refs.push({ id: `product-${p.handle}-${refs.length + 1}`, mime, bytes: Buffer.from(await ir.arrayBuffer()), label: p.title });
    }
    const sp = guard.specText(p.title, pr.size);
    specs.push(sp.text);
    notes.push(`${p.title}: ${Math.min(2, originals.length)} original photo(s) pulled fresh; ${sp.style ? `tech pack ${sp.style} size ${sp.size}` : "no tech pack on file"}`);
  }
  return { refs, specs, notes };
}
/** Resize an image to a placement size and save the copy (same folder as the source). */
async function resizeAndSave(r, opt) {
  const out = await resizeImage(r.bytes, opt, (b, W, H) => toFormat(b, W, H));
  const preset = PRESETS[opt.preset] && !(opt.width || opt.height) ? opt.preset : (PRESETS[opt.preset] ? opt.preset : "custom");
  const base = String(r.title || r.id).trim().replace(/\s+/g, "-");
  const title = (opt.title && String(opt.title).trim()) || `${base}-${sizeSlug(preset, out.width, out.height, out.full)}`;
  const nid = await saveImage({ kind: "edited", title: title.slice(0, 160), prompt: null, model: "resize", size: `${out.width}x${out.height}`, quality: null, mime: out.mime, bytes: out.bytes, width: out.width, height: out.height, parents: [r.id], folder: r.folder || null, product_url: r.product_url || null, product_title: r.product_title || null, meta: { source: r.id, preset, mode: out.mode, full: out.full, crop: opt.crop || null, position: opt.position || null, notes: out.notes } });
  return { id: nid, ...out };
}
const imageUrl = (id, ext) => `${PUBLIC_URL || ""}/img/${id}.${ext || "png"}`;
const extOf = (mime) => (mime === "image/jpeg" ? "jpg" : mime === "image/webp" ? "webp" : "png");

/* ---------------- previews (small JPEG so Claude can see the picture without a huge payload) ---------------- */
let Jimp = null;
// Jimp can't decode WebP; sharp can. Turn WebP into PNG before handing it to Jimp.
const isWebp = (b) => Buffer.isBuffer(b) && b.length > 12 && b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP";
async function decodable(bytes) { return isWebp(bytes) ? sharp(bytes).png().toBuffer() : bytes; }
async function preview(bytes, maxEdge = 768) {
  try {
    if (!Jimp) Jimp = (await import("jimp")).Jimp;
    const im = await Jimp.read(await decodable(bytes));
    const w = im.bitmap.width, h = im.bitmap.height;
    if (Math.max(w, h) > maxEdge) im.scaleToFit({ w: maxEdge, h: maxEdge });
    const out = await im.getBuffer("image/jpeg", { quality: 78 });
    return { data: out.toString("base64"), mimeType: "image/jpeg", width: w, height: h };
  } catch (e) { return null; }
}
async function dims(bytes) {
  try { if (!Jimp) Jimp = (await import("jimp")).Jimp; const im = await Jimp.read(await decodable(bytes)); return { width: im.bitmap.width, height: im.bitmap.height }; } catch { return {}; }
}

/* ---------------- Formats without spending a generation: pad/crop an approved image to 1:1, 4:5 and 9:16.
 * Padding mirrors the image's own edge, blurs it and fades it in, which reads as "more blanket" on bedding scenes. ---- */
async function toFormat(bytes, W, H) {
  if (!Jimp) Jimp = (await import("jimp")).Jimp;
  const src = await Jimp.read(await decodable(bytes));
  const sw = src.bitmap.width, sh = src.bitmap.height;
  const srcRatio = sw / sh, dstRatio = W / H;
  if (Math.abs(srcRatio - dstRatio) < 0.02) { src.resize({ w: W, h: H }); return src.getBuffer("image/png"); }
  const out = new Jimp({ width: W, height: H, color: 0xffffffff });
  if (srcRatio < dstRatio && srcRatio / dstRatio > 0.8) {
    // Source is a little taller than the target (e.g. 2:3 → 4:5): centre-crop the height, lose nothing important.
    const fitted = src.clone().resize({ w: W, h: Math.round(W / srcRatio) });
    const y = Math.round((fitted.bitmap.height - H) / 2);
    out.composite(fitted.crop({ x: 0, y, w: W, h: H }), 0, 0);
    return out.getBuffer("image/png");
  }
  if (srcRatio > dstRatio) {
    // Source is wider than the target (1:1 → 4:5 / 9:16, 2:3 → 9:16): fit the width, pad top and bottom.
    // The padding is a thin outer strip of the image, stretched and heavily blurred — a soft continuation of the
    // bedding, with no mirrored baby or text in it.
    const h = Math.round(W / srcRatio); const fitted = src.clone().resize({ w: W, h });
    const padTop = Math.floor((H - h) / 2), padBot = H - h - padTop;
    const strip = Math.max(6, Math.round(h * 0.04));
    const blurR = Math.max(10, Math.round(Math.max(padTop, padBot) / 6));
    if (padTop > 0) { const t = fitted.clone().crop({ x: 0, y: 0, w: W, h: strip }).resize({ w: W, h: padTop + blurR * 2 }).blur(blurR); out.composite(t, 0, -blurR); }
    if (padBot > 0) { const b = fitted.clone().crop({ x: 0, y: h - strip, w: W, h: strip }).resize({ w: W, h: padBot + blurR * 2 }).blur(blurR); out.composite(b, 0, padTop + h - blurR); }
    out.composite(fitted, 0, padTop);
  } else {
    // Source much taller than the target: fit the height, pad left and right the same way.
    const w = Math.round(H * srcRatio); const fitted = src.clone().resize({ w, h: H });
    const padL = Math.floor((W - w) / 2), padR = W - w - padL;
    const strip = Math.max(6, Math.round(w * 0.04));
    const blurR = Math.max(10, Math.round(Math.max(padL, padR) / 6));
    if (padL > 0) { const l = fitted.clone().crop({ x: 0, y: 0, w: strip, h: H }).resize({ w: padL + blurR * 2, h: H }).blur(blurR); out.composite(l, -blurR, 0); }
    if (padR > 0) { const r = fitted.clone().crop({ x: w - strip, y: 0, w: strip, h: H }).resize({ w: padR + blurR * 2, h: H }).blur(blurR); out.composite(r, padL + w - blurR, 0); }
    out.composite(fitted, padL, 0);
  }
  return out.getBuffer("image/png");
}
/* ---------------- OpenAI ---------------- */
async function openaiGenerate({ prompt, size, quality, n, background, outputFormat }) {
  const body = { model: MODEL, prompt, size, quality, n, output_format: outputFormat || "png", moderation: "low" };
  if (background === "transparent") body.background = "transparent";
  const r = await fetch(`${OPENAI_BASE}/images/generations`, { method: "POST", headers: { Authorization: `Bearer ${OPENAI_KEY}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(friendlyError(r.status, j));
  return j;
}
// gpt-image-2 and later don't take input_fidelity (OpenAI: "omit this parameter") — they keep detail on their own.
const supportsFidelity = (m) => !/^gpt-image-[2-9]/.test(m) && !/^chatgpt-image/.test(m);
async function openaiEdit({ prompt, images, mask, size, quality, n, inputFidelity, outputFormat }) {
  const send = async (withFidelity) => {
    const fd = new FormData();
    fd.append("model", MODEL); fd.append("prompt", prompt); fd.append("n", String(n)); fd.append("output_format", outputFormat || "png");
    if (size && size !== "auto") fd.append("size", size);
    if (quality && quality !== "auto") fd.append("quality", quality);
    if (withFidelity && inputFidelity) fd.append("input_fidelity", inputFidelity);
    for (const im of images) fd.append("image[]", new Blob([im.bytes], { type: im.mime }), `${im.id}.${extOf(im.mime)}`);
    if (mask) fd.append("mask", new Blob([mask.bytes], { type: "image/png" }), "mask.png");
    const r = await fetch(`${OPENAI_BASE}/images/edits`, { method: "POST", headers: { Authorization: `Bearer ${OPENAI_KEY}` }, body: fd });
    const j = await r.json().catch(() => ({}));
    return { r, j };
  };
  const useFid = supportsFidelity(MODEL);
  let { r, j } = await send(useFid);
  // Safety net: if a model rejects input_fidelity, retry once without it.
  if (!r.ok && useFid && /input_fidelity/i.test((j && j.error && j.error.message) || "")) ({ r, j } = await send(false));
  if (!r.ok) throw new Error(friendlyError(r.status, j));
  return j;
}
function friendlyError(status, j) {
  const m = (j && j.error && j.error.message) || `HTTP ${status}`;
  if (status === 401) return "OpenAI rejected the API key (OPENAI_API_KEY). Check it on Railway.";
  if (status === 429 && /quota|billing|credit/i.test(m)) return "OpenAI says the account is out of credit — top up at platform.openai.com → Billing.";
  if (status === 429) return "OpenAI rate limit hit — wait a moment and try again.";
  if (status === 403 && /verif/i.test(m)) return "OpenAI requires organization verification for this image model (platform.openai.com → Settings → Organization → Verify). " + m;
  if (/content_policy|safety|moderation/i.test(m)) return "OpenAI's safety filter blocked this prompt. Reword it (avoid anything it could read as unsafe, especially around children) and try again. Detail: " + m;
  return `OpenAI error: ${m}`;
}
const costHint = (size, quality) => {        // rough list prices so the usage tool can give a ballpark
  const q = quality === "high" ? 0.167 : quality === "low" ? 0.011 : 0.042;
  return size === "1024x1024" ? q : q * 1.5;
};

/* ---------------- MCP ---------------- */
const SIZES = ["1024x1024", "1536x1024", "1024x1536", "auto"];
// gpt-image-2 and later take custom sizes up to ~4K (both sides divisible by 16, ratio 1:3–3:1, max 3840 px edge / 8.3 MP).
const BIG = !supportsFidelity(MODEL);
const BIG_SIZES = ["2048x2048", "2048x2560", "1440x2560", "2048x3072", "3072x2048"];
const SIZE_HELP = BIG
  ? `Output size. Default is high-res. Presets: 2048x2048 (square), 2048x2560 (4:5 Meta feed), 1440x2560 (9:16 Stories/Reels), 2048x3072 (portrait 2:3), 3072x2048 (landscape 3:2), or any WIDTHxHEIGHT with both sides divisible by 16, ratio between 1:3 and 3:1, longest side ≤ 3840. Also 1024x1024 / 1536x1024 / 1024x1536 for cheap drafts, or auto.`
  : "Output size: 1024x1024, 1536x1024, 1024x1536 or auto (auto keeps the source's aspect).";
function checkSize(size) {
  if (SIZES.includes(size)) return size;
  if (!BIG) throw new Error(`${MODEL} only supports ${SIZES.join(", ")}.`);
  const m = /^(\d{3,4})x(\d{3,4})$/.exec(size || "");
  if (!m) throw new Error(`Size must look like 2048x2048.`);
  const w = +m[1], h = +m[2];
  if (w % 16 || h % 16) throw new Error("Both sides must be divisible by 16.");
  if (Math.max(w, h) > 3840 || w * h > 3840 * 2160) throw new Error("Too big: longest side ≤ 3840 and ≤ 8.3 MP.");
  if (Math.max(w, h) / Math.min(w, h) > 3) throw new Error("Aspect ratio must be between 1:3 and 3:1.");
  return size;
}
const QUALITIES = ["low", "medium", "high", "auto"];
async function guardBudget(n) {
  const today = new Date(); today.setUTCHours(0, 0, 0, 0);
  const used = await countSince(today.toISOString());
  if (used + n > MAX_PER_DAY) throw new Error(`Daily image budget reached (${used}/${MAX_PER_DAY} today). Raise MAX_IMAGES_PER_DAY on Railway if this is intended.`);
}
async function resultFor(ids, note) {
  const content = [];
  const lines = [];
  for (const id of ids) {
    const rec = await getImage(id);
    const pv = await preview(rec.bytes);
    lines.push(`• ${id} — ${rec.width || "?"}×${rec.height || "?"} ${rec.mime} — ${imageUrl(id, extOf(rec.mime))}`);
    if (pv) content.push({ type: "image", data: pv.data, mimeType: pv.mimeType });
  }
  content.unshift({ type: "text", text: `${note}\n${lines.join("\n")}\nUse an id above with edit_image to refine, or share the URL to download the full-resolution file.` });
  return { content };
}
async function exportFile(id) {
  const r = await getImage(id); if (!r) return { isError: true, content: [{ type: "text", text: `No image with id ${id}.` }] };
  const jpg = r.mime === "image/jpeg" ? r.bytes : await sharp(r.bytes).jpeg({ quality: 92, chromaSubsampling: "4:4:4" }).toBuffer();
  return { content: [{ type: "text", text: `${id} — ${r.width}×${r.height} JPEG, ${Math.round(jpg.length / 1024)} KB — ${r.title || ""}` }, { type: "image", data: jpg.toString("base64"), mimeType: "image/jpeg" }] };
}
async function runCompose({ blocks, width = 1800, height, format = "jpeg", title }) {
  try {
    const ids = [];
    const cache = {};
    const getBytes = async (id) => {
      if (!id) throw new Error("A photo block is missing image_id.");
      if (!cache[id]) { const r = await getImage(id); if (!r) throw new Error(`No image with id ${id}.`); cache[id] = r; ids.push(id); }
      return cache[id].bytes;
    };
    const out = await composeEmail({ width, height, blocks, format }, getBytes);
    const first = cache[ids[0]] || {};
    const nid = await saveImage({ kind: "edited", title: (title || `email-section-${out.width}x${out.height}`).slice(0, 160), prompt: null, model: "compose", size: `${out.width}x${out.height}`, quality: null, mime: out.mime, bytes: out.bytes, width: out.width, height: out.height, parents: ids, folder: first.folder || null, meta: { blocks, notes: out.notes, natural_height: out.natural_height } });
    return resultFor([nid], `Composed ${out.width}×${out.height} from ${ids.length} photo${ids.length === 1 ? "" : "s"} (natural height ${out.natural_height}px${out.notes.length ? "; " + out.notes.join("; ") : ""}; no generation cost).`);
  } catch (e) { return { isError: true, content: [{ type: "text", text: `compose_email: ${e.message}` }] }; }
}
function buildServer() {
  const server = new McpServer({ name: "ad-studio", version: VERSION });

  server.registerTool("generate_image", {
    title: "Generate image",
    description: `Create one or more images from a text prompt with OpenAI's ${MODEL}. Never use this for images that show a Larkspur product — use edit_image with products so the real product photos and tech pack are attached. Good for lifestyle ad scenes, product mock-ups, social creatives, and images that contain short text (check spelling in the result). Returns a preview of each image plus a URL to the full-resolution file. Sizes: 1024x1024 (square), 1536x1024 (landscape), 1024x1536 (portrait). Quality: low (cheap draft), medium (default), high (final). Costs real money per image (roughly $0.01–$0.25 each).`,
    inputSchema: {
      prompt: z.string().min(3).max(32000).describe("Full description: subject, scene, lighting, mood, colours, composition, any text to render (in quotes), and what to avoid."),
      size: z.string().default(BIG ? "2048x2048" : "1024x1024").describe(SIZE_HELP),
      quality: z.enum(QUALITIES).default("medium"),
      n: z.number().int().min(1).max(4).default(1).describe("How many variations (1–4)."),
      background: z.enum(["opaque", "transparent"]).default("opaque").describe("transparent = PNG cut-out with no background (for compositing)."),
      title: z.string().max(120).optional().describe("Short label shown in the gallery, e.g. 'Outlet 70% off — pile of footies v2'."),
    },
  }, async ({ prompt, size, quality, n, background, title }) => {
    size = checkSize(size);
    try {
      await guardBudget(n);
      const j = await openaiGenerate({ prompt, size, quality, n, background });
      const ids = [];
      for (const d of j.data || []) {
        const bytes = Buffer.from(d.b64_json, "base64");
        const dm = await dims(bytes);
        ids.push(await saveImage({ kind: "generated", title, prompt, model: MODEL, size, quality, mime: "image/png", bytes, ...dm, meta: { usage: j.usage || null, background } }));
      }
      return resultFor(ids, `Generated ${ids.length} image${ids.length === 1 ? "" : "s"} (${MODEL}, ${size}, ${quality}).`);
    } catch (e) { return { isError: true, content: [{ type: "text", text: e.message }] }; }
  });

  server.registerTool("edit_image", {
    title: "Edit image",
    description: `PRODUCT FAILSAFE: list every Larkspur product in the image under products — Ad Studio pulls its original photos fresh from the store and adds its tech pack; images Ad Studio already made are refused as sources. Edit, extend, restyle or combine existing images (uploads from the Ad Studio page or earlier generations) using a text instruction. With input_fidelity=high (default) faces, products and fine details in the source are preserved closely — use this to change a background, add a scene, place a product, or make a variation while keeping the subject exact. Optional mask: a PNG the same size as the first image where TRANSPARENT pixels mark the area to repaint and opaque pixels are kept. Pass image ids (e.g. "aB3dE9fG") — see list_images for what's available.`,
    inputSchema: {
      prompt: z.string().min(3).max(32000).describe("What to change or create. Say explicitly what must stay identical (e.g. 'keep the baby and the purple footie exactly as they are; only replace the background')."),
      image_ids: z.array(z.string()).min(1).max(8).describe("Ids of the source image(s). The first is the main image; others are references (e.g. a product shot to place in the scene)."),
      mask_id: z.string().optional().describe("Id of an uploaded mask PNG (transparent = repaint, opaque = keep). Omit to let the model decide from the prompt."),
      size: z.string().default("auto").describe(SIZE_HELP),
      quality: z.enum(QUALITIES).default("medium"),
      n: z.number().int().min(1).max(4).default(1),
      input_fidelity: z.enum(["high", "low"]).default("high").describe("high = preserve the source subject closely (faces, garments, logos). low = looser, more creative."),
      products: z.array(z.object({ name: z.string().describe("Exact store product title (e.g. 'Zipper Romper in Twinkle Night') or its product link."), size: z.string().optional().describe("Tech-pack size to show, e.g. '12-18M', 'M'. Default: middle size.") })).optional()
        .describe("REQUIRED whenever a Larkspur product appears. Ad Studio pulls each product's original photos fresh from the store, attaches them after your images, and adds its tech pack + construction rules to the prompt."),
      no_products: z.boolean().default(false).describe("Set true only when no Larkspur product appears in the image."),
      allow_created_source: z.boolean().default(false).describe("Allow an image Ad Studio already made as a source. Only for zoomed catalog close-ups of an approved image the user asked for — garments still come from the fresh product photos."),
      title: z.string().max(120).optional(),
    },
  }, async ({ prompt, image_ids, mask_id, size, quality, n, input_fidelity, products, no_products, allow_created_source, title }) => {
    // Clients with an older tool list can reach compose_email through edit_image: prompt = "COMPOSE EMAIL" + JSON spec. No AI cost.
    if (/^\s*EXPORT FILE\s*$/i.test(prompt || "")) return exportFile(image_ids[0]);   // older clients: hand over the full-size file, no AI cost
    const cm = /^\s*COMPOSE EMAIL\s*([\s\S]*)$/i.exec(prompt || "");
    if (cm) {
      let spec; try { spec = JSON.parse(cm[1]); } catch (e) { return { isError: true, content: [{ type: "text", text: `COMPOSE EMAIL: the spec after the first line must be JSON (${e.message}).` }] }; }
      return runCompose({ title, ...spec });
    }
    size = checkSize(size);
    try {
      // Clients with an older copy of this tool's schema can't send the new fields — accept them as prompt lines too:
      //   PRODUCTS: Zipper Romper in Twinkle Night @12-18M | Women's Long Sleeve Pajamas in Twinkle Night @M
      //   NO PRODUCTS        ALLOW CREATED SOURCE
      const pm = prompt.match(/^\s*PRODUCTS:\s*(.+)$/im);
      if (pm && !(products && products.length)) products = pm[1].split("|").map((x) => x.trim()).filter(Boolean).map((x) => { const [name, size] = x.split("@").map((y) => y.trim()); return { name, size: size || undefined }; });
      if (/^\s*NO PRODUCTS\s*$/im.test(prompt)) no_products = true;
      if (/^\s*ALLOW CREATED SOURCE\s*$/im.test(prompt)) allow_created_source = true;
      const cm2 = prompt.match(/^\s*CONCEPT:\s*([\w-]+)\s*$/im);
      prompt = prompt.replace(/^\s*(PRODUCTS:.*|NO PRODUCTS|ALLOW CREATED SOURCE|CONCEPT:.*)\s*$/gim, "").trim();
      if (cm2) { const blk = playbook.conceptBlock(cm2[1]); if (!blk) throw new Error(`Unknown concept "${cm2[1]}". Options: ${playbook.CONCEPTS.map((c) => c.key).join(", ")}`); prompt += blk; }
      if (!no_products && !(products && products.length)) throw new Error("Product failsafe: list every Larkspur product in this image under products (exact store titles) — or a prompt line \"PRODUCTS: Title @size | Title @size\" — or set no_products=true / a line \"NO PRODUCTS\" if there are none.");
      const images = [];
      for (const id of image_ids) {
        const r = await getImage(id); if (!r) throw new Error(`No image with id ${id}. Use list_images.`);
        if (isCreatedImage(r) && !allow_created_source) throw new Error(`Product failsafe: ${id} is an image Ad Studio already made (or our AI image re-imported). New images must start from original photos — use the original model/scene photo and let the products be pulled fresh. (allow_created_source=true or a line \"ALLOW CREATED SOURCE\" is only for catalog close-ups of an approved image the user asked for.)`);
        images.push(r);
      }
      let checks = [];
      if (products && products.length) {
        const fresh = await freshProductRefs(products);
        if (images.length + fresh.refs.length > 16) throw new Error("Too many images: keep your own sources to a few; each product adds up to 2 photos.");
        const order = fresh.refs.map((x, k) => `image ${images.length + k + 1} = ${x.label} (original product photo)`).join("; ");
        prompt += `\n\nPRODUCT FAILSAFE — the garments must match the attached ORIGINAL product photos exactly (${order}): same print, colours, trim, piping, zipper and construction. Copy garments ONLY from those product photos, never from any other image. Product specs from the factory tech packs:\n${fresh.specs.join("\n\n")}`;
        images.push(...fresh.refs);
        checks = fresh.notes;
      }
      await guardBudget(n);
      const mask = mask_id ? await getImage(mask_id) : null;
      if (mask_id && !mask) throw new Error(`No mask with id ${mask_id}.`);
      const j = await openaiEdit({ prompt, images, mask, size, quality, n, inputFidelity: input_fidelity });
      const ids = [];
      for (const d of j.data || []) {
        const bytes = Buffer.from(d.b64_json, "base64");
        const dm = await dims(bytes);
        ids.push(await saveImage({ kind: "edited", title, prompt, model: MODEL, size, quality, mime: "image/png", bytes, ...dm, parents: image_ids, meta: { usage: j.usage || null, mask_id: mask_id || null, input_fidelity, products: products || null, product_checks: checks } }));
      }
      return resultFor(ids, `Edited → ${ids.length} image${ids.length === 1 ? "" : "s"} (${MODEL}${supportsFidelity(MODEL) ? `, fidelity ${input_fidelity}` : ""}).${checks.length ? `\nProduct failsafe: ${checks.join(" | ")}. Check the result against the tech pack before showing it.` : ""}`);
    } catch (e) { return { isError: true, content: [{ type: "text", text: e.message }] }; }
  });


  server.registerTool("fetch_product", {
    title: "Fetch product from a store link",
    description: "Read a Shopify product page URL (larkspurbaby.com / larkspurbabyoutlet.com) and return its title, price, compare-at price, sizes, a short description, and image URLs. Then pass an image URL to import_image to bring the photo into Ad Studio for editing.",
    inputSchema: { url: z.string().url().describe("Product page URL, e.g. https://larkspurbabyoutlet.com/products/zip-footie-in-deep-mauve-bb11") },
  }, async ({ url }) => {
    try {
      const u = new URL(url); const m = u.pathname.match(/\/products\/([^\/?#]+)/);
      if (!m) return { isError: true, content: [{ type: "text", text: "That isn't a product URL (expected /products/<handle>)." }] };
      const r = await fetch(`${u.origin}/products/${m[1]}.json`, { headers: { Accept: "application/json" } });
      if (!r.ok) return { isError: true, content: [{ type: "text", text: `Store returned HTTP ${r.status} for ${u.origin}/products/${m[1]}.json` }] };
      const p = (await r.json()).product;
      const v0 = (p.variants || [])[0] || {};
      const desc = String(p.body_html || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 600);
      const out = {
        title: p.title, handle: p.handle, product_type: p.product_type, vendor: p.vendor, store: u.hostname,
        price: v0.price, compare_at_price: v0.compare_at_price,
        variants: (p.variants || []).map((v) => ({ title: v.title, price: v.price, compare_at_price: v.compare_at_price, available: v.available })),
        tags: p.tags, description: desc,
        images: (p.images || []).map((i) => ({ src: i.src.split("?")[0], width: i.width, height: i.height, alt: i.alt })),
        url: `${u.origin}/products/${p.handle}`,
      };
      return { content: [{ type: "text", text: JSON.stringify(out, null, 2) }] };
    } catch (e) { return { isError: true, content: [{ type: "text", text: `Couldn't read that product: ${e.message}` }] }; }
  });

  server.registerTool("import_image", {
    title: "Import an image from a URL",
    description: "Download an image from a public URL (e.g. a Shopify product photo from fetch_product) into Ad Studio so it can be used with edit_image. Returns the new image id and a preview.",
    inputSchema: { url: z.string().url(), title: z.string().max(120).optional() },
  }, async ({ url, title }) => {
    try {
      const r = await fetch(url, { headers: { Accept: "image/*" } });
      if (!r.ok) return { isError: true, content: [{ type: "text", text: `HTTP ${r.status} fetching the image.` }] };
      const mime = (r.headers.get("content-type") || "").split(";")[0].trim();
      if (!/^image\/(png|jpeg|webp)$/.test(mime)) return { isError: true, content: [{ type: "text", text: `Not a PNG/JPEG/WebP image (got ${mime || "unknown"}).` }] };
      const bytes = Buffer.from(await r.arrayBuffer());
      if (bytes.length > 30 * 1024 * 1024) return { isError: true, content: [{ type: "text", text: "Image is over 30 MB." }] };
      const dm = await dims(bytes);
      const id = await saveImage({ kind: "upload", title: title || decodeURIComponent(url.split("/").pop().split("?")[0]).slice(0, 120), mime, bytes, ...dm, meta: { source_url: url } });
      return resultFor([id], `Imported ${dm.width || "?"}×${dm.height || "?"} ${mime}.`);
    } catch (e) { return { isError: true, content: [{ type: "text", text: `Import failed: ${e.message}` }] }; }
  });

  server.registerTool("make_formats", {
    title: "Make ad formats (free)",
    description: "Finish an approved ad as a delivery size WITHOUT any AI generation or cost. Workflow: approve the 1:1 first; then generate the SAME ad once at 1024x1536 (same photo, same copy, subject and text inside the middle 80%); then call this on that portrait image to get the 1080x1920 story (9:16) — it adds a soft blurred continuation of the image's own edge top and bottom, never a mirrored copy. Do not ask the model to extend or re-crop an image; use this instead.",
    inputSchema: { id: z.string().describe("Id of the approved image (usually a 1:1 or 1024×1536 edit)."), formats: z.array(z.enum(["1:1", "4:5", "9:16"])).default(["9:16"]) },
  }, async ({ id, formats }) => {
    try {
      const r = await getImage(id); if (!r) throw new Error(`No image with id ${id}.`);
      const sizes = { "1:1": [1080, 1080], "4:5": [1080, 1350], "9:16": [1080, 1920] };
      const ids = [];
      for (const f of formats) {
        const [W, H] = sizes[f];
        const bytes = await toFormat(r.bytes, W, H);
        ids.push(await saveImage({ kind: "edited", title: `${r.title || id} — ${f}`, prompt: null, model: "format", size: `${W}x${H}`, quality: null, mime: "image/png", bytes, width: W, height: H, parents: [id], meta: { format: f, source: id } }));
      }
      return resultFor(ids, `Formats from ${id}: ${formats.join(", ")} (no generation cost).`);
    } catch (e) { return { isError: true, content: [{ type: "text", text: e.message }] }; }
  });

  server.registerTool("enhance", {
    title: "Enhance for ads (upscale + clarity + grain)",
    description: `Finish an approved image for delivery WITHOUT any AI generation cost: upscales ×2 (or ×4), adds local contrast so it doesn't look flat, sharpens edges without halos, and lays fine photographic grain over smooth AI surfaces. ${hasAIUpscaler() ? "An AI upscaler (Replicate Real-ESRGAN) is configured and recovers real detail." : "Upscaling is a clean Lanczos resample (set REPLICATE_API_TOKEN on Railway to enable AI detail recovery)."} Use this as the LAST step on the picked image — e.g. a 1024×1024 edit becomes a crisp 2048×2048 JPEG ready for Meta. Run make_formats BEFORE enhance if you need 9:16.`,
    inputSchema: {
      id: z.string().describe("Id of the approved image."),
      scale: z.union([z.literal(2), z.literal(4)]).default(2).describe("2 = double (1024→2048, recommended), 4 = quadruple (large files)."),
      upscaler: z.enum(["auto", "ai", "resample"]).default("auto").describe("auto = AI when configured, else resample."),
      clarity: z.number().min(0).max(2).default(1).describe("Local contrast / 'pop'. 0 off, 1 default, 2 strong."),
      sharpen: z.number().min(0).max(2).default(1).describe("Edge sharpening. 0 off, 1 default, 2 strong."),
      grain: z.number().min(0).max(2).default(0).describe("Fine film grain. 0 off (default), 1 light, 2 strong."),
      contrast: z.number().min(0.5).max(2).default(1.08).describe("Global contrast; 1 = unchanged."),
      saturation: z.number().min(0).max(2).default(1.04).describe("Colour saturation; 1 = unchanged."),
      format: z.enum(["jpeg", "png"]).default("jpeg").describe("jpeg (quality 93, small, what Meta wants) or png (lossless, large)."),
      title: z.string().max(120).optional(),
    },
  }, async ({ id, scale, upscaler, clarity, sharpen, grain, contrast, saturation, format, title }) => {
    try {
      const r = await getImage(id); if (!r) throw new Error(`No image with id ${id}.`);
      const out = await enhance(r.bytes, { scale, upscaler, clarity, sharpen, grain, contrast, saturation, format, publicUrl: imageUrl(id, extOf(r.mime)) });
      const nid = await saveImage({ kind: "edited", title: title || `${r.title || id} — enhanced ×${scale}`, prompt: null, model: "enhance", size: `${out.width}x${out.height}`, quality: null, mime: out.mime, bytes: out.bytes, width: out.width, height: out.height, parents: [id], meta: { source: id, notes: out.notes, scale, upscaler } });
      return resultFor([nid], `Enhanced ${id} → ${out.width}×${out.height} (${out.notes.join(" · ")}; no generation cost).`);
    } catch (e) { return { isError: true, content: [{ type: "text", text: e.message }] }; }
  });

  server.registerTool("list_images", {
    title: "List images",
    description: "Recent images in Ad Studio: uploads (photos the user added on the Ad Studio page), generations and edits. Returns ids, titles, prompts and URLs — no pixels. Use get_image to look at one.",
    inputSchema: { limit: z.number().int().min(1).max(60).default(20), kind: z.enum(["upload", "generated", "edited"]).optional() },
  }, async ({ limit, kind }) => {
    const rows = await listImages(limit, kind || null);
    if (!rows.length) return { content: [{ type: "text", text: "No images yet. Upload photos at the Ad Studio page or call generate_image." }] };
    const text = rows.map((r) => `${r.id}  [${r.kind}]${r.favorite ? " ★" : ""}${r.folder ? `  📁 ${r.folder}` : ""}${r.product_title ? `  🔗 ${r.product_title}` : ""}  ${r.title || (r.prompt ? r.prompt.slice(0, 70) : "")}  ${r.width || "?"}×${r.height || "?"}  ${new Date(r.created_at).toISOString().slice(0, 16).replace("T", " ")}  ${imageUrl(r.id, extOf(r.mime))}`).join("\n");
    return { content: [{ type: "text", text }] };
  });

  server.registerTool("get_image", {
    title: "Look at an image",
    description: "Show a preview of one stored image (upload, generation or edit) so you can inspect it before editing or presenting it.",
    inputSchema: { id: z.string() },
  }, async ({ id }) => {
    const r = await getImage(id); if (!r) return { isError: true, content: [{ type: "text", text: `No image with id ${id}.` }] };
    const m = r.meta || {};
    const facts = [`${r.width || "?"}×${r.height || "?"} ${r.mime}, ${Math.round((r.bytes ? r.bytes.length : 0) / 1024)} KB`, r.model ? `made by: ${r.model}` : null,
      (r.parents || []).length ? `made from: ${r.parents.join(", ")}` : null,
      m.crop ? `crop box: x ${(+m.crop.x).toFixed(3)} y ${(+m.crop.y).toFixed(3)} w ${(+m.crop.w).toFixed(3)} h ${(+m.crop.h).toFixed(3)} (fractions of the source)` : null,
      m.preset ? `preset: ${m.preset}, mode: ${m.mode}` : null, m.notes && m.notes.length ? `notes: ${m.notes.join("; ")}` : null,
      r.product_title ? `product: ${r.product_title}` : null, r.folder ? `folder: ${r.folder}` : null].filter(Boolean).join("\n");
    return resultFor([id], `${r.kind}${r.title ? ` — ${r.title}` : ""}\n${facts}${r.prompt ? `\nPrompt: ${r.prompt.slice(0, 400)}` : ""}`);
  });

  server.registerTool("resize_image", {
    title: "Resize for a placement (free)",
    description: `Make a delivery-size copy of an image for a specific placement, with no AI generation and no cost. Presets: ${Object.entries(PRESETS).map(([k, v]) => `${k} = ${v.label} ${v.ratio} (${v.w}×${v.h})`).join("; ")}; or preset "custom" with width and height. mode "crop" fills the frame by cropping — position picks which part to keep (center/top/bottom/left/right). mode "extend" keeps the whole image and fills the extra space with a soft blurred continuation of its edges. The copy is saved as a JPEG in the same folder as the source, named <source title>-<preset>-<W>x<H> unless a title is given. email-hero (900×1700) also stamps the Larkspur logo in the same top-centre spot every time — keep the top ~7% of the photo clear for it.`,
    inputSchema: {
      id: z.string().describe("Id of the image to resize."),
      preset: z.enum([...Object.keys(PRESETS), "custom"]).default("ig-portrait"),
      width: z.number().int().min(64).max(4096).optional().describe("Only with preset custom."),
      height: z.number().int().min(64).max(4096).optional().describe("Only with preset custom."),
      mode: z.enum(["crop", "extend"]).default("crop"),
      position: z.enum(["center", "top", "bottom", "left", "right"]).default("center").describe("Which part to keep when cropping."),
      full_quality: z.boolean().default(false).describe("Keep every pixel the photo has (same shape as the preset, larger than its standard pixel size, up to 4096 px). Sharper; still fine to upload."),
      logo: z.enum([...(LOGOS.length ? LOGOS : ["dark-navy"]), "none"]).optional().describe("Stamp the Larkspur logo at the fixed email-hero spot (top centre). email-hero adds dark-navy by default; use a light-* version on dark photos, or none."),
      title: z.string().max(160).optional(),
    },
  }, async ({ id, preset, width, height, mode, position, full_quality, logo, title }) => {
    try {
      const r = await getImage(id); if (!r) throw new Error(`No image with id ${id}.`);
      if (preset === "custom" && !(width && height)) throw new Error("Custom size needs width and height.");
      const out = await resizeAndSave(r, { preset, width: preset === "custom" ? width : undefined, height: preset === "custom" ? height : undefined, mode, position, full: full_quality, logo, title });
      return resultFor([out.id], `Resized ${id} → ${out.width}×${out.height} (${mode}${out.notes.length ? "; " + out.notes.join("; ") : ""}; no generation cost).`);
    } catch (e) { return { isError: true, content: [{ type: "text", text: e.message }] }; }
  });

  server.registerTool("compose_email", {
    title: "Lay out an email section (free, real type)",
    description: `Build an email section the way real brand emails are made: existing photos placed in a clean layout with REAL fonts, buttons, colour panels and small hand-written callouts set in code — no AI generation, no cost. Use this for email pages instead of asking edit_image to paint headlines, stickers, doodles or buttons into a photo (that reads as AI). Photos should be clean shots with NO text in them. Width defaults to 1800; give height to pad/trim to an exact size (the result says the natural height so you can tune photo heights).
Blocks are stacked top to bottom. Every size scales with the width. Colours: hex or ${Object.keys(COLORS).join(", ")}.
• {type:"bar", text, bg?, color?} — thin promo strip.
• {type:"logo", variant?:"dark-navy", width?:0.36, bg?} — Larkspur logo row.
• {type:"text", eyebrow?, script?, headline?, body?, button?|buttons?, bg?, color?, headline_size?:0.072} — centred copy panel; "\\n" breaks lines; script = small hand-written line above the headline.
• {type:"photo", image_id, height?: ratio of width (≤3) or px, focus_x?, focus_y?, zoom?, inset?: fraction of width, callouts?:[{text, x, y, arrow?: up|down|left|right|down-left|down-right|up-left|up-right, color?}], button?} — full-width (or inset) photo; callouts are thin hand-written notes with arrows (x,y = fractions of the photo; put them on plain background areas).
• {type:"split", image_id, side:"left"|"right" (photo side), height?: ratio of half-width, eyebrow?, headline, body?, button?, bg?} — photo half + copy half (checkerboard rows).
• {type:"pair", items:[{image_id, label?, sub?, button?, focus_y?}…2-3], ratio?:1.25, bg?} — product tiles side by side.
• {type:"links", buttons:[…], button_bg?, bg?} — 2-column quick-link buttons.
• {type:"spacer", height, bg?}.
Buttons are a label string or {label, bg?, color?}.`,
    inputSchema: {
      blocks: z.array(z.object({ type: z.enum(["bar", "logo", "text", "photo", "split", "pair", "links", "spacer"]) }).passthrough()).min(1).max(30),
      width: z.number().int().min(320).max(3000).default(1800),
      height: z.number().int().min(100).max(12000).optional().describe("Exact output height; pads with the last block's colour or trims the bottom."),
      format: z.enum(["jpeg", "png"]).default("jpeg"),
      title: z.string().max(160).optional(),
    },
  }, async (args) => runCompose(args));

  server.registerTool("ad_playbook", {
    title: "Creative playbook for Meta ads",
    description: "The creative playbook Ad Studio follows for ads, built from the top ads of Little Sleepies, Posh Peanut and Kyte Baby: rules (real-life look, one emotion per ad, no text painted on photos, funnel coverage) and concepts from soft/emotional to purchase intent, each with a scene recipe and copy formulas. Read it before planning ad creatives. Use a concept by adding a line \"CONCEPT: <key>\" to an edit_image prompt.",
    inputSchema: { intent: z.enum(["soft", "mid", "purchase"]).optional().describe("Only concepts for this part of the funnel.") },
  }, async ({ intent }) => ({ content: [{ type: "text", text: playbook.playbookText(intent) }] }));

  server.registerTool("export_image", {
    title: "Hand over the full-size file",
    description: "Return one stored image as the full-resolution file (JPEG, quality 92; PNGs are converted) so it can be saved and uploaded elsewhere (e.g. into Meta Ads Manager). Use get_image just to look at an image.",
    inputSchema: { id: z.string() },
  }, async ({ id }) => {
    const r = await getImage(id); if (!r) return { isError: true, content: [{ type: "text", text: `No image with id ${id}.` }] };
    const jpg = r.mime === "image/jpeg" ? r.bytes : await sharp(r.bytes).jpeg({ quality: 92, chromaSubsampling: "4:4:4" }).toBuffer();
    return { content: [{ type: "text", text: `${id} — ${r.width}×${r.height} JPEG, ${Math.round(jpg.length / 1024)} KB — ${r.title || ""}` }, { type: "image", data: jpg.toString("base64"), mimeType: "image/jpeg" }] };
  });

  server.registerTool("organize_images", {
    title: "Rename / file / favorite images",
    description: "Organize images in Ad Studio: move them into a folder (folder: \"\" to unfile), mark or unmark them as favorites, link them to a store product (product_url), or rename one image (title, only with a single id). Use when the user asks to file, star, link or rename images.",
    inputSchema: {
      ids: z.array(z.string()).min(1).max(200),
      folder: z.string().max(60).optional(),
      favorite: z.boolean().optional(),
      title: z.string().max(160).optional(),
      product_url: z.string().optional().describe("Store product page to link these images to (larkspurbaby.com/products/…); \"\" removes the link."),
    },
  }, async ({ ids, folder, favorite, title, product_url }) => {
    const patch = {};
    if (product_url !== undefined) {
      if (!product_url) patch.product_url = null;
      else { try { const pr = await resolveProduct(product_url); patch.product_url = pr.url; patch.product_title = pr.title; } catch (e) { return { isError: true, content: [{ type: "text", text: e.message }] }; } }
    }
    if (folder !== undefined) patch.folder = folder;
    if (favorite !== undefined) patch.favorite = favorite;
    if (title !== undefined) { if (ids.length !== 1) return { isError: true, content: [{ type: "text", text: "Rename one image at a time." }] }; patch.title = title; }
    const n = await updateImages(ids, patch);
    if (patch.title) await relinkAfterRename(ids[0]);
    return { content: [{ type: "text", text: `Updated ${n} of ${ids.length} image${ids.length === 1 ? "" : "s"}.` }] };
  });

  server.registerTool("link_products", {
    title: "Auto-link images to store products",
    description: "Link images that have no product yet to their store product, using the product shot they were made from or the product name in the image title (larkspur-baby-<Product-Name>-<date>). Leave ids out to check every image. New images are linked automatically; use this to backfill or after renaming.",
    inputSchema: { ids: z.array(z.string()).max(500).optional() },
  }, async ({ ids }) => {
    try { const r = await autoLinkAll(ids && ids.length ? ids : null); return { content: [{ type: "text", text: `Checked ${r.checked} unlinked image${r.checked === 1 ? "" : "s"}, linked ${r.linked}.${r.missed.length ? ` No product match for: ${r.missed.slice(0, 60).join(", ")}${r.missed.length > 60 ? " …" : ""}` : ""}` }] }; }
    catch (e) { return { isError: true, content: [{ type: "text", text: e.message }] }; }
  });

  server.registerTool("delete_images", {
    title: "Delete images",
    description: "Permanently delete images from Ad Studio by id (uploads or generations). Only use when the user asks to remove specific images. Their links stop working.",
    inputSchema: { ids: z.array(z.string()).min(1).max(100) },
  }, async ({ ids }) => {
    const n = await deleteImages(ids);
    return { content: [{ type: "text", text: `Deleted ${n} of ${ids.length} image${ids.length === 1 ? "" : "s"}.` }] };
  });

  server.registerTool("usage", {
    title: "Usage & budget",
    description: "How many images were generated today and in the last 30 days, with a rough cost estimate, and the daily budget cap.",
    inputSchema: {},
  }, async () => {
    const today = new Date(); today.setUTCHours(0, 0, 0, 0);
    const month = new Date(Date.now() - 30 * 864e5);
    const [d, m] = [await countSince(today.toISOString()), await countSince(month.toISOString())];
    const rows = await listImages(200);
    const est = rows.filter((r) => r.kind !== "upload" && !["format", "enhance", "resize"].includes(r.model) && new Date(r.created_at) >= month).reduce((s, r) => s + costHint(r.size, r.quality), 0);
    return { content: [{ type: "text", text: `Today: ${d} / ${MAX_PER_DAY} images. Last 30 days: ${m} images ≈ $${est.toFixed(2)} (list-price estimate; see platform.openai.com → Usage for the real number). Model: ${MODEL}.` }] };
  });

  return server;
}

/* ---------------- HTTP ---------------- */
const app = express();
app.set("trust proxy", 1);
app.use(express.json({ limit: "25mb" }));
const authed = (req) => req.params.token === TOKEN || req.query.key === TOKEN || (req.headers.authorization || "").replace(/^Bearer /i, "") === TOKEN;

app.all(`/mcp/:token`, async (req, res) => {
  if (!authed(req)) return res.status(404).send("not found");
  if (req.method === "GET" || req.method === "DELETE") { res.setHeader("Allow", "POST"); return res.status(405).json({ jsonrpc: "2.0", error: { code: -32000, message: "Stateless server: use POST" }, id: null }); }
  if (req.method !== "POST") return res.status(405).end();
  try {
    const server = buildServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on("close", () => { transport.close(); server.close(); });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (e) { console.error("mcp:", e.message); if (!res.headersSent) res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: e.message }, id: null }); }
});

// Full-resolution files (public by id — ids are unguessable 8-char random strings)
app.get("/img/:file", async (req, res) => {
  const id = String(req.params.file).replace(/\.[a-z0-9]+$/i, "");
  const r = await getImage(id); if (!r) return res.status(404).send("not found");
  res.setHeader("Content-Type", r.mime); res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  res.setHeader("Access-Control-Allow-Origin", "*");   // lets Ads Manager / other tools load the file directly (images are already public links)
  const fname = `${(r.title || r.kind).replace(/[^\w.-]+/g, "-").replace(/-+/g, "-").slice(0, 150)}.${extOf(r.mime)}`;
  res.setHeader("Content-Disposition", `${req.query.dl ? "attachment" : "inline"}; filename="${fname}"`);
  res.send(r.bytes);
});
const thumbCache = new Map();               // id:size → JPEG, small LRU so the gallery stays fast
app.get("/thumb/:id", async (req, res) => {
  const s = Math.max(160, Math.min(1600, Number(req.query.s) || 480));
  const key = `${req.params.id}:${s}`;
  let buf = thumbCache.get(key);
  if (!buf) {
    const r = await getImage(req.params.id); if (!r) return res.status(404).end();
    try { buf = await sharp(r.bytes).rotate().resize({ width: s, height: s, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer(); }
    catch { return res.redirect(`/img/${r.id}`); }
    thumbCache.set(key, buf); if (thumbCache.size > 800) thumbCache.delete(thumbCache.keys().next().value);
  }
  res.setHeader("Content-Type", "image/jpeg"); res.setHeader("Cache-Control", "public, max-age=31536000, immutable"); res.send(buf);
});

// Uploads from the page (raw body) — photos the user wants Claude to edit, or masks
app.post("/api/upload", express.raw({ type: ["image/png", "image/jpeg", "image/webp"], limit: "30mb" }), async (req, res) => {
  if (!authed(req)) return res.status(401).json({ error: "bad key" });
  if (!Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ error: "send the image as the request body (PNG/JPEG/WebP)" });
  const mime = req.headers["content-type"].split(";")[0];
  const dm = await dims(req.body);
  const id = await saveImage({ kind: "upload", title: String(req.query.title || req.query.name || "upload").slice(0, 120), mime, bytes: req.body, ...dm });
  res.json({ ok: true, id, url: imageUrl(id, extOf(mime)), ...dm });
});
// ?side=uploads → only uploads; ?side=made → generations, edits, formats and enhanced copies. No side → everything.
app.get("/api/images", async (req, res) => {
  if (!authed(req)) return res.status(401).json({ error: "bad key" });
  const limit = Math.min(Number(req.query.limit || 60), 2000);
  const side = req.query.side;
  let rows;
  if (side === "uploads") rows = await listImages(limit, "upload");
  else if (side === "made") {
    if (pool) rows = (await db(`SELECT id, kind, title, prompt, model, size, quality, mime, width, height, parents, created_at, folder, favorite, sort_order, product_url, product_title, length(bytes) AS bytes_len FROM ad_images WHERE kind <> 'upload' ORDER BY created_at DESC LIMIT $1`, [limit])).rows;
    else rows = (await listImages(100000)).filter((r) => r.kind !== "upload").slice(0, limit);
  } else rows = await listImages(limit);
  res.json({ images: rows });
});
async function deleteImages(ids) {
  ids = [...new Set(ids.map(String).filter(Boolean))].slice(0, 500);
  if (!ids.length) return 0;
  for (const k of [...thumbCache.keys()]) if (ids.includes(k.split(":")[0])) thumbCache.delete(k);
  if (pool) return (await db(`DELETE FROM ad_images WHERE id = ANY($1::text[])`, [ids])).rowCount;
  let n = 0; for (const id of ids) if (mem.delete(id)) n++; return n;
}
app.delete("/api/images/:id", async (req, res) => { if (!authed(req)) return res.status(401).json({ error: "bad key" }); res.json({ ok: true, deleted: await deleteImages([req.params.id]) }); });
// Bulk delete from the page: body { ids: [...] }
app.post("/api/images/delete", async (req, res) => {
  if (!authed(req)) return res.status(401).json({ error: "bad key" });
  const ids = Array.isArray(req.body && req.body.ids) ? req.body.ids : [];
  res.json({ ok: true, deleted: await deleteImages(ids) });
});
// v1.6 — organize + resize from the page
app.patch("/api/images/:id", async (req, res) => { if (!authed(req)) return res.status(401).json({ error: "bad key" }); const n = await updateImages([req.params.id], req.body || {}); if ((req.body || {}).title) await relinkAfterRename(req.params.id); res.json({ ok: true, updated: n }); });
app.post("/api/products/autolink", async (req, res) => { if (!authed(req)) return res.status(401).json({ error: "bad key" }); try { res.json({ ok: true, ...(await autoLinkAll((req.body || {}).ids)) }); } catch (e) { res.status(400).json({ error: e.message }); } });
app.post("/api/images/update", async (req, res) => { if (!authed(req)) return res.status(401).json({ error: "bad key" }); const b = req.body || {}; const { ids, ...patch } = b; delete patch.title; res.json({ ok: true, updated: await updateImages(ids, patch) }); });
app.post("/api/images/order", async (req, res) => { if (!authed(req)) return res.status(401).json({ error: "bad key" }); res.json({ ok: true, ordered: await setOrder((req.body || {}).ids) }); });
app.post("/api/images/:id/resize", async (req, res) => {
  if (!authed(req)) return res.status(401).json({ error: "bad key" });
  try {
    const r = await getImage(req.params.id); if (!r) return res.status(404).json({ error: "not found" });
    if (req.query.preview) {   // exact result, small, not saved — for the page's preview
      const pv = await resizeImage(r.bytes, req.body || {}, (b, W, H) => toFormat(b, W, H));
      const small = await sharp(pv.bytes).resize({ width: 700, height: 700, fit: "inside" }).jpeg({ quality: 80 }).toBuffer();
      res.setHeader("Content-Type", "image/jpeg"); return res.send(small);
    }
    const out = await resizeAndSave(r, req.body || {});
    res.json({ ok: true, id: out.id, url: imageUrl(out.id, "jpg"), width: out.width, height: out.height, notes: out.notes });
  } catch (e) { res.status(400).json({ error: e.message }); }
});
app.get("/api/products", async (req, res) => {
  if (!authed(req)) return res.status(401).json({ error: "bad key" });
  const q = String(req.query.q || "").trim(); if (!q) return res.json({ products: [] });
  try {
    if (/^https?:\/\//i.test(q)) return res.json({ products: [await resolveProduct(q)] });
    res.json({ products: await searchProducts(q) });
  } catch (e) { res.status(400).json({ error: e.message }); }
});
app.get("/api/presets", (_q, r) => r.json({ presets: PRESETS }));
app.get("/api/folders", async (req, res) => { if (!authed(req)) return res.status(401).json({ error: "bad key" }); res.json({ folders: await listFolders() }); });
app.post("/api/folders", async (req, res) => { if (!authed(req)) return res.status(401).json({ error: "bad key" }); const n = cleanFolder((req.body || {}).name); if (!n) return res.status(400).json({ error: "Give the folder a name." }); await ensureFolder(n); res.json({ ok: true, name: n }); });
app.post("/api/folders/rename", async (req, res) => { if (!authed(req)) return res.status(401).json({ error: "bad key" }); try { await renameFolder(req.body.from, req.body.to); res.json({ ok: true }); } catch (e) { res.status(400).json({ error: e.message }); } });
app.post("/api/folders/delete", async (req, res) => { if (!authed(req)) return res.status(401).json({ error: "bad key" }); await deleteFolder((req.body || {}).name); res.json({ ok: true }); });
app.get("/api/version", (_q, r) => r.json({ version: VERSION, model: MODEL }));
app.get("/health", (_q, r) => r.send("ok"));

app.get("/", (_req, res) => res.sendFile(require("path").join(__dirname, "public", "index.html")));   // the page asks for the key itself
app.get("/api/usage", async (req, res) => {
  if (!authed(req)) return res.status(401).json({ error: "bad key" });
  const today = new Date(); today.setUTCHours(0, 0, 0, 0);
  const month = new Date(Date.now() - 30 * 864e5);
  const [d, m] = [await countSince(today.toISOString()), await countSince(month.toISOString())];
  const rows = await listImages(500);
  const cost30 = rows.filter((r) => r.kind !== "upload" && !["format", "enhance", "resize", "compose"].includes(r.model) && new Date(r.created_at) >= month).reduce((s, r) => s + costHint(r.size, r.quality), 0);
  res.json({ today: d, month: m, cap: MAX_PER_DAY, cost30, model: MODEL });
});
app.use(express.static(require("path").join(__dirname, "public"), { index: false }));

migrate().then(() => app.listen(PORT, () => {
  setTimeout(() => autoLinkAll().then((r) => console.log(`🔗 product auto-link: checked ${r.checked}, linked ${r.linked}`)).catch((e) => console.error("🔗 auto-link skipped:", e.message)), 3000);
  console.log(`🎨 Ad Studio v${VERSION} on :${PORT} · model ${MODEL} · daily cap ${MAX_PER_DAY} · db:${pool ? "set" : "none"}`);
  console.log(`🔌 Connector URL for Claude: ${PUBLIC_URL || "https://<your-domain>"}/mcp/<MCP_TOKEN>`);
})).catch((e) => { console.error("boot failed:", e.message); process.exit(1); });
