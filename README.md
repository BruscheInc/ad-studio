# Ad Studio v1.0

Image generation for Claude, powered by OpenAI's gpt-image model.

- Connector for Claude: `https://<your-domain>/mcp/<MCP_TOKEN>` (Settings → Connectors → Add custom connector)
- Upload page: `https://<your-domain>/?key=<MCP_TOKEN>` — drop in photos you want Claude to edit; see and download everything Claude makes.

Tools Claude gets: fetch_product, import_image, generate_image, edit_image (keeps faces/products with input_fidelity=high), list_images, get_image, usage.

Env (set on Railway): OPENAI_API_KEY, MCP_TOKEN, DATABASE_URL, PUBLIC_URL, OPENAI_IMAGE_MODEL (default gpt-image-1), MAX_IMAGES_PER_DAY (default 80).
