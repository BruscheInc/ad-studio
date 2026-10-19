# Ad Studio v1.6

Image generation for Claude, powered by OpenAI's gpt-image model.

- Connector for Claude: `https://<your-domain>/mcp/<MCP_TOKEN>` (Settings → Connectors → Add custom connector)
- Upload page: `https://<your-domain>/?key=<MCP_TOKEN>` — drop in photos you want Claude to edit; see and download everything Claude makes.

Tools Claude gets: fetch_product, import_image, generate_image, edit_image (keeps faces/products with input_fidelity=high), make_formats (free 1:1 / 4:5 / 9:16), **enhance** (free upscale ×2/×4 + clarity + sharpen (grain optional, off by default) — the last step before an image goes to Meta), list_images, get_image, usage.

Env (set on Railway): OPENAI_API_KEY, MCP_TOKEN, DATABASE_URL, PUBLIC_URL, OPENAI_IMAGE_MODEL (default gpt-image-1), MAX_IMAGES_PER_DAY (default 80).
Optional: STORE_URL (default https://larkspurbaby.com) — store used for product search.
Optional: REPLICATE_API_TOKEN — when set, `enhance` uses an AI upscaler (Real-ESRGAN on replicate.com, a few cents per image) that recovers real detail instead of a plain resample.

## What's new in 1.6.2
- Resize has a **Full quality** option: same shape as the preset, but keeps every pixel the photo has (e.g. 1638×2048 instead of 1080×1350 from a 2048 square, up to 4096 px). `resize_image` takes `full_quality`.
- The viewer shows the actual file instead of a compressed preview.
- Fixed: the crop frame could lose its position when the photo hadn't finished loading.
- `get_image` shows what an image was made from, its crop and its file size.

## What's new in 1.6.1
- Images link to their store product automatically: from the product shot they were made from, or from the product name in the image title (larkspur-baby-<Product-Name>-<date>). Existing images are linked once on startup; renaming re-checks; **🔗 Auto-link products** on the page and the `link_products` tool backfill on demand.

## What's new in 1.6
- **Resize for placements** (free, no AI): Instagram post 1:1, Instagram portrait 4:5, Story / Reel 9:16, Facebook link 1.91:1, Pinterest 2:3, Square HD, or any custom size. *Crop to fill* with a draggable frame and zoom, or *Keep whole image* (extra space filled with a soft blur of the photo's own edges, exact preview). Copies are JPEGs named `<title>-<preset>-<W>x<H>` and land in the same folder. Warns when a size will be enlarged.
- **Organize**: folders (drag cards onto a folder, rename/delete folders), favorites, search, sort (newest / oldest / name / custom order — drag to arrange), group by product, thumbnail size, bulk move / favorite / delete.
- **Product links**: link images to a store product (search larkspurbaby.com or paste a product link); the card links to the product page and resized copies keep the link. Set STORE_URL to use another store.
- **Rename**: double-click a name (or ⋯ → Rename, or in the viewer). The download file name follows the image name.
- Full-size viewer with arrow-key navigation; faster thumbnails (cached, correct phone rotation).
- New connector tools: `resize_image`, `organize_images` (folder / favorite / product link / rename).

## What's new in 1.5
- The page is split into two sides: **Uploaded** (left) and **Generated** (right — generations, edits, formats, enhanced copies). Each side loads its own list, so uploads never get pushed off by new generations.
- Bigger **Delete** button on every image, plus checkboxes, **Select all** and **Delete selected** on each side.
- New `delete_images` tool so Claude can remove images by id when asked.

## What's new in 1.3
- `enhance` tool: the image model tops out at 1024 px on the short side, so a 2000×2000 photo always comes back at 1024×1024. `enhance` takes the approved result to 2048×2048 (or 4096), adds midtone clarity so it doesn't look flat, sharpens without halos. Grain is off by default (pass grain 1–2 to add it). No OpenAI cost; doesn't count against the daily cap.
- New dependency: `sharp` (Railway installs it automatically with `npm install`).
