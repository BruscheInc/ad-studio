/* playbook.js — the creative playbook Ad Studio follows for Meta ads.
 *
 * Built from a review of the top active ads (by impressions) of Little Sleepies, Posh Peanut and Kyte Baby, Oct 2026.
 * The point is not to copy them. It is the feeling their ads give and the reasons they get clicks:
 *   • they look like real life — a parent's phone, a real living room, daylight, a real Christmas tree — not a studio render;
 *   • one emotion per ad, carried by the picture, not by text painted on it;
 *   • the funnel is covered on purpose: soft emotional pictures to stop the scroll, tactile/product pictures to build want,
 *     and plain, clear product + scarcity/offer to close.
 *
 * Each concept has an intent (soft | mid | purchase), the emotion it should leave, a scene recipe that goes into the
 * image prompt, the camera/realism look, and copy formulas. edit_image appends a concept's recipe when the prompt has
 * a line "CONCEPT: <key>"; the ad_playbook tool lists them.
 */

/* What makes an ad picture read as real (and what made ours read as fake). Added to every concept prompt. */
const REAL_LOOK = {
  phone: `LOOK — like a real photo a parent took on a recent iPhone in their own home: natural daylight from a window, slightly warm indoor white balance, mild real-world clutter kept tidy (a throw blanket, a mug, a stray toy), true colors, natural lens perspective (26mm phone wide lens, slight edge perspective), slightly imperfect framing (a little off-center, a foot or elbow cropped at the frame edge), sharp focus on faces and garments, HDR-free. Real unretouched skin with pores, real hair with flyaways, real fabric folds and knit texture.`,
  lifestyle: `LOOK — a lifestyle photographer shooting in a real, lived-in home (not a studio): soft natural window light, 35mm, f/2.8 with gentle background blur, honest color, documentary moment — people doing something, not posing for the camera. Real unretouched skin, real hair, real fabric folds and knit texture.`,
  macro: `LOOK — a real macro product photo: the fabric fills the whole frame edge to edge, softly rippled and draped so light rakes across the folds, showing the close-knit texture and the print scale; even soft daylight; no props, no people, no text.`,
  catalog: `LOOK — a clean e-commerce catalog photo: plain white or very light grey seamless background, soft even light, the whole garment visible, true color, crisp.`,
};
const NEVER = `NEVER — no text, letters, logos, stickers or doodles painted into the picture; no flying feathers, confetti or staged action; no everyone-laughing-at-once; no glossy studio glow, airbrushed skin, HDR look or boosted saturation; no perfect symmetrical posing; no stock "pretty brunette mom" face.`;

const CONCEPTS = [
  /* ---------- SOFT: stop the scroll with a feeling ---------- */
  { key: "tradition-morning", intent: "soft", emotion: "nostalgia / 'this is our family tradition'",
    look: "lifestyle",
    scene: `Christmas or holiday morning in a real living room: the family in the matching pajamas sitting on a wood floor or rug in front of a real decorated tree with a few wrapped gifts, morning daylight from a side window. Siblings or parent and baby close together, a child holding up or peeking into a gift, someone mid-laugh while another looks at the child. Shot from a low, seated eye level as if another parent is taking the photo.`,
    copy: { primary: ["The traditions they'll remember start in the PJs. {emoji}", "Same pajamas, every Christmas morning. That's the tradition. {emoji}"], headline: ["Matching Since Morning One", "A Little Print. A Lot of Christmas."] } },
  { key: "first-holiday", intent: "soft", emotion: "tenderness — 'their first holiday only happens once'",
    look: "lifestyle",
    scene: `A parent lying on a bed with rumpled white sheets next to a baby (4–9 months) in the zipper romper, both in the matching print; the parent looks at the baby, the baby grips the parent's finger or reaches toward them. Soft morning window light, close framing from slightly above as if the other parent is standing by the bed.`,
    copy: { primary: ["Their first holiday only happens once. Make it soft. {emoji}"], headline: ["Baby's First Holiday", "First Christmas, Matched"] } },
  { key: "cozy-couch", intent: "soft", emotion: "belonging — 'look at us, all matching'",
    look: "phone",
    scene: `The family sitting together on a light sectional sofa in their living room, all in the matching print (dad may wear a plain tee with the matching pants), baby on a parent's lap, white socks, a throw pillow and blanket. Everyone loosely looking at the phone camera like a real family photo a relative took — one person mid-blink-smile, the toddler looking away.`,
    copy: { primary: ["Very merry, very matching. {emoji}", "The annual couch photo, upgraded. {emoji}"], headline: ["The Whole Crew Matches", "Family Photo Ready"] } },
  { key: "little-moment", intent: "soft", emotion: "delight — a small, real kid moment",
    look: "lifestyle",
    scene: `One child (toddler or preschooler) in the matching pajamas caught in a small real moment at home: tiptoeing to look at the tree lights, hugging the dog who wears the matching bandana, or sitting in a laundry basket of blankets. Natural expression (concentration, wonder, a small smile), not looking at the camera.`,
    copy: { primary: ["The little moments are the whole point. {emoji}"], headline: ["Made for Moments Like This"] } },

  /* ---------- MID: make them want to touch it ---------- */
  { key: "print-swatch", intent: "mid", emotion: "want — 'oh, that print' + softness you can almost feel",
    look: "macro",
    scene: `Only the fabric of the product: the print fills the entire frame edge to edge, softly rippled and folded so light rakes across it. Make 4 crops or angles of the same fabric for one ad (Meta rotates them).`,
    copy: { primary: ["Step into a little world of wonder. New holiday prints are here. {emoji}"], headline: ["New Holiday Prints Are Here", "{print}, In Buttery-Soft Bamboo"] } },
  { key: "hands-on", intent: "mid", emotion: "trust — 'look how soft and well made'",
    look: "phone",
    scene: `A parent's hands holding up or stretching the garment toward the phone camera in a real home (bedroom or nursery, daylight), showing the stretch of the fabric, the zipper running down the leg, or the fold-over cuffs. Shot vertically like a quick try-on/review video still. Garment fills most of the frame.`,
    copy: { primary: ["Tagless, stretchy and buttery soft. Our {product} is what sweet dreams are made of. {emoji}"], headline: ["Zip, Change, Snuggle", "Soft You Can Feel"] } },
  { key: "problem-solved", intent: "mid", emotion: "relief — 'this makes my night easier'",
    look: "phone",
    scene: `A real nighttime/early-morning diaper change on a changing pad or bed, warm lamp light: a parent's hands unzipping the zipper romper from the bottom while the baby is calm. Close, honest, slightly grainy-free phone photo.`,
    copy: { primary: ["One zip, top to toe. 2 a.m. diaper changes just got easier. {emoji}"], headline: ["Make Mom Life Easier", "Zip, Change, Back to Sleep"] } },

  /* ---------- PURCHASE: clear product + a reason to buy now ---------- */
  { key: "product-clear", intent: "purchase", emotion: "clarity — 'that one, in my kid's size'",
    look: "catalog",
    scene: `The product alone on a plain white or light grey background (laid flat or on a child standing still), whole garment visible, true color. For a baby: lying on white sheets, filling the frame, one simple seasonal prop beside them (a big plush candy cane, a knit stocking).`,
    copy: { primary: ["Pick your print. Find everyone's match. Holiday pajamas for the whole family are here. {emoji}"], headline: ["{print} {product}", "Shop Sizes Newborn to Adult"] } },
  { key: "going-fast", intent: "purchase", emotion: "urgency — 'don't miss it'",
    look: "phone",
    scene: `Use a real-looking family or kid photo from the soft concepts (cozy-couch or tradition-morning). The urgency lives in the copy, not on the image.`,
    copy: { primary: ["Festive prints are going fast. Grab your family's match before they're gone. {emoji}"], headline: ["Festive Prints Are Going Fast", "Grab Them Before They're Gone"] } },
  { key: "bundle-offer", intent: "purchase", emotion: "smart buy — 'better value if I get the set'",
    look: "catalog",
    scene: `Three pieces of the collection laid side by side on a light background (e.g. zipper romper, kids' PJ set, women's set) — clean, even light, true color.`,
    copy: { primary: ["Pick 3, save {offer}. You pick the prints, we'll do the rest. {emoji}"], headline: ["Stock Up & Save", "Pick 3, Save {offer}"] } },
];

const BY_KEY = Object.fromEntries(CONCEPTS.map((c) => [c.key, c]));

/** Text appended to an image prompt for a concept. */
function conceptBlock(key) {
  const c = BY_KEY[String(key || "").trim().toLowerCase()];
  if (!c) return null;
  return `\n\nCREATIVE CONCEPT "${c.key}" (${c.intent} funnel) — the picture must make the viewer feel: ${c.emotion}.\nSCENE: ${c.scene}\n${REAL_LOOK[c.look]}\n${NEVER}`;
}

/** Plain-text playbook for the ad_playbook tool. */
function playbookText(intent) {
  const list = CONCEPTS.filter((c) => !intent || c.intent === intent);
  const head = `Ad Studio creative playbook (from Little Sleepies, Posh Peanut and Kyte Baby top ads). Rules for every ad:
• One emotion per ad, carried by the picture. No text painted on photos; put words in Meta's primary text/headline (or set them with compose_email when a layout is needed).
• Real life beats studio: a parent's phone in a real home, daylight, real tree, real couch. Imperfect framing is fine.
• Cover the funnel: soft (stop the scroll with a feeling) → mid (make them want to touch it) → purchase (clear product + reason to buy now).
• Copy: one short line + 1 emoji; headline 3–6 words, a light pun is welcome ("A Little Stripe. A Lot of Christmas."). Name the print/collection.
• Run 3–4 versions of each concept (different crops/moments) so Meta can rotate.
To use a concept: edit_image with an original product photo, a "PRODUCTS: …" line and a line "CONCEPT: <key>".`;
  const body = list.map((c) => `\n[${c.intent.toUpperCase()}] ${c.key} — feeling: ${c.emotion}\n  scene: ${c.scene}\n  look: ${c.look}\n  primary text: ${c.copy.primary.join(" | ")}\n  headline: ${c.copy.headline.join(" | ")}`).join("\n");
  return head + "\n" + body;
}

module.exports = { CONCEPTS, REAL_LOOK, NEVER, conceptBlock, playbookText };
