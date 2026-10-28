// Copied from BruscheInc/emily-console garment-specs.js (Emily's tech packs). Keep the two in sync when the factory sheets change.
// Garment measurements from the factory measurement sheets (tech packs):
//   Adult_Bamboo_Tech_Packs_14_05_26.xlsx and Baby_Bamboo_Tech_Packs_11_09_26.xlsx.
// Source of truth for length / inseam / sleeve / width questions the website size charts don't answer.
// Values are in CM exactly as on the sheet. Widths are measured FLAT (one side of the garment laid flat).
// Only customer-useful rows are kept (no label placement, pocket bags, trims, hem folds, gussets…).
const CM_PER_IN = 2.54;

// row: [label, values (one per size; null = not on the sheet), flat?]
const SPECS = [
  /* ---------------- adults ---------------- */
  { name: "Women's Long Sleeve Pajamas", sheet: "16 · updated 14.05.26", sizes: ["XS", "S", "M", "L", "XL", "2XL"],
    note: "The store sells S–2XL. Button-front top with collar and chest pocket; pants with drawstring and cuffs.",
    parts: [
      { part: "Top", rows: [
        ["Body length (high point of shoulder to hem)", [67, 68, 69, 70, 71, 72]],
        ["Chest", [49, 51.5, 54, 56.5, 59, 61.5], 1],
        ["Across shoulders", [36, 38, 40, 42, 44, 46]],
        ["Across front", [32, 34, 36, 38, 40, 42]],
        ["Across back", [33, 35, 37, 39, 41, 43]],
        ["Bottom hem width", [51.5, 54, 56.5, 59, 61.5, 64], 1],
        ["Sleeve length incl. cuff", [60, 61, 62, 63, 64, 65]],
        ["Armhole depth from shoulder", [20, 21, 24, 25, 26, 27]],
        ["Bicep", [18.5, 19, 19.5, 20, 20.5, 21], 1],
        ["Sleeve opening", [10.5, 11, 11.5, 12, 12.5, 13], 1],
        ["Neck opening, seam to seam", [15, 15.5, 16, 16.5, 17, 17.5]],
        ["Front neck drop to first button", [18.5, 18.75, 19, 19.25, 19.5, 19.75]],
      ] },
      { part: "Pants", rows: [
        ["Inseam incl. cuff", [75, 75, 75, 75, 75, 75]],
        ["Waist, relaxed (elastic stretches more)", [35, 37, 39, 43, 47, 52], 1],
        ["Hip", [51, 53, 56, 60, 64, 69.5], 1],
        ["Front rise incl. waistband", [30.5, 31.5, 32.5, 33.5, 34.5, 35.5]],
        ["Back rise incl. waistband", [38.5, 39.5, 40.5, 41.5, 42.5, 43.5]],
        ["Thigh (2.5 cm below crotch)", [26.5, 27.75, 29.25, 31.25, 33.25, 35.25], 1],
        ["Leg opening", [21.59, 22.86, 24.13, 25.4, 26.67, 28.575], 1],
        ["Leg cuff height", [5, 5, 5, 5, 5, 5]],
        ["Waistband height", [4, 4, 4, 4, 4, 4]],
      ] },
    ] },
  { name: "Women's Short Sleeve Pajamas", sheet: "17 · updated 04.04.26", sizes: ["XS", "S", "M", "L", "XL", "2XL"],
    note: "The store sells S–2XL. Button-front short-sleeve top with collar and chest pocket; shorts with drawstring.",
    parts: [
      { part: "Top", rows: [
        ["Body length (high point of shoulder to hem)", [65, 66, 67, 68, 69, 70]],
        ["Chest", [49, 51.5, 54, 56.5, 59, 61.5], 1],
        ["Across shoulders", [36, 38, 40, 42, 44, 46]],
        ["Bottom hem width", [51.5, 54, 56.5, 59, 61.5, 64], 1],
        ["Sleeve length (excl. cap cuff)", [14, 15, 16, 17, 18, 19]],
        ["Bicep / sleeve opening", [18.5, 19, 21, 21.5, 22, 23], 1],
        ["Armhole depth from shoulder", [20, 21, 24, 25, 26, 27]],
        ["Front neck drop to first button", [18.5, 18.75, 19, 19.25, 19.5, 19.75]],
      ] },
      { part: "Shorts", rows: [
        ["Inseam incl. cuff", [7, 7.5, 10, 10.5, 11, 12.5]],
        ["Waist, relaxed (elastic stretches more)", [35, 37, 39, 43, 47, 52], 1],
        ["Hip", [51, 53, 56, 60, 64, 69.5], 1],
        ["Front rise incl. waistband", [28, 29, 30, 31, 32, 33]],
        ["Back rise incl. waistband", [36, 37, 38, 39, 40, 41]],
        ["Thigh / leg opening (2.5 cm below crotch)", [32.5, 33.75, 35.25, 37.25, 39.25, 41.75], 1],
      ] },
    ] },
  { name: "Men's Long Lounge Set", sheet: "18 · updated 14.05.26", sizes: ["S", "M", "L", "XL", "2XL"],
    note: "The store sells M–2XL. Long-sleeve crew top; pants with drawstring and pockets.",
    parts: [
      { part: "Top", rows: [
        ["Body length (high point of shoulder to hem)", [70, 71, 72, 73, 75]],
        ["Chest (1\" below armhole)", [54.5, 57, 61.5, 64, 67], 1],
        ["Across shoulder", [47.5, 48.5, 50.5, 51.5, 53]],
        ["Bottom hem width", [54.5, 57, 61.5, 64, 67], 1],
        ["Sleeve length from armhole", [58, 58, 64, 65, 65]],
        ["Armhole", [26, 27, 29, 30, 31]],
        ["Bicep", [19.5, 20, 20.5, 21, 21.5], 1],
        ["Sleeve opening", [13.25, 13.5, 13.75, 14, 14.5], 1],
        ["Neck opening, seam to seam", [21, 21.5, 22, 22.5, 23]],
      ] },
      { part: "Pants", rows: [
        ["Inseam", [65, 65, 70, 72, 72]],
        ["Waist, relaxed (elastic stretches more)", [36, 38, 40, 42, 45], 1],
        ["Hip", [53.5, 56, 58.5, 60, 64], 1],
        ["Front rise incl. waistband", [31, 32, 33, 34, 35]],
        ["Back rise incl. waistband", [36, 37, 38, 39, 40]],
        ["Thigh (2.5 cm below crotch)", [29.75, 31, 32.25, 33.5, 35], 1],
        ["Leg opening", [19.5, 20, 21, 22, 23], 1],
        ["Waistband height", [4, 4, 4, 4, 4]],
      ] },
    ] },
  { name: "Men's Short Lounge Set", sheet: "15 · updated 14.05.26", sizes: ["S", "M", "L", "XL", "2XL"],
    note: "The store sells M–2XL. Short-sleeve crew top. The bottoms on this sheet are an exact copy of the Long Lounge Set pants, so they're not reliable for this set — do NOT quote bottoms/inseam for the Short Lounge Set; say the team will confirm.",
    parts: [
      { part: "Top", rows: [
        ["Body length (high point of shoulder to hem)", [70, 71, 72, 73, 75]],
        ["Chest (1\" below armhole)", [54.5, 57, 61.5, 64, 67], 1],
        ["Across shoulder", [47.5, 48.5, 50.5, 51.5, 53]],
        ["Bottom hem width", [54.5, 57, 61.5, 64, 67], 1],
        ["Sleeve length from armhole", [21, 22, 24, 25, 26]],
        ["Bicep", [21, 22, 23, 24, 25], 1],
        ["Sleeve opening", [18, 19, 20, 21, 22], 1],
        ["Neck opening, seam to seam", [21, 21.5, 22, 22.5, 23]],
      ] },
    ] },

  /* ---------------- baby & kids ---------------- */
  { name: "Sleep Bag", sheet: "B7 · updated 22.04.26", sizes: ["S (0-6M)", "M (6-18M)", "L (18-36M)"],
    note: "Wearable blanket (sleeveless, zip, padded chin guard). Same pattern for 0.5 and 1.0 TOG.",
    parts: [{ part: "Sleep Bag", rows: [
      ["Length (high point of shoulder to bottom)", [78, 90, 106]],
      ["Chest", [27, 30, 31.5], 1],
      ["Bottom width", [39, 45, 47.5], 1],
      ["Shoulder", [22, 23, 24]],
      ["Armhole", [13, 14, 15]],
      ["Neck width", [9.5, 11, 12.5]],
      ["Front neck drop", [6, 7, 8]],
      ["Zipper length", [130, 145, 160]],
    ] }] },
  { name: "Sleep Bag Walker", sheet: "B32 · updated 04.04.26", sizes: ["M (6-18M)", "L (18M-3T)"],
    note: "Sleep bag with leg openings so they can walk. Same pattern for 0.5 and 1.0 TOG.",
    parts: [{ part: "Sleep Bag Walker", rows: [
      ["Length (high point of shoulder to crotch)", [55, 60]],
      ["Inseam", [13, 14]],
      ["Chest", [35, 36.5], 1],
      ["Hip", [45, 46.5], 1],
      ["Width at crotch", [44, 44], 1],
      ["Shoulder", [25.5, 26.75]],
      ["Armhole depth from shoulder", [12, 12.75]],
      ["Leg opening", [7, 7.5], 1],
      ["Leg cuff height", [6, 6.5]],
      ["Neck width", [11, 11.75]],
    ] }] },
  { name: "Zipper Romper", sheet: "B36 · updated 05.04.26", sizes: ["6-12M", "12-18M", "18-24M", "2T"],
    note: "Footless zip romper with leg cuffs, no hand mitts.",
    parts: [{ part: "Zipper Romper", rows: [
      ["Body length to crotch", [41, 43, 45.5, 46.5]],
      ["Inseam (excl. leg cuff)", [15, 20, 21, 22]],
      ["Leg cuff height", [6, 6, 7, 7]],
      ["Chest", [24, 24.75, 26, 26], 1],
      ["Waist", [24, 24.75, 25.25, 25.25], 1],
      ["Hip", [24, 25.25, 26.5, 26.5], 1],
      ["Shoulder", [19.5, 21.5, 22, 22.5]],
      ["Sleeve length", [26.5, 30, 32, 32]],
      ["Sleeve cuff height", [1.5, 1.5, 1.5, 1.5]],
      ["Bicep", [7.25, 7.25, 7.75, 7.75], 1],
      ["Thigh", [11.25, 11.5, 11.75, 12], 1],
      ["Leg opening", [6.5, 6.5, 7, 7], 1],
      ["Neck width", [10, 11, 12, 13]],
    ] }] },
  { name: "Convertible One Piece", sheet: "B33 · updated 05.04.26", sizes: ["6-12M", "12-18M", "18-24M", "2T"],
    note: "Zip one-piece with fold-over foot covers (with grips) — wear footed or footless. Same body as the Zipper Romper but longer legs/cuffs.",
    parts: [{ part: "Convertible One Piece", rows: [
      ["Body length to crotch", [40, 42, 44.5, 46]],
      ["Inseam (excl. leg cuff)", [18, 23, 24, 25]],
      ["Leg cuff height", [10, 10, 11, 12]],
      ["Foot cover height", [6, 6, 6.25, 6.5]],
      ["Chest", [24, 24.75, 26, 26], 1],
      ["Waist", [24, 24.75, 25.25, 25.25], 1],
      ["Hip", [24, 25.25, 26.5, 26.5], 1],
      ["Shoulder", [19.5, 21.5, 22, 22.5]],
      ["Sleeve length", [26.5, 30, 32, 32]],
      ["Bicep", [7.25, 7.25, 7.75, 7.75], 1],
      ["Thigh", [11.25, 11.5, 11.75, 12], 1],
      ["Leg opening", [6.5, 6.5, 7, 7], 1],
      ["Neck width", [10, 11, 12, 13]],
    ] }] },
  { name: "Zipper Footie", sheet: "B31 · updated 07.03.26", sizes: ["Newborn", "0-3M", "3-6M", "6-9M"],
    note: "Footed zip sleeper with fold-over hand mitts; grips on the feet in 6-9M only.",
    parts: [{ part: "Zipper Footie", rows: [
      ["Full body length", [52, 55, 60, 66.5]],
      ["Body length", [33.5, 35, 37.5, 40]],
      ["Inseam", [12, 13, 15, 16.5]],
      ["Chest", [20, 22, 23, 24.5], 1],
      ["Hip", [21.5, 22.5, 23.5, 25.5], 1],
      ["Shoulder", [16, 17, 18, 19.5]],
      ["Sleeve length", [17, 21, 23, 25]],
      ["Thigh", [8.5, 9.5, 10, 11.25], 1],
      ["Foot length (bottom)", [8.5, 9, 9.5, 12]],
      ["Foot width", [7.5, 8, 8, 8]],
      ["Zipper length", [41, 43.5, 47.5, 51]],
    ] }] },
  { name: "Long Sleeve Pajamas", sheet: "B34 · updated 11.09.26", sizes: ["18-24M", "2T", "3T", "4T", "5T-6T", "7Y-8Y", "9Y-10Y", "12Y-14Y", "16Y"],
    note: "Kids' two-piece. The store sells 2T–7Y-8Y right now.",
    parts: [
      { part: "Top", rows: [
        ["Body length (high point of shoulder to hem)", [35, 37.5, 40, 42.5, 47.5, 50, 52.5, 59, 64]],
        ["Chest", [26, 26, 26.5, 28, 29.5, 32, 34.5, 38.25, 47], 1],
        ["Bottom hem width", [25.25, 25.25, 26, 26.5, 27.25, 29.2, 30.5, 32.4, 45], 1],
        ["Shoulder", [26, 26, 26.5, 28, 30.5, 31, 32, 35, 38]],
        ["Sleeve length (excl. cuff)", [30.5, 30.5, 33, 36, 38.5, 43, 46.5, 51.5, 55]],
        ["Sleeve cuff height", [1.5, 1.5, 1.5, 1.5, 1.5, 1.5, 1.5, 1.5, 1.5]],
        ["Bicep", [7.75, 7.75, 8, 8.25, 9, 9.5, 10.25, 10.8, 14], 1],
        ["Sleeve opening", [5.5, 5.75, 5.75, 6, 6.25, 6.75, 7, 7.6, 8.5], 1],
        ["Neck width", [13.5, 14, 14.5, 15, 15.25, 15.5, 16, 16.75, 17.5]],
      ] },
      { part: "Pants", rows: [
        ["Inseam (excl. cuff)", [26, 26.5, 27, 33, 43, 51, 57, 65, 70]],
        ["Leg cuff height", [1.5, 1.5, 1.5, 1.5, 1.5, 1.5, 1.5, 1.5, 1.5]],
        ["Waist, relaxed", [22, 22, 23, 24.5, 26, 27.75, 29, 32.5, 36], 1],
        ["Waist, stretched", [27.5, 27.5, 29, 30, 32.75, 36.5, 39, 44, 50], 1],
        ["Hip", [26.5, 26.5, 28, 29, 30.5, 33, 34.5, 38, 49], 1],
        ["Front rise incl. waistband", [18, 18.5, 19, 19.5, 20, 21, 22, 24.5, 27]],
        ["Back rise incl. waistband", [20, 20.5, 21, 21.5, 24, 25, 26, 28.5, 31]],
        ["Thigh", [11.75, 12, 13.5, 15.5, 17.3, 18.6, 19.85, 21.75, 29], 1],
        ["Leg opening", [7, 7, 7.5, 8, 8.5, 9.5, 9.75, 10.5, 12.5], 1],
      ] },
    ] },
  { name: "Short Sleeve Pajamas", sheet: "B35 · updated 11.09.26", sizes: ["18-24M", "2T", "3T", "4T", "5T-6T", "7Y-8Y", "9Y-10Y", "12Y-14Y", "16Y"],
    note: "Kids' two-piece: short-sleeve top and shorts. The store sells 2T–7Y-8Y right now.",
    parts: [
      { part: "Top", rows: [
        ["Body length (high point of shoulder to hem)", [35, 37.5, 40, 42.5, 47.5, 50, 52.5, 59, 64]],
        ["Chest", [26, 26, 26.5, 28, 29.5, 32, 34.5, 38.25, 47], 1],
        ["Bottom hem width", [25.25, 25.25, 26, 26.5, 27.25, 29.2, 30.5, 32.4, 45], 1],
        ["Shoulder", [26, 26, 26.5, 28, 30.5, 31, 32, 35, 38]],
        ["Sleeve length", [11, 11.5, 12, 12.5, 13.5, 14.5, 16, 18, 20]],
        ["Bicep", [7.75, 7.75, 8, 8.25, 9, 9.5, 10.25, 10.8, 14], 1],
      ] },
      { part: "Shorts", rows: [
        ["Inseam", [4, 4, 4.5, 5, 7, 9, 11, 14, 16]],
        ["Waist, relaxed", [22, 22, 23, 24.5, 26, 27.75, 29, 32.5, 36], 1],
        ["Waist, stretched", [27.5, 27.5, 29, 30, 32.75, 36.5, 39, 44, 50], 1],
        ["Hip", [26.5, 26.5, 28, 29, 30.5, 33, 34.5, 38, 49], 1],
        ["Front rise incl. waistband", [18, 18.5, 19, 19.5, 20, 21, 22, 24.5, 27]],
        ["Back rise incl. waistband", [20, 20.5, 21, 21.5, 24, 25, 26, 28.5, 31]],
        ["Thigh / leg opening", [11.75, 12, 13, 15, 17.3, 18.6, 19.85, 21.75, 29], 1],
      ] },
    ] },
];

const NOT_ON_FILE = "Women's Biker Short Set, Shortall, Ruffle Shorty Romper, Headband, blankets, crib sheets, pet bandanas, and the Outlet's older styles (e.g. Sleep Sack)";

const inch = (cm) => Math.round((cm / CM_PER_IN) * 4) / 4;   // nearest 1/4"
const fmtIn = (n) => { const w = Math.floor(n), f = n - w; const fr = f === 0.25 ? "¼" : f === 0.5 ? "½" : f === 0.75 ? "¾" : ""; return `${w || (fr ? "" : "0")}${fr}"`; };
// flat widths are shown as the all-around figure (×2) — that's what customers compare with a body measurement
const cell = (cm, flat) => cm == null ? "n/a" : fmtIn(inch(flat ? cm * 2 : cm));

function text() {
  const out = [
    "GARMENT MEASUREMENTS — from our factory measurement sheets. Use them to answer length, inseam, sleeve, rise, chest/waist width and \"will it fit / how long is it\" questions the website size chart doesn't cover:",
    "- These are measurements of the GARMENT, not the body, in inches (nearest ¼\"; 1\" = 2.54 cm if they want cm). Rows marked (all around) are the full circumference — the factory measures them flat, so half that number is the flat width if someone measures a garment laid flat. Elastic waists stretch beyond the relaxed figure. Allow about ½\" variation piece to piece.",
    "- Height questions: compare honestly. Most adults need a 30–34\" inseam and tall people more; if ours is shorter than they'd need, say plainly it will run short on them rather than promising a fit. For babies, compare the garment's length to the baby's height/measurements and suggest sizing up when they're near the top of a range.",
    "- Kids' pajamas are made snug-fitting on purpose (U.S. children's sleepwear safety rules) — they're meant to fit close to the body, so sizing up is the way to get a roomier fit.",
    "- Only quote styles and sizes listed below. Not on file: " + NOT_ON_FILE + ". For those (or a size that shows n/a), say you don't have that measurement and offer to have the team check — never guess or borrow numbers from another style.",
  ];
  for (const s of SPECS) {
    out.push(`\n${s.name.toUpperCase()} — sizes: ${s.sizes.join(", ")}. ${s.note || ""}`);
    for (const p of s.parts) {
      if (s.parts.length > 1 || p.part !== s.name) out.push(`${p.part}:`);
      for (const [label, vals, flat] of p.rows) out.push(`  ${label}${flat ? " (all around)" : ""}: ` + s.sizes.map((z, i) => `${z.split(" ")[0]} ${cell(vals[i], flat)}`).join(" · "));
    }
  }
  return out.join("\n");
}

module.exports = { SPECS, text };
