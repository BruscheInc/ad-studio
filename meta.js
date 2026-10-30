/* meta.js — push ads from Ad Studio to Meta (Facebook / Instagram) through the Marketing API.
 *
 * Env (Railway → Variables):
 *   META_ACCESS_TOKEN   required — a System User token from Business Settings with ads_management + pages_read_engagement
 *   META_AD_ACCOUNT_ID  default ad account, digits only (e.g. 376734051399615)
 *   META_PAGE_ID        Facebook Page the ads run from (found automatically if left out)
 *   META_IG_USER_ID     Instagram account id (found automatically from the page if left out)
 *   META_API_VERSION    default v23.0
 *
 * Ads are created PAUSED unless the caller explicitly asks for ACTIVE, so nothing spends by accident.
 */
const GRAPH = () => `https://graph.facebook.com/${process.env.META_API_VERSION || "v23.0"}`;
const token = () => process.env.META_ACCESS_TOKEN || "";
const act = (id) => `act_${String(id || process.env.META_AD_ACCOUNT_ID || "").replace(/^act_/, "")}`;
const configured = () => !!token();

async function graph(path, { method = "GET", params = {}, form = null } = {}) {
  if (!configured()) throw new Error("Meta isn't connected yet: add META_ACCESS_TOKEN (and META_AD_ACCOUNT_ID) in Railway → ad-studio → Variables.");
  const url = new URL(`${GRAPH()}/${path.replace(/^\//, "")}`);
  let body;
  if (method === "GET") { for (const [k, v] of Object.entries(params)) url.searchParams.set(k, typeof v === "string" ? v : JSON.stringify(v)); url.searchParams.set("access_token", token()); }
  else if (form) { form.append("access_token", token()); body = form; }
  else { const p = new URLSearchParams(); for (const [k, v] of Object.entries(params)) p.set(k, typeof v === "string" ? v : JSON.stringify(v)); p.set("access_token", token()); body = p; }
  const r = await fetch(url, { method, body });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) {
    const e = j.error || {};
    throw new Error(`Meta: ${e.error_user_msg || e.message || "HTTP " + r.status}${e.error_user_title ? ` (${e.error_user_title})` : ""}`);
  }
  return j;
}

async function status() {
  if (!configured()) return { connected: false, reason: "META_ACCESS_TOKEN is not set" };
  try {
    const a = await graph(act(), { params: { fields: "name,account_status,currency,business{name}" } });
    const ids = await identity().catch((e) => ({ error: e.message }));
    return { connected: true, account: { id: act(), name: a.name, currency: a.currency, status: a.account_status, business: a.business && a.business.name }, ...ids };
  } catch (e) { return { connected: false, reason: e.message }; }
}

let idCache = null;
/** Page + Instagram account to run ads from. Uses env when set, otherwise asks Meta. */
async function identity() {
  if (idCache) return idCache;
  let page_id = process.env.META_PAGE_ID || null, ig_user_id = process.env.META_IG_USER_ID || null, page_name = null;
  if (!page_id) {
    const pages = await graph(`${act()}/promote_pages`, { params: { fields: "id,name", limit: "25" } });
    const pick = (pages.data || []).find((p) => /larkspur/i.test(p.name)) || (pages.data || [])[0];
    if (pick) { page_id = pick.id; page_name = pick.name; }
  }
  if (page_id && !ig_user_id) {
    try { const p = await graph(page_id, { params: { fields: "name,instagram_business_account" } }); page_name = page_name || p.name; ig_user_id = p.instagram_business_account && p.instagram_business_account.id; } catch (_) {}
  }
  idCache = { page_id, page_name, ig_user_id };
  return idCache;
}

async function campaigns(accountId) {
  const r = await graph(`${act(accountId)}/campaigns`, { params: { fields: "id,name,status,effective_status,objective", limit: "200", effective_status: ["ACTIVE", "PAUSED"] } });
  return r.data || [];
}
async function adsets(campaignId) {
  const r = await graph(`${campaignId}/adsets`, { params: { fields: "id,name,status,effective_status", limit: "200" } });
  return r.data || [];
}

/** Upload image bytes to the ad account's library; returns the image hash. */
async function uploadImage(bytes, filename, accountId) {
  const form = new FormData();
  form.append("filename", new Blob([bytes], { type: "image/jpeg" }), filename || "ad.jpg");
  const r = await graph(`${act(accountId)}/adimages`, { method: "POST", form });
  const first = Object.values(r.images || {})[0];
  if (!first || !first.hash) throw new Error("Meta: image upload returned no hash.");
  return first.hash;
}

const CTA = { "shop now": "SHOP_NOW", "learn more": "LEARN_MORE", "see details": "SEE_DETAILS", "order now": "ORDER_NOW", "get offer": "GET_OFFER", "sign up": "SIGN_UP", "buy now": "BUY_NOW", "see more": "SEE_MORE" };
const ctaType = (c) => CTA[String(c || "shop now").trim().toLowerCase()] || String(c || "SHOP_NOW").toUpperCase().replace(/\s+/g, "_");

/**
 * Create creative + ad in an ad set.
 * ad: { name, primary_text, headline, description, cta, url }   image: { bytes, filename }
 */
async function pushAd({ ad, image, adsetId, status = "PAUSED", accountId, aiDisclosure = true }) {
  if (!adsetId) throw new Error("Pick the ad set to add this ad to.");
  if (!ad.url) throw new Error("The ad needs a website link (url).");
  if (!ad.primary_text) throw new Error("The ad needs primary text.");
  const ids = await identity();
  if (!ids.page_id) throw new Error("Meta: couldn't find the Facebook Page — set META_PAGE_ID.");
  const hash = await uploadImage(image.bytes, image.filename, accountId);
  const link_data = { link: ad.url, message: ad.primary_text, image_hash: hash, call_to_action: { type: ctaType(ad.cta), value: { link: ad.url } } };
  if (ad.headline) link_data.name = ad.headline;
  if (ad.description) link_data.description = ad.description;
  const spec = { page_id: ids.page_id, link_data };
  if (ids.ig_user_id) spec.instagram_user_id = ids.ig_user_id;
  const creativeParams = { name: `${ad.name || "Ad Studio ad"} — creative`, object_story_spec: spec };
  let creative;
  try {
    // AI disclosure: mark the creative as containing AI-generated media (Meta's "AI info").
    creative = await graph(`${act(accountId)}/adcreatives`, { method: "POST", params: aiDisclosure ? { ...creativeParams, contextual_multi_ads: { enroll_status: "OPT_OUT" }, degrees_of_freedom_spec: { creative_features_spec: { standard_enhancements: { enroll_status: "OPT_OUT" } } }, is_ai_generated_media: true } : creativeParams });
  } catch (e) {
    // Older API versions reject the extra fields — retry plain, the disclosure can be ticked in Ads Manager.
    if (!/is_ai_generated_media|degrees_of_freedom|contextual_multi_ads|Invalid parameter/i.test(e.message)) throw e;
    creative = await graph(`${act(accountId)}/adcreatives`, { method: "POST", params: creativeParams });
    creative.disclosure_skipped = true;
  }
  const created = await graph(`${act(accountId)}/ads`, { method: "POST", params: { name: ad.name || "Ad Studio ad", adset_id: adsetId, creative: { creative_id: creative.id }, status: status === "ACTIVE" ? "ACTIVE" : "PAUSED" } });
  return { ad_id: created.id, creative_id: creative.id, image_hash: hash, status: status === "ACTIVE" ? "ACTIVE" : "PAUSED", disclosure_skipped: !!creative.disclosure_skipped };
}

async function adInsights(adIds) {
  if (!adIds.length) return {};
  const out = {};
  for (const id of adIds.slice(0, 50)) {
    try {
      const r = await graph(`${id}`, { params: { fields: "effective_status,insights.date_preset(maximum){spend,impressions,clicks,ctr,actions,action_values,purchase_roas}" } });
      const ins = r.insights && r.insights.data && r.insights.data[0];
      const purchases = ins && (ins.actions || []).find((a) => a.action_type === "omni_purchase" || a.action_type === "purchase");
      const roas = ins && (ins.purchase_roas || [])[0];
      out[id] = { status: r.effective_status, spend: ins ? +ins.spend : 0, impressions: ins ? +ins.impressions : 0, ctr: ins ? +ins.ctr : 0, purchases: purchases ? +purchases.value : 0, roas: roas ? +roas.value : null };
    } catch (e) { out[id] = { error: e.message }; }
  }
  return out;
}

module.exports = { configured, status, identity, campaigns, adsets, pushAd, adInsights };
