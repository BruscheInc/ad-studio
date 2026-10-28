/* garment-guard.js — the product failsafe for every Ad Studio image that shows a Larkspur product.
 *  1. Every product is looked up in the store and its ORIGINAL product photos (not our own AI images, which are
 *     uploaded with names starting "larkspur-baby-") are pulled FRESH from Shopify on every call and attached.
 *  2. Its tech pack (factory measurement sheet) and construction rules are added to the prompt, so sizes, cuffs,
 *     zippers, piping and embroidery are spelled out every time.
 *  3. Images Ad Studio already made can't be used as a source unless explicitly allowed (catalog close-ups of an
 *     approved image) — garments never get copied from an AI image.
 */
const { SPECS } = require("./tech-packs.js");

const ALIASES = [[/\bzip(pered)? footie\b/i, "Zipper Footie"], [/\bsleep sack walker\b/i, "Sleep Bag Walker"], [/\bsleep sack\b/i, "Sleep Bag"]];
const NAMES = SPECS.map((s) => s.name).sort((a, b) => b.length - a.length);
function styleOf(title) {
  const t = String(title || "");
  for (const n of NAMES) if (t.toLowerCase().includes(n.toLowerCase())) return SPECS.find((s) => s.name === n);
  for (const [re, n] of ALIASES) if (re.test(t)) return SPECS.find((s) => s.name === n);
  return null;
}
const row = (spec, label, i) => {
  for (const p of spec.parts) for (const [l, v] of p.rows) if (l.toLowerCase().startsWith(label.toLowerCase())) return v[i];
  return null;
};
const isAiName = (s) => /(^|\/)larkspur-baby-/i.test(String(s || ""));

/** Construction rules that the factory sheets don't spell out, from Jose's corrections. */
function construction(style, spec, i) {
  const c = (l) => row(spec, l, i);
  switch (style) {
    case "Zipper Romper":
    case "Convertible One Piece": {
      const wrist = c("Sleeve cuff height") || 1.5, leg = c("Leg cuff height") || 6;
      return [
        `ZIPPER: exactly ONE zipper. It starts at the centre of the neckline, runs straight down the front, then continues down the WEARER'S OWN LEFT LEG to the top of the left ankle cuff (if the child faces the camera that is the leg on the RIGHT side of the image). The other leg has NO zipper. If the left leg is hidden, show no zipper on the visible leg.`,
        `ZIPPER GARAGE: a small soft fabric hood folded over the zipper head at the neck — no snap, no button.`,
        `WRIST BANDS: only ${wrist} cm tall — a THIN strip at the very end of the sleeve, about the width of a fingertip, roughly ${Math.round(leg / wrist)}× shorter than the ankle cuffs. NOT a wide cuff.`,
        `ANKLE CUFFS: ${leg} cm tall smooth bands, snug around the lower shin to the ankle.${style === "Convertible One Piece" ? " They are long enough to fold over and cover the feet (shown unfolded unless asked)." : ""}`,
        `No hand mitts${style === "Zipper Romper" ? ", no feet (bare feet show)" : ""}. Smooth crew-neck binding. No ribbing anywhere — smooth tightly knit bamboo. Comfortable fit, full length to wrists and ankles, never too small, never baggy.`,
      ];
    }
    case "Zipper Footie":
      return [
        `ZIPPER: one zipper from the centre of the neck down the front and down the WEARER'S OWN LEFT LEG to the left foot; zipper garage = small soft fabric hood, no snap, no button.`,
        `Fold-over mittens on the sleeves (one subtle tonal seam around the forearm above the wrist); a curved crotch gusset seam; a fold-over foot cuff on each leg (one subtle seam around the lower leg a few cm above the ankle). All stitching subtle and tonal. Feet natural full size, exactly two.`,
        `No ribbing. Close, comfortable fit, never too small.`,
      ];
    case "Long Sleeve Pajamas":
    case "Short Sleeve Pajamas":
      return [
        `Kids' two-piece pajama set (not joggers). Made snug-fitting on purpose: close to the body with a little ease — never baggy — but full length: sleeves to the wrists, top covering the waistband, pants to the ankles.`,
        `Crew neck with a smooth narrow neckband. Wrist and ankle cuffs are NARROW smooth bands (${c("Sleeve cuff height") || 1.5} cm — about a finger wide). No ribbing.`,
      ];
    case "Women's Long Sleeve Pajamas":
    case "Women's Short Sleeve Pajamas":
      return [
        `Button-front top with notched collar, chest pocket and thin piping on collar, placket, pocket edge${style.includes("Long") ? ", sleeves and pant hems" : ", sleeve edges and shorts hems"}.`,
        style.includes("Long") ? `Sleeves full length to the wrist bone with ONE piping line set a short distance above the sleeve edge and a short band of print below it — never two lines.` : `Short sleeves ending at mid-upper-arm.`,
        `EMBROIDERY: a small "Larkspur" script embroidered near the bottom hem on the front, on the wearer's LEFT side, in the thread colour shown on the product photo.`,
        `Top hem falls at the hip covering the waistband; relaxed, true-to-size fit — not baggy, not tight; buttons lie flat.`,
      ];
    case "Sleep Bag":
      return [`Sleeveless wearable blanket: zipper from one shoulder diagonally down the front and along one side, soft fabric chin guard over the zipper head (no snap/button). Fitted at shoulders and chest, then a soft A-line sack to a rounded bottom extending a moderate amount past the feet — not a wide balloon. No leg openings.`];
    case "Sleep Bag Walker":
      return [`Sleeveless wearable blanket with leg openings: hangs from the shoulders as a long, loose straight column; the crotch sits LOW, around the knees; below it only very short leg sections ending in smooth cuffs around the lower shins, feet showing. Not a romper with full pant legs. Centre-front zipper with a soft fabric zipper garage.`];
    default:
      return [];
  }
}

function specText(title, sizeWanted) {
  const spec = styleOf(title);
  if (!spec) return { style: null, text: `${title}: no tech pack on file — copy shape, trim and construction exactly from its product photo.` };
  let i = sizeWanted ? spec.sizes.findIndex((z) => z.toLowerCase().startsWith(String(sizeWanted).toLowerCase())) : -1;
  if (i < 0) i = Math.floor((spec.sizes.length - 1) / 2);
  const meas = [];
  for (const p of spec.parts) for (const [l, v, flat] of p.rows) if (v[i] != null) meas.push(`${spec.parts.length > 1 ? p.part + " " : ""}${l}: ${flat ? `${Math.round(v[i] * 2)} cm all around` : `${v[i]} cm`}`);
  const lines = [`${title} — style "${spec.name}", tech pack size ${spec.sizes[i]} (sheet ${spec.sheet}). ${spec.note || ""}`,
    ...construction(spec.name, spec, i).map((x) => "• " + x),
    `• Factory measurements (size ${spec.sizes[i]}), keep proportions true to these: ${meas.join("; ")}.`];
  return { style: spec.name, size: spec.sizes[i], text: lines.join("\n") };
}

module.exports = { styleOf, specText, isAiName };
