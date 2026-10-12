/* Ad Studio v1.0 — a small image-generation connector for Claude.
 *
 * What it does
 *   • Exposes an MCP server (Streamable HTTP) at  /mcp/<MCP_TOKEN>  with tools:
 *       generate_image  — text → image(s) with OpenAI's gpt-image model
 *       edit_image      — edit/extend/restyle one or more uploaded or generated images (keeps subjects with input_fidelity=high)
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
 */
const express = require("express");
const crypto = require("crypto");
const { Pool } = require("pg");
const { z } = require("zod");
const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { StreamableHTTPServerTransport } = require("@modelcontextprotocol/sdk/server/streamableHttp.js");

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
  console.log("🗄️  Ad Studio schema ready");
}
const newId = () => crypto.randomBytes(6).toString("base64url");
async function saveImage(rec) {
  const id = newId();
  const row = { id, created_at: new Date().toISOString(), ...rec };
  if (pool) await db(`INSERT INTO ad_images (id,kind,title,prompt,model,size,quality,mime,bytes,width,height,parents,meta) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    [id, rec.kind, rec.title || null, rec.prompt || null, rec.model || null, rec.size || null, rec.quality || null, rec.mime, rec.bytes, rec.width || null, rec.height || null, rec.parents || [], rec.meta || {}]);
  else mem.set(id, row);
  return id;
}
async function getImage(id) {
  if (pool) return (await db(`SELECT * FROM ad_images WHERE id=$1`, [id])).rows[0] || null;
  return mem.get(id) || null;
}
async function listImages(limit = 24, kind = null) {
  if (pool) return (await db(`SELECT id, kind, title, prompt, model, size, quality, mime, width, height, parents, created_at, length(bytes) AS bytes_len FROM ad_images ${kind ? "WHERE kind=$2" : ""} ORDER BY created_at DESC LIMIT $1`, kind ? [limit, kind] : [limit])).rows;
  return [...mem.values()].filter((r) => !kind || r.kind === kind).sort((a, b) => (a.created_at < b.created_at ? 1 : -1)).slice(0, limit).map((r) => ({ ...r, bytes: undefined, bytes_len: r.bytes.length }));
}
async function countSince(iso) {
  if (pool) return Number((await db(`SELECT count(*) FROM ad_images WHERE kind IN ('generated','edited') AND created_at >= $1`, [iso])).rows[0].count);
  return [...mem.values()].filter((r) => r.kind !== "upload" && r.created_at >= iso).length;
}
const imageUrl = (id, ext) => `${PUBLIC_URL || ""}/img/${id}.${ext || "png"}`;
const extOf = (mime) => (mime === "image/jpeg" ? "jpg" : mime === "image/webp" ? "webp" : "png");

/* ---------------- previews (small JPEG so Claude can see the picture without a huge payload) ---------------- */
let Jimp = null;
async function preview(bytes, maxEdge = 768) {
  try {
    if (!Jimp) Jimp = (await import("jimp")).Jimp;
    const im = await Jimp.read(bytes);
    const w = im.bitmap.width, h = im.bitmap.height;
    if (Math.max(w, h) > maxEdge) im.scaleToFit({ w: maxEdge, h: maxEdge });
    const out = await im.getBuffer("image/jpeg", { quality: 78 });
    return { data: out.toString("base64"), mimeType: "image/jpeg", width: w, height: h };
  } catch (e) { return null; }
}
async function dims(bytes) {
  try { if (!Jimp) Jimp = (await import("jimp")).Jimp; const im = await Jimp.read(bytes); return { width: im.bitmap.width, height: im.bitmap.height }; } catch { return {}; }
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
async function openaiEdit({ prompt, images, mask, size, quality, n, inputFidelity, outputFormat }) {
  const fd = new FormData();
  fd.append("model", MODEL); fd.append("prompt", prompt); fd.append("n", String(n)); fd.append("output_format", outputFormat || "png");
  if (size && size !== "auto") fd.append("size", size);
  if (quality && quality !== "auto") fd.append("quality", quality);
  if (inputFidelity) fd.append("input_fidelity", inputFidelity);
  for (const im of images) fd.append("image[]", new Blob([im.bytes], { type: im.mime }), `${im.id}.${extOf(im.mime)}`);
  if (mask) fd.append("mask", new Blob([mask.bytes], { type: "image/png" }), "mask.png");
  const r = await fetch(`${OPENAI_BASE}/images/edits`, { method: "POST", headers: { Authorization: `Bearer ${OPENAI_KEY}` }, body: fd });
  const j = await r.json().catch(() => ({}));
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
function buildServer() {
  const server = new McpServer({ name: "ad-studio", version: VERSION });

  server.registerTool("generate_image", {
    title: "Generate image",
    description: `Create one or more images from a text prompt with OpenAI's ${MODEL}. Good for lifestyle ad scenes, product mock-ups, social creatives, and images that contain short text (check spelling in the result). Returns a preview of each image plus a URL to the full-resolution file. Sizes: 1024x1024 (square), 1536x1024 (landscape), 1024x1536 (portrait). Quality: low (cheap draft), medium (default), high (final). Costs real money per image (roughly $0.01–$0.25 each).`,
    inputSchema: {
      prompt: z.string().min(3).max(32000).describe("Full description: subject, scene, lighting, mood, colours, composition, any text to render (in quotes), and what to avoid."),
      size: z.enum(SIZES).default("1024x1024"),
      quality: z.enum(QUALITIES).default("medium"),
      n: z.number().int().min(1).max(4).default(1).describe("How many variations (1–4)."),
      background: z.enum(["opaque", "transparent"]).default("opaque").describe("transparent = PNG cut-out with no background (for compositing)."),
      title: z.string().max(120).optional().describe("Short label shown in the gallery, e.g. 'Outlet 70% off — pile of footies v2'."),
    },
  }, async ({ prompt, size, quality, n, background, title }) => {
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
    description: `Edit, extend, restyle or combine existing images (uploads from the Ad Studio page or earlier generations) using a text instruction. With input_fidelity=high (default) faces, products and fine details in the source are preserved closely — use this to change a background, add a scene, place a product, or make a variation while keeping the subject exact. Optional mask: a PNG the same size as the first image where TRANSPARENT pixels mark the area to repaint and opaque pixels are kept. Pass image ids (e.g. "aB3dE9fG") — see list_images for what's available.`,
    inputSchema: {
      prompt: z.string().min(3).max(32000).describe("What to change or create. Say explicitly what must stay identical (e.g. 'keep the baby and the purple footie exactly as they are; only replace the background')."),
      image_ids: z.array(z.string()).min(1).max(8).describe("Ids of the source image(s). The first is the main image; others are references (e.g. a product shot to place in the scene)."),
      mask_id: z.string().optional().describe("Id of an uploaded mask PNG (transparent = repaint, opaque = keep). Omit to let the model decide from the prompt."),
      size: z.enum(SIZES).default("auto").describe("Output size; auto keeps the source's aspect."),
      quality: z.enum(QUALITIES).default("medium"),
      n: z.number().int().min(1).max(4).default(1),
      input_fidelity: z.enum(["high", "low"]).default("high").describe("high = preserve the source subject closely (faces, garments, logos). low = looser, more creative."),
      title: z.string().max(120).optional(),
    },
  }, async ({ prompt, image_ids, mask_id, size, quality, n, input_fidelity, title }) => {
    try {
      await guardBudget(n);
      const images = [];
      for (const id of image_ids) { const r = await getImage(id); if (!r) throw new Error(`No image with id ${id}. Use list_images.`); images.push(r); }
      const mask = mask_id ? await getImage(mask_id) : null;
      if (mask_id && !mask) throw new Error(`No mask with id ${mask_id}.`);
      const j = await openaiEdit({ prompt, images, mask, size, quality, n, inputFidelity: input_fidelity });
      const ids = [];
      for (const d of j.data || []) {
        const bytes = Buffer.from(d.b64_json, "base64");
        const dm = await dims(bytes);
        ids.push(await saveImage({ kind: "edited", title, prompt, model: MODEL, size, quality, mime: "image/png", bytes, ...dm, parents: image_ids, meta: { usage: j.usage || null, mask_id: mask_id || null, input_fidelity } }));
      }
      return resultFor(ids, `Edited → ${ids.length} image${ids.length === 1 ? "" : "s"} (${MODEL}, fidelity ${input_fidelity}).`);
    } catch (e) { return { isError: true, content: [{ type: "text", text: e.message }] }; }
  });

  server.registerTool("list_images", {
    title: "List images",
    description: "Recent images in Ad Studio: uploads (photos the user added on the Ad Studio page), generations and edits. Returns ids, titles, prompts and URLs — no pixels. Use get_image to look at one.",
    inputSchema: { limit: z.number().int().min(1).max(60).default(20), kind: z.enum(["upload", "generated", "edited"]).optional() },
  }, async ({ limit, kind }) => {
    const rows = await listImages(limit, kind || null);
    if (!rows.length) return { content: [{ type: "text", text: "No images yet. Upload photos at the Ad Studio page or call generate_image." }] };
    const text = rows.map((r) => `${r.id}  [${r.kind}]  ${r.title || (r.prompt ? r.prompt.slice(0, 70) : "")}  ${r.width || "?"}×${r.height || "?"}  ${new Date(r.created_at).toISOString().slice(0, 16).replace("T", " ")}  ${imageUrl(r.id, extOf(r.mime))}`).join("\n");
    return { content: [{ type: "text", text }] };
  });

  server.registerTool("get_image", {
    title: "Look at an image",
    description: "Show a preview of one stored image (upload, generation or edit) so you can inspect it before editing or presenting it.",
    inputSchema: { id: z.string() },
  }, async ({ id }) => {
    const r = await getImage(id); if (!r) return { isError: true, content: [{ type: "text", text: `No image with id ${id}.` }] };
    return resultFor([id], `${r.kind}${r.title ? ` — ${r.title}` : ""}${r.prompt ? `\nPrompt: ${r.prompt.slice(0, 400)}` : ""}`);
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
    const est = rows.filter((r) => r.kind !== "upload" && new Date(r.created_at) >= month).reduce((s, r) => s + costHint(r.size, r.quality), 0);
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
  res.setHeader("Content-Disposition", `inline; filename="${(r.title || r.kind).replace(/[^\w.-]+/g, "_").slice(0, 60)}-${id}.${extOf(r.mime)}"`);
  res.send(r.bytes);
});
app.get("/thumb/:id", async (req, res) => {
  const r = await getImage(req.params.id); if (!r) return res.status(404).end();
  const pv = await preview(r.bytes, 480); if (!pv) return res.redirect(`/img/${r.id}`);
  res.setHeader("Content-Type", "image/jpeg"); res.setHeader("Cache-Control", "public, max-age=31536000, immutable"); res.send(Buffer.from(pv.data, "base64"));
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
app.get("/api/images", async (req, res) => { if (!authed(req)) return res.status(401).json({ error: "bad key" }); res.json({ images: await listImages(Number(req.query.limit || 60)) }); });
app.delete("/api/images/:id", async (req, res) => { if (!authed(req)) return res.status(401).json({ error: "bad key" }); if (pool) await db(`DELETE FROM ad_images WHERE id=$1`, [req.params.id]); else mem.delete(req.params.id); res.json({ ok: true }); });
app.get("/api/version", (_q, r) => r.json({ version: VERSION, model: MODEL }));
app.get("/health", (_q, r) => r.send("ok"));

app.get("/", (req, res) => {
  if (!authed(req)) return res.status(200).send(`<!doctype html><meta charset="utf-8"><title>Ad Studio</title><body style="font:15px system-ui;padding:40px;color:#333"><h2>Ad Studio</h2><p>Open this page with your key: <code>/?key=…</code> (the same token as in the connector URL).</p>`);
  res.sendFile(require("path").join(__dirname, "public", "index.html"));
});
app.use(express.static(require("path").join(__dirname, "public"), { index: false }));

migrate().then(() => app.listen(PORT, () => {
  console.log(`🎨 Ad Studio v${VERSION} on :${PORT} · model ${MODEL} · daily cap ${MAX_PER_DAY} · db:${pool ? "set" : "none"}`);
  console.log(`🔌 Connector URL for Claude: ${PUBLIC_URL || "https://<your-domain>"}/mcp/<MCP_TOKEN>`);
})).catch((e) => { console.error("boot failed:", e.message); process.exit(1); });
