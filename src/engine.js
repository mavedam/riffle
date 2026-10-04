// Riffle validation engine.
//
// Pure functions, no network, no hidden model. Every flag carries its own
// evidence weight and a plain-language explanation, and the review priority
// is a noisy-OR of those weights, so a reviewer can see exactly which checks
// pushed a submission into the queue. The engine never edits an answer.

import { METRIC_IDS, metricById } from "./protocol.js";

export const THRESHOLDS = {
  accept: 0.2, // priority below this: accepted as submitted
  review: 0.5, // priority at or above this: sent to a human reviewer
  minHistory: 5, // site history needed before outlier checks run
  modifiedZ: 3.5, // Iglewicz & Hoaglin cut-off
  minJump: 2, // ...and the answer must also differ from the site median by 2+ points
  minMinutes: 4, // fewer minutes than this on site is a low-effort signal
  confirmedDiscount: 0.5, // a citizen re-check halves a flag's weight
};

// ---- consistency rules ---------------------------------------------------
// Each rule describes a combination of answers that is physically unlikely,
// or that contradicts itself. Weights are hand-set and documented, not learned.

export const RULES = [
  {
    id: "dry_but_clear",
    metrics: ["flow", "clarity"],
    weight: 0.4,
    when: (a) => a.scores.flow === 1 && a.scores.clarity >= 4,
    message: "Flow is marked as a dry bed, but water clarity is rated clear.",
    prompt: "If the bed is dry, was the clarity answer about a nearby pool? Please check the flow answer.",
  },
  {
    id: "firm_banks_no_roots",
    metrics: ["banks", "vegetation"],
    weight: 0.25,
    when: (a) => a.scores.banks >= 4 && a.scores.vegetation === 1,
    message: "Banks are rated firm while almost no plants grow along them.",
    prompt: "Unless the banks are walled or rock-armoured, bare banks usually erode. Take another look at the bank edges.",
  },
  {
    id: "piped_but_rich_habitat",
    metrics: ["channel", "habitat"],
    weight: 0.25,
    when: (a) => a.scores.channel === 1 && a.scores.habitat === 5,
    message: "The channel is concrete or piped, yet hiding places are rated plentiful everywhere.",
    prompt: "Concrete channels rarely have many rocks, logs or undercut banks. Were you looking at a natural stretch nearby?",
  },
  {
    id: "clear_with_scum",
    metrics: ["clarity", "algae"],
    weight: 0.15,
    when: (a) => a.scores.clarity === 5 && a.scores.algae === 1,
    message: "Water is rated clear to the bed while thick mats or surface scum are reported.",
    prompt: "This can happen, but check whether the scum covers the surface you looked through.",
  },
];

// ---- statistics -----------------------------------------------------------

export function median(xs) {
  const s = [...xs].sort((a, b) => a - b);
  const n = s.length;
  if (n === 0) return NaN;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}

// Modified z-score (Iglewicz & Hoaglin, 1993). On 1-5 ordinal scales the MAD
// is often 0, so fall back to the mean absolute deviation scaled by 1.253314.
// If that is also 0 (every past answer identical) treat a jump of 2+ points
// as an outlier.
export function modifiedZ(x, history) {
  const med = median(history);
  const mad = median(history.map((h) => Math.abs(h - med)));
  if (mad > 0) return (0.6745 * (x - med)) / mad;
  const meanAD = history.reduce((s, h) => s + Math.abs(h - med), 0) / history.length;
  if (meanAD > 0) return (x - med) / (1.253314 * meanAD);
  const d = x - med;
  if (d === 0) return 0;
  return Math.abs(d) >= 2 ? Math.sign(d) * Infinity : 0;
}

// ---- main entry point -----------------------------------------------------

/**
 * @param {object} a  assessment: { siteId, scores:{metric:1..5}, odor, outfall,
 *                    rain48h, minutesOnSite, photo:boolean }
 * @param {object[]} history  prior accepted assessments at the same site
 * @param {Set<string>} confirmed  ids of checks the citizen re-checked and kept
 */
export function validate(a, history = [], confirmed = new Set()) {
  const checks = [];
  const add = (c) => {
    const isConfirmed = confirmed.has(c.id);
    checks.push({
      ...c,
      confirmed: isConfirmed,
      effectiveWeight: isConfirmed ? c.weight * THRESHOLDS.confirmedDiscount : c.weight,
    });
  };

  const missing = METRIC_IDS.filter((id) => !Number.isInteger(a.scores?.[id]));
  if (missing.length) {
    return { complete: false, missing, checks: [], priority: null, decision: "incomplete", healthNotes: [] };
  }

  // 1. internal consistency
  for (const r of RULES) {
    if (r.when(a)) add({ id: r.id, kind: "consistency", metrics: r.metrics, weight: r.weight, message: r.message, prompt: r.prompt });
  }

  // 2. straight-lining: every metric given the same score
  const values = METRIC_IDS.map((id) => a.scores[id]);
  if (values.every((v) => v === values[0])) {
    add({
      id: "straight_line",
      kind: "effort",
      metrics: METRIC_IDS,
      weight: 0.3,
      message: `Every question received the same score (${values[0]}).`,
      prompt: "Streams are rarely identical on every measure. Was each question checked on its own?",
    });
  }

  // 3. time on site
  if (Number.isFinite(a.minutesOnSite) && a.minutesOnSite < THRESHOLDS.minMinutes) {
    add({
      id: "short_visit",
      kind: "effort",
      metrics: [],
      weight: 0.3,
      message: `Assessment took ${a.minutesOnSite} min; eight visual checks usually take longer.`,
      prompt: "If you were in a hurry, that is fine. Mark any question you guessed so a reviewer knows.",
    });
  }

  // 4. outliers against this site's own history
  const rainContext = a.rain48h === "yes";
  if (history.length >= THRESHOLDS.minHistory) {
    for (const id of METRIC_IDS) {
      const past = history.map((h) => h.scores[id]).filter(Number.isInteger);
      if (past.length < THRESHOLDS.minHistory) continue;
      const z = modifiedZ(a.scores[id], past);
      const med = median(past);
      // On a 1-5 ordinal scale a near-constant history makes the modified z
      // explode for a one-point change (seven 4s and one 3 gives z = -6.4 for
      // a 3). Require a jump of at least minJump points as well.
      if (Math.abs(z) <= THRESHOLDS.modifiedZ || Math.abs(a.scores[id] - med) < THRESHOLDS.minJump) continue;
      const m = metricById(id);
      // Rain clouds urban streams and raises flow. A drop in clarity, or a
      // rise in flow, after rain is expected, so the flag is softened and
      // the explanation says why.
      const explainedByRain =
        rainContext && ((id === "clarity" && z < 0) || (id === "flow" && z > 0));
      add({
        id: `outlier_${id}`,
        kind: "history",
        metrics: [id],
        weight: explainedByRain ? 0.05 : 0.2,
        z: Number.isFinite(z) ? Math.round(z * 10) / 10 : z,
        message:
          `${m.term}: ${a.scores[id]} vs a site median of ${med} across ${past.length} past visits.` +
          (explainedByRain ? " Rain in the last 48 h is a likely explanation." : ""),
        prompt: explainedByRain
          ? "No action needed. Rain often changes this reading."
          : `This is unusual for this site. Has something changed (works, a spill, a storm)? Add a note or a photo if you can.`,
      });
    }
  }

  // 5. no photo: small baseline uncertainty, only when something else fired
  if (!a.photo && checks.length > 0) {
    add({
      id: "no_photo",
      kind: "evidence",
      metrics: [],
      weight: 0.1,
      message: "No photo attached to a submission that has other flags.",
      prompt: "A photo lets a reviewer confirm your answers without a site visit.",
    });
  }

  // noisy-OR: P(needs review) = 1 - prod(1 - w_i)
  // Round before comparing so 1 - 0.8 = 0.19999999999999996 lands on 0.2.
  const priority = Math.round((1 - checks.reduce((p, c) => p * (1 - c.effectiveWeight), 1)) * 1000) / 1000;
  const decision =
    priority >= THRESHOLDS.review ? "review" : priority >= THRESHOLDS.accept ? "accept_with_note" : "accept";
  const notes = healthNotes(a);

  return {
    complete: true,
    checks,
    priority,
    decision,
    healthNotes: notes,
    // Data quality and health risk are separate questions. A trustworthy
    // report of sewage still needs a person to act on it.
    needsFollowUp: notes.some((h) => h.action),
  };
}

// ---- One Health notes -----------------------------------------------------
// Visual scores track physical habitat, not water quality (McMurray et al.,
// 2026, PLOS ONE). So these notes advise caution and point to measurement;
// they never claim the water is safe or unsafe.

export function healthNotes(a) {
  const notes = [];
  const sewageSigns = a.odor === "sewage" || (a.outfall === "pipe_flowing" && ["rotten_egg", "sewage"].includes(a.odor));
  if (sewageSigns) {
    notes.push({
      id: "possible_sewage",
      audience: ["people", "animals"],
      text: "Possible sewage signs. Avoid skin contact, keep dogs out of the water, and wash hands after the visit.",
      action: "Flag for a microbiological sample (e.g. E. coli or Enterococcus).",
    });
  }
  if (a.odor === "chemical") {
    notes.push({
      id: "possible_chemical",
      audience: ["people", "animals", "ecosystem"],
      text: "Chemical or fuel smell reported. Do not touch the water.",
      action: "Report to the local environmental authority; a reviewer should treat this as urgent.",
    });
  }
  if (a.scores?.algae === 1) {
    notes.push({
      id: "possible_bloom",
      audience: ["people", "animals"],
      text: "Thick algae or scum. Some blooms produce toxins harmful to dogs and people; keep pets out.",
      action: "Ask a trained monitor to check for cyanobacteria.",
    });
  }
  if (notes.length) {
    notes.push({
      id: "visual_limit",
      audience: [],
      text: "A visual check cannot confirm water quality either way. These notes are precautions, not test results.",
      action: null,
    });
  }
  return notes;
}
