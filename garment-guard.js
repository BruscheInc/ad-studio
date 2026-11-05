/* garment-guard.js — the product failsafe for every Ad Studio image that shows a Larkspur product.
 *  1. Every product is looked up in the store and its ORIGINAL product photos (not our own AI images, which are
 *     uploaded with names starting "larkspur-baby-") are pulled FRESH from Shopify on every call and attached.
 *  2. Its tech pack (factory measurement sheet) and construction rules are added to the prompt, so sizes, cuffs,
 *     zippers, piping and embroidery are spelled out every time.
 *  3. Images Ad Studio already made can't be used as a source unless explicitly allowed (catalog close-ups of an
 *     approved image) — garments never get copied from an AI image.
 */
const { SPECS } = require("./tech-packs.js");

const ALIASES = [[/\bshort (pj|pajama) set\b/i, "Short Sleeve Pajamas"], [/\b(long )?(pj|pajama) set\b/i, "Long Sleeve Pajamas"], [/\bzip(pered)? footie\b/i, "Zipper Footie"], [/\bsleep sack walker\b/i, "Sleep Bag Walker"], [/\bsleep sack\b/i, "Sleep Bag"]];
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
    case "Short Sleeve Pajamas":
      return [
        `Kids' two-piece: short-sleeve crew-neck tee + shorts. Snug-fitting on purpose (close to the body, a little ease, never baggy, never stretched tight).`,
        `TOP LENGTH: body length ${c("Body length") || 42.5} cm from the high point of the shoulder to the hem vs a front rise of only ${c("Front rise") || 19.5} cm — so the tee hem ALWAYS falls past the shorts waistband and hides it completely, ending at the upper hip with just the lower part of the shorts showing. Never cropped, never a belly gap (even when arms are raised the hem stays at the waistband).`,
        `Sleeves are short, ending at mid upper-arm (${c("Sleeve length") || 12.5} cm), plain stitched hem, no cuff. SHORTS LENGTH: the leg hems end at MID-THIGH — about halfway between the hip and the knee — with a real inseam, like a classic kids' sleep short. Never hot-pant or bike-brief short, never high on the thigh. Plain stitched leg hems, covered elastic waistband, a little ease around the thigh.`,
        `Crew neck with a smooth narrow neckband. No ribbing anywhere — smooth tightly knit bamboo.`,
      ];
    case "Long Sleeve Pajamas":
      return [
        `Kids' two-piece pajama set (not joggers). Made snug-fitting on purpose: close to the body with a little ease — never baggy — but full length: sleeves to the wrists, top covering the waistband, pants to the ankles.`,
        `Crew neck with a smooth narrow neckband. No ribbing.`,
        `CUFFS (tech pack, check every time): wrist cuff ${c("Sleeve cuff height") || 1.5} cm and ankle cuff ${c("Leg cuff height") || 1.5} cm tall — a THIN contrast strip at the very end of each sleeve and pant leg, no wider than the child's fingertip, about the same width as the neckband. Never a wide band, never a sock-like or legging-style cuff. If a zipper romper or footie is in the same photo, its ankle cuffs are much taller — the PJ set cuffs must stay about 4× thinner than those.`,
      ];
    case "Women's Long Sleeve Pajamas":
    case "Women's Short Sleeve Pajamas":
      return [
        `Button-front top with notched collar, chest pocket and thin piping on collar, placket, pocket edge${style.includes("Long") ? ", sleeves and pant hems" : ", sleeve edges and shorts hems"}.`,
        style.includes("Long") ? `Sleeves full length to the wrist bone with ONE piping line set a short distance above the sleeve edge and a short band of print below it — never two lines.` : `Short sleeves ending at mid-upper-arm.`,
        `EMBROIDERY: one small "Larkspur" wordmark (spelled L-a-r-k-s-p-u-r) in UPRIGHT SERIF lettering — the same classic serif as the Larkspur logo: a capital serif "L" followed by separate, upright lowercase serif letters "arkspur", about 4 cm wide, in smooth raised satin-stitch embroidery. NEVER cursive, NEVER script or handwriting, NEVER italic or slanted, letters never joined. It is EMBROIDERED STRAIGHT ONTO THE PRINTED FABRIC: the stitches sit on top of the print and overlap whatever motifs are underneath — NO patch, NO label, NO plain or lighter box behind it, and the print is NOT cleared away to make room for it. Embroidered at the very BOTTOM of the shirt front — sitting just 2–3 cm above the bottom hem, near the wearer's LEFT hip, below belly-button level. It is NEVER under the chest pocket, never mid-torso, never on the sleeve or the pants. Thread colour as on the product photo. Pose her so that bottom corner of the shirt is visible (not hidden behind a child or her arm).`,
        `Top hem falls at the hip covering the waistband; relaxed, true-to-size fit — not baggy, not tight; buttons lie flat.`,
      ];
    case "Sleep Bag":
      return [`Sleeveless wearable blanket: zipper from one shoulder diagonally down the front and along one side, soft fabric chin guard over the zipper head (no snap/button). Fitted at shoulders and chest, then a soft A-line sack to a rounded bottom extending a moderate amount past the feet — not a wide balloon. No leg openings.`,
        `FOR BABIES ONLY (about 3–12 months) — never on a walking toddler; show the baby sitting or lying as in past approved sleep bag images (sitting up on a white bed). PROPORTIONS from the tech pack: the bag (size M ${c("Length (high point of shoulder to bottom)") || 90} cm long) is longer than the baby's body, so her legs and feet are clearly INSIDE the bag — soft shapes of short chubby legs and SMALL baby feet (about 11 cm) roughly two-thirds of the way down — and the last 25–30 cm of the bag is empty and lies soft and slightly collapsed past her feet. Legs and feet must never be stretched or elongated to fill the bag, and the bag must never look empty below her hips (that reads as a baby with no feet).`];
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
