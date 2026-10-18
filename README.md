# Ad Studio v1.3

Image generation for Claude, powered by OpenAI's gpt-image model.

- Connector for Claude: `https://<your-domain>/mcp/<MCP_TOKEN>` (Settings → Connectors → Add custom connector)
- Upload page: `https://<your-domain>/?key=<MCP_TOKEN>` — drop in photos you want Claude to edit; see and download everything Claude makes.

Tools Claude gets: fetch_product, import_image, generate_image, edit_image (keeps faces/products with input_fidelity=high), make_formats (free 1:1 / 4:5 / 9:16), **enhance** (free upscale ×2/×4 + clarity + sharpen + grain — the last step before an image goes to Meta), list_images, get_image, usage.

Env (set on Railway): OPENAI_API_KEY, MCP_TOKEN, DATABASE_URL, PUBLIC_URL, OPENAI_IMAGE_MODEL (default gpt-image-1), MAX_IMAGES_PER_DAY (default 80).
Optional: REPLICATE_API_TOKEN — when set, `enhance` uses an AI upscaler (Real-ESRGAN on replicate.com, a few cents per image) that recovers real detail instead of a plain resample.

## What's new in 1.3
- `enhance` tool: the image model tops out at 1024 px on the short side, so a 2000×2000 photo always comes back at 1024×1024. `enhance` takes the approved result to 2048×2048 (or 4096), adds midtone clarity so it doesn't look flat, sharpens without halos, and adds fine grain so smooth AI surfaces read as a photo. No OpenAI cost; doesn't count against the daily cap.
- New dependency: `sharp` (Railway installs it automatically with `npm install`).
