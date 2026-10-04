import { test } from "node:test";
import assert from "node:assert/strict";
import { validate, modifiedZ, median, THRESHOLDS } from "../src/engine.js";
import { toBundle } from "../src/fhir.js";
import { SITES } from "../src/sample-data.js";
import { METRICS } from "../src/protocol.js";

const siteA = SITES.find((s) => s.id === "demo-a");
const siteB = SITES.find((s) => s.id === "demo-b");

const base = (over = {}) => ({
  siteId: "demo-a",
  scores: { channel: 4, banks: 4, vegetation: 4, clarity: 4, algae: 4, litter: 3, flow: 4, habitat: 3 },
  odor: "earthy",
  outfall: "none",
  rain48h: "no",
  minutesOnSite: 18,
  photo: true,
  ...over,
});
const ids = (r) => r.checks.map((c) => c.id).sort();

test("median and modified z basics", () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([1, 2, 3, 4]), 2.5);
  assert.equal(modifiedZ(4, [4, 4, 4, 4, 4]), 0);
  assert.equal(modifiedZ(1, [4, 4, 4, 4, 4]), -Infinity); // MAD and meanAD both 0, jump of 3
  assert.equal(modifiedZ(5, [4, 4, 4, 4, 4]), 0); // jump of 1 on an ordinal scale is not an outlier
  assert.ok(Math.abs(modifiedZ(1, [4, 4, 4, 3, 4, 5, 4, 4])) > THRESHOLDS.modifiedZ);
});

test("typical visit at a site with history is accepted with no flags", () => {
  const r = validate(base(), siteA.history);
  assert.equal(r.complete, true);
  assert.deepEqual(r.checks, []);
  assert.equal(r.priority, 0);
  assert.equal(r.decision, "accept");
  assert.deepEqual(r.healthNotes, []);
});

test("incomplete assessment lists the missing metrics and does not score", () => {
  const a = base();
  delete a.scores.flow;
  const r = validate(a, siteA.history);
  assert.equal(r.complete, false);
  assert.deepEqual(r.missing, ["flow"]);
  assert.equal(r.priority, null);
});

test("contradictory answers are routed to a human reviewer", () => {
  const a = base({ scores: { channel: 4, banks: 5, vegetation: 1, clarity: 5, algae: 4, litter: 3, flow: 1, habitat: 4 }, minutesOnSite: 3, photo: false });
  const r = validate(a, siteA.history);
  for (const id of ["dry_but_clear", "firm_banks_no_roots", "short_visit", "no_photo"]) {
    assert.ok(ids(r).includes(id), `expected ${id}`);
  }
  assert.equal(r.decision, "review");
  assert.ok(r.priority >= THRESHOLDS.review);
});

test("priority is the noisy-OR of effective weights", () => {
  const a = base({ scores: { ...base().scores, flow: 1, clarity: 4 } }); // dry_but_clear 0.4 + outlier_flow 0.2
  const r = validate(a, siteA.history);
  const expected = 1 - r.checks.reduce((p, c) => p * (1 - c.effectiveWeight), 1);
  assert.ok(Math.abs(r.priority - expected) < 0.001);
});

test("a citizen re-check halves the weight but keeps the flag on record", () => {
  const a = base({ scores: { ...base().scores, banks: 5, vegetation: 1 } });
  const before = validate(a, []);
  const after = validate(a, [], new Set(["firm_banks_no_roots"]));
  const b = before.checks.find((c) => c.id === "firm_banks_no_roots");
  const c = after.checks.find((c) => c.id === "firm_banks_no_roots");
  assert.equal(c.confirmed, true);
  assert.equal(c.effectiveWeight, b.weight * THRESHOLDS.confirmedDiscount);
  assert.ok(after.priority < before.priority);
});

test("the engine never mutates the citizen's answers", () => {
  const a = base({ scores: { ...base().scores, flow: 1, clarity: 5 } });
  const snapshot = structuredClone(a);
  validate(a, siteA.history);
  assert.deepEqual(a, snapshot);
});

test("straight-lining is flagged", () => {
  const scores = Object.fromEntries(METRICS.map((m) => [m.id, 3]));
  const r = validate(base({ scores }), []);
  assert.ok(ids(r).includes("straight_line"));
});

test("outlier checks need at least minHistory visits", () => {
  const a = base({ scores: { ...base().scores, clarity: 1 } });
  assert.ok(validate(a, siteA.history).checks.some((c) => c.id === "outlier_clarity"));
  assert.ok(!validate(a, siteA.history.slice(0, 4)).checks.some((c) => c.id === "outlier_clarity"));
});

test("recent rain softens a clarity drop and says why", () => {
  const scores = { channel: 2, banks: 3, vegetation: 2, clarity: 1, algae: 3, litter: 2, flow: 5, habitat: 2 };
  const dry = validate(base({ siteId: "demo-b", scores, rain48h: "no" }), siteB.history);
  const wet = validate(base({ siteId: "demo-b", scores, rain48h: "yes" }), siteB.history);
  const d = dry.checks.find((c) => c.id === "outlier_clarity");
  const w = wet.checks.find((c) => c.id === "outlier_clarity");
  assert.ok(d && w);
  assert.ok(w.weight < d.weight);
  assert.match(w.message, /Rain/);
  assert.ok(wet.priority < dry.priority);
});

test("sewage signs produce One Health precautions plus the visual-limit caveat", () => {
  const r = validate(base({ odor: "sewage", outfall: "pipe_flowing" }), siteA.history);
  const hid = r.healthNotes.map((h) => h.id);
  assert.ok(hid.includes("possible_sewage"));
  assert.ok(hid.includes("visual_limit"));
  // a health note is advice, not a data-quality flag, but a person must follow up
  assert.equal(r.decision, "accept");
  assert.equal(r.needsFollowUp, true);
  assert.equal(validate(base(), siteA.history).needsFollowUp, false);
});

test("priority exactly at a threshold uses the rounded value (regression)", () => {
  // a single 0.2 outlier: 1 - 0.8 is 0.19999999999999996 in floating point
  const r = validate(base({ scores: { ...base().scores, algae: 1 } }), siteA.history);
  assert.equal(r.priority, 0.2);
  assert.equal(r.decision, "accept_with_note");
});

test("FHIR bundle maps review state to Observation.status and records provenance", () => {
  const a = base({ scores: { ...base().scores, flow: 1, clarity: 5 } });
  const r = validate(a, siteA.history);
  const site = { id: siteA.id, name: siteA.name, lat: siteA.lat, lon: siteA.lon };

  const statuses = (b) => [...new Set(b.entry.filter((e) => e.resource.resourceType === "Observation").map((e) => e.resource.status))];
  const pending = toBundle(a, r, site);
  assert.equal(pending.resourceType, "Bundle");
  assert.equal(pending.type, "collection");
  assert.deepEqual(statuses(pending), ["preliminary"]);

  const approved = toBundle(a, r, site, { status: "approved", reviewer: "r1", reason: "photo confirms", at: "2026-09-29T12:00:00Z" });
  assert.deepEqual(statuses(approved), ["final"]);
  const rejected = toBundle(a, r, site, { status: "rejected", reviewer: "r1", reason: "wrong site", at: "2026-09-29T12:00:00Z" });
  assert.deepEqual(statuses(rejected), ["entered-in-error"]);

  const obs = approved.entry.filter((e) => e.resource.resourceType === "Observation");
  // 8 metrics + 3 context fields + 1 review priority
  assert.equal(obs.length, 12);
  const flow = obs.find((e) => e.resource.code.coding[0].code === "flow").resource;
  assert.equal(flow.valueInteger, 1);
  assert.ok(flow.note.some((n) => n.text.includes("dry_but_clear")));

  const prov = approved.entry.find((e) => e.resource.resourceType === "Provenance").resource;
  assert.equal(prov.target.length, 12);
  assert.deepEqual(prov.agent.map((x) => x.type.coding[0].code), ["performer", "assembler", "verifier"]);

  // every reference resolves inside the bundle
  const urls = new Set(approved.entry.map((e) => e.fullUrl));
  for (const t of prov.target) assert.ok(urls.has(t.reference));
  assert.ok(urls.has(flow.subject.reference));
});

test("a one-point change on a near-constant history is not an outlier (regression)", () => {
  // demo-a habitat history is seven 4s and one 3; modified z for a 3 is -6.4
  const r = validate(base({ scores: { ...base().scores, habitat: 3 } }), siteA.history);
  assert.ok(!r.checks.some((c) => c.id === "outlier_habitat"));
  const r2 = validate(base({ scores: { ...base().scores, habitat: 1 } }), siteA.history);
  assert.ok(r2.checks.some((c) => c.id === "outlier_habitat"));
});
