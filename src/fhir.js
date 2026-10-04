// Export a Riffle assessment as an HL7 FHIR R4 collection Bundle.
//
// The human-in-the-loop decision maps onto FHIR's own Observation.status:
//   preliminary      -> waiting for, or not needing, a human reviewer
//   final            -> a reviewer approved it
//   entered-in-error -> a reviewer rejected it (kept, with the reason, never deleted)
// A Provenance resource records who did what: the citizen (performer), the
// Riffle validator (assembler) and, when present, the reviewer (verifier).

import { METRICS, CONTEXT_FIELDS } from "./protocol.js";

export const CODE_SYSTEM = "urn:riffle:codesystem:visual-stream-assessment";
const PARTICIPANT = "http://terminology.hl7.org/CodeSystem/provenance-participant-type";
const OBS_CATEGORY = "http://terminology.hl7.org/CodeSystem/observation-category";

const uuid = () => globalThis.crypto.randomUUID();
const label = (field, value) => CONTEXT_FIELDS[field].find(([v]) => v === value)?.[1] ?? value;

/**
 * @param {object} a       assessment (see engine.validate)
 * @param {object} result  return value of engine.validate
 * @param {object} site    { id, name, lat, lon }
 * @param {object} [review] { status: "approved"|"rejected", reviewer, reason, at }
 */
export function toBundle(a, result, site, review = null) {
  const status = !review ? "preliminary" : review.status === "approved" ? "final" : "entered-in-error";
  const when = a.observedAt ?? new Date().toISOString();
  const entries = [];

  const locId = uuid();
  entries.push({
    fullUrl: `urn:uuid:${locId}`,
    resource: {
      resourceType: "Location",
      id: locId,
      identifier: [{ system: "urn:riffle:site", value: site.id }],
      name: site.name,
      position: { latitude: site.lat, longitude: site.lon },
    },
  });
  const subject = { reference: `urn:uuid:${locId}`, display: site.name };

  const notesFor = (metricId) =>
    result.checks
      .filter((c) => c.metrics.includes(metricId))
      .map((c) => ({ text: `[Riffle ${c.id}${c.confirmed ? ", citizen re-checked" : ""}] ${c.message}` }));

  const obsRefs = [];
  const pushObs = (resource) => {
    const id = uuid();
    entries.push({ fullUrl: `urn:uuid:${id}`, resource: { resourceType: "Observation", id, ...resource } });
    obsRefs.push({ reference: `urn:uuid:${id}` });
  };

  for (const m of METRICS) {
    const score = a.scores[m.id];
    const note = notesFor(m.id);
    pushObs({
      status,
      category: [{ coding: [{ system: OBS_CATEGORY, code: "survey" }] }],
      code: { coding: [{ system: CODE_SYSTEM, code: m.id, display: m.term }], text: m.question },
      subject,
      effectiveDateTime: when,
      valueInteger: score,
      interpretation: [{ text: m.options.find(([v]) => v === score)?.[1] }],
      ...(note.length ? { note } : {}),
    });
  }

  for (const field of Object.keys(CONTEXT_FIELDS)) {
    if (a[field] == null) continue;
    pushObs({
      status,
      category: [{ coding: [{ system: OBS_CATEGORY, code: "survey" }] }],
      code: { coding: [{ system: CODE_SYSTEM, code: field }] },
      subject,
      effectiveDateTime: when,
      valueCodeableConcept: { coding: [{ system: CODE_SYSTEM, code: a[field], display: label(field, a[field]) }] },
    });
  }

  // Overall review priority, with every contributing check listed.
  pushObs({
    status,
    code: { coding: [{ system: CODE_SYSTEM, code: "review-priority", display: "Riffle review priority" }] },
    subject,
    effectiveDateTime: when,
    valueQuantity: { value: result.priority, unit: "probability", system: "http://unitsofmeasure.org", code: "1" },
    interpretation: [{ text: result.decision }],
    note: [
      ...result.checks.map((c) => ({ text: `${c.id} (weight ${c.effectiveWeight.toFixed(2)}): ${c.message}` })),
      ...result.healthNotes.map((h) => ({ text: `One Health note: ${h.text}` })),
      ...(review?.reason ? [{ text: `Reviewer: ${review.reason}` }] : []),
    ],
  });

  const agents = [
    {
      type: { coding: [{ system: PARTICIPANT, code: "performer" }] },
      who: { identifier: { system: "urn:riffle:citizen", value: a.citizenId ?? "anonymous" }, display: "Citizen scientist" },
    },
    {
      type: { coding: [{ system: PARTICIPANT, code: "assembler" }] },
      who: { display: "Riffle validator 0.1.0 (rules + site statistics, no autonomous edits)" },
    },
  ];
  if (review) {
    agents.push({
      type: { coding: [{ system: PARTICIPANT, code: "verifier" }] },
      who: { identifier: { system: "urn:riffle:reviewer", value: review.reviewer }, display: "Human reviewer" },
    });
  }

  const provId = uuid();
  entries.push({
    fullUrl: `urn:uuid:${provId}`,
    resource: {
      resourceType: "Provenance",
      id: provId,
      target: obsRefs,
      recorded: review?.at ?? new Date().toISOString(),
      location: subject,
      agent: agents,
    },
  });

  return { resourceType: "Bundle", id: uuid(), type: "collection", timestamp: new Date().toISOString(), entry: entries };
}
