import { METRICS, CONTEXT_FIELDS, metricById } from "./protocol.js";
import { validate, THRESHOLDS } from "./engine.js";
import { toBundle } from "./fhir.js";
import { SITES } from "./sample-data.js";

const STORE = "riffle.submissions.v1";
const $ = (sel) => document.querySelector(sel);

// Small DOM builder. All user text goes through textContent, never innerHTML.
function el(tag, attrs = {}, ...children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "class") n.className = v;
    else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat()) if (c != null) n.append(c instanceof Node ? c : String(c));
  return n;
}

const CONTEXT_LABELS = {
  odor: "Smell",
  outfall: "Pipes or drains",
  rain48h: "Rain in the last 48 hours?",
};

const DECISION_TEXT = {
  accept: "Accepted as submitted.",
  accept_with_note: "Accepted with a note for researchers.",
  review: "Sent to a human reviewer before it is used.",
};

const PRESETS = {
  typical: { site: "demo-a", scores: { channel: 4, banks: 4, vegetation: 4, clarity: 4, algae: 4, litter: 3, flow: 4, habitat: 4 }, odor: "earthy", outfall: "none", rain48h: "no", minutes: 18, photo: true },
  contradictory: { site: "demo-a", scores: { channel: 4, banks: 5, vegetation: 1, clarity: 5, algae: 4, litter: 3, flow: 1, habitat: 4 }, odor: "none", outfall: "none", rain48h: "no", minutes: 3, photo: false },
  rain: { site: "demo-b", scores: { channel: 2, banks: 3, vegetation: 2, clarity: 1, algae: 3, litter: 2, flow: 5, habitat: 2 }, odor: "earthy", outfall: "pipe_flowing", rain48h: "yes", minutes: 14, photo: true },
  sewage: { site: "demo-b", scores: { channel: 2, banks: 3, vegetation: 2, clarity: 2, algae: 1, litter: 2, flow: 3, habitat: 2 }, odor: "sewage", outfall: "pipe_flowing", rain48h: "no", minutes: 20, photo: true },
};

let confirmed = new Set();
let lastResult = null;

// ---- render form -----------------------------------------------------------

function renderForm() {
  const siteSel = $("#site");
  for (const s of SITES) siteSel.append(el("option", { value: s.id }, `${s.name} · ${s.history.length} past visits`));

  const host = $("#metrics");
  METRICS.forEach((m, i) => {
    host.append(
      el("fieldset", { class: "metric", id: `fs-${m.id}` },
        el("legend", {}, `${i + 1}. ${m.question}`),
        el("p", { class: "term" }, "Scientists call this ", el("strong", {}, m.term), `. ${m.help}`),
        el("div", { class: "options" },
          m.options.map(([val, text]) =>
            el("label", { class: "opt" },
              el("input", { type: "radio", name: m.id, value: String(val), required: true }),
              el("span", { class: "score", "aria-hidden": "true" }, String(val)),
              el("span", {}, text)))),
      ),
    );
  });

  const ctx = $("#context");
  for (const [field, opts] of Object.entries(CONTEXT_FIELDS)) {
    ctx.append(
      el("label", {}, CONTEXT_LABELS[field],
        el("select", { id: field, name: field }, opts.map(([v, t]) => el("option", { value: v }, t)))),
    );
  }
  $("#rain48h").value = "unsure";
}

function readForm() {
  const f = $("#assess-form");
  const scores = {};
  for (const m of METRICS) {
    const checked = f.querySelector(`input[name="${m.id}"]:checked`);
    if (checked) scores[m.id] = Number(checked.value);
  }
  const minutes = Number($("#minutes").value);
  return {
    siteId: $("#site").value,
    observedAt: new Date().toISOString(),
    citizenId: "demo-citizen",
    scores,
    odor: $("#odor").value,
    outfall: $("#outfall").value,
    rain48h: $("#rain48h").value,
    minutesOnSite: Number.isFinite(minutes) && $("#minutes").value !== "" ? minutes : undefined,
    photo: $("#photo").checked,
  };
}

function applyPreset(p) {
  $("#site").value = p.site;
  for (const [id, v] of Object.entries(p.scores)) {
    const r = document.querySelector(`input[name="${id}"][value="${v}"]`);
    if (r) r.checked = true;
  }
  $("#odor").value = p.odor;
  $("#outfall").value = p.outfall;
  $("#rain48h").value = p.rain48h;
  $("#minutes").value = p.minutes;
  $("#photo").checked = p.photo;
  resetCheck();
}

function resetCheck() {
  confirmed = new Set();
  lastResult = null;
  $("#submit-btn").disabled = true;
  $("#feedback").replaceChildren();
}

// ---- check & feedback ---------------------------------------------------------

function runCheck() {
  const a = readForm();
  const site = SITES.find((s) => s.id === a.siteId);
  const result = validate(a, site.history, confirmed);
  lastResult = { a, result, site };
  renderFeedback(result);
  $("#submit-btn").disabled = !result.complete;
}

function renderFeedback(result) {
  const fb = $("#feedback");
  fb.replaceChildren();

  if (!result.complete) {
    const names = result.missing.map((id) => metricById(id).term).join(", ");
    fb.append(el("div", { class: "card warn", role: "alert" }, el("h2", {}, "A few questions are still open"), el("p", {}, names)));
    $(`#fs-${result.missing[0]} input`).focus();
    return;
  }

  const pct = Math.round(result.priority * 100);
  fb.append(
    el("div", { class: `card decision ${result.decision}` },
      el("h2", {}, result.checks.length ? "Riffle's second look" : "Looks consistent"),
      el("p", {}, el("strong", {}, DECISION_TEXT[result.decision])),
      el("label", { for: "prio" }, `Review priority: ${pct}% `,
        el("span", { class: "note" }, `(review at ${THRESHOLDS.review * 100}% or more)`)),
      el("meter", { id: "prio", min: "0", max: "1", low: String(THRESHOLDS.accept), high: String(THRESHOLDS.review), optimum: "0", value: String(result.priority) }, `${pct}%`),
    ),
  );

  if (result.checks.length) {
    const list = el("ol", { class: "checks" });
    for (const c of result.checks) {
      const firstMetric = c.metrics[0];
      list.append(
        el("li", { class: c.confirmed ? "confirmed" : "" },
          el("p", {}, el("span", { class: `kind ${c.kind}` }, c.kind), " ", c.message),
          el("p", { class: "prompt" }, c.prompt),
          el("p", { class: "weight" }, `Adds ${(c.effectiveWeight * 100).toFixed(0)}% evidence${c.confirmed ? " (halved: you re-checked and kept your answer)" : ""}`),
          c.confirmed
            ? el("p", { class: "ok" }, "✓ You re-checked this. Your answer stands.")
            : el("div", { class: "row" },
                el("button", { type: "button", onclick: () => { confirmed.add(c.id); runCheck(); } }, "I re-checked, keep my answer"),
                firstMetric && c.metrics.length < 8
                  ? el("button", { type: "button", class: "link", onclick: () => { $(`#fs-${firstMetric}`).scrollIntoView({ block: "center" }); $(`#fs-${firstMetric} input:checked, #fs-${firstMetric} input`).focus(); } }, "Change my answer")
                  : null),
        ),
      );
    }
    fb.append(el("div", { class: "card" }, el("h3", {}, "Why"), list));
  }

  if (result.healthNotes.length) {
    fb.append(
      el("div", { class: "card health" },
        el("h3", {}, "One Health notes"),
        el("ul", {}, result.healthNotes.map((h) =>
          el("li", {}, h.text, h.action ? el("span", { class: "note" }, ` Next step: ${h.action}`) : null))),
      ),
    );
  }
}

// ---- storage, submit, review -------------------------------------------------

const load = () => JSON.parse(localStorage.getItem(STORE) ?? "[]");
const save = (subs) => localStorage.setItem(STORE, JSON.stringify(subs));

function submit(e) {
  e.preventDefault();
  if (!lastResult?.result.complete) return;
  // Re-validate so the stored result matches exactly what was on screen.
  const { a, site } = lastResult;
  const result = validate(a, site.history, confirmed);
  const subs = load();
  subs.unshift({ id: crypto.randomUUID(), a, result, site: { id: site.id, name: site.name, lat: site.lat, lon: site.lon }, review: null });
  save(subs);
  $("#feedback").replaceChildren(
    el("div", { class: `card decision ${result.decision}`, role: "status" },
      el("h2", {}, "Thank you, submitted"),
      el("p", {}, DECISION_TEXT[result.decision]),
      result.needsFollowUp ? el("p", {}, "Your health observations were also sent to a person for follow-up.") : null,
      result.decision === "review" || result.needsFollowUp ? el("p", {}, "Open the Reviewer queue tab to see what the reviewer sees.") : null),
  );
  $("#assess-form").reset();
  $("#rain48h").value = "unsure";
  confirmed = new Set();
  lastResult = null;
  $("#submit-btn").disabled = true;
  renderQueue();
}

function review(id, status, reason) {
  const subs = load();
  const s = subs.find((x) => x.id === id);
  s.review = { status, reason, reviewer: "demo-reviewer", at: new Date().toISOString() };
  save(subs);
  renderQueue();
}

function downloadBundle(s) {
  const bundle = toBundle(s.a, s.result, s.site, s.review);
  const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/fhir+json" });
  const url = URL.createObjectURL(blob);
  el("a", { href: url, download: `riffle-${s.site.id}-${s.id.slice(0, 8)}.fhir.json` }).click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function statusText(s) {
  if (s.review) return s.review.status === "approved" ? "Approved by reviewer (FHIR: final)" : "Rejected by reviewer (FHIR: entered-in-error)";
  if (s.result.decision === "review") return "Waiting for review (FHIR: preliminary)";
  if (s.result.needsFollowUp) return "Health follow-up needed (FHIR: preliminary)";
  return "Auto-accepted, not human-verified (FHIR: preliminary)";
}

function submissionCard(s, withReview) {
  const reasonId = `reason-${s.id}`;
  return el("article", { class: "card" },
    el("h3", {}, `${s.site.name}`),
    el("p", { class: "note" }, `${new Date(s.a.observedAt).toLocaleString()} · priority ${Math.round(s.result.priority * 100)}% · ${statusText(s)}`),
    s.result.checks.length
      ? el("ul", {}, s.result.checks.map((c) => el("li", {}, `${c.message}${c.confirmed ? " (citizen re-checked and kept answer)" : ""}`)))
      : el("p", {}, "No flags."),
    s.result.healthNotes.length ? el("p", { class: "health-inline" }, `One Health: ${s.result.healthNotes.map((h) => h.text).join(" ")}`) : null,
    s.review?.reason ? el("p", {}, `Reviewer note: ${s.review.reason}`) : null,
    withReview
      ? el("div", { class: "review" },
          el("label", { for: reasonId }, "Reason or note (required to reject)"),
          el("textarea", { id: reasonId, rows: "2" }),
          el("div", { class: "row" },
            el("button", { type: "button", class: "primary", onclick: () => review(s.id, "approved", $(`#${CSS.escape(reasonId)}`).value.trim()) }, "Approve"),
            el("button", { type: "button", onclick: () => {
              const ta = $(`#${CSS.escape(reasonId)}`);
              const reason = ta.value.trim();
              if (!reason) { ta.setAttribute("aria-invalid", "true"); ta.focus(); return; }
              review(s.id, "rejected", reason);
            } }, "Reject")))
      : null,
    el("div", { class: "row" },
      el("button", { type: "button", class: "link", onclick: () => downloadBundle(s) }, "Download FHIR R4 Bundle"),
      el("details", {}, el("summary", {}, "View FHIR JSON"), el("pre", {}, JSON.stringify(toBundle(s.a, s.result, s.site, s.review), null, 2)))),
  );
}

function renderQueue() {
  const subs = load();
  const pending = subs.filter((s) => (s.result.decision === "review" || s.result.needsFollowUp) && !s.review);
  $("#queue-count").textContent = String(pending.length);
  $("#queue").replaceChildren(...(pending.length ? pending.map((s) => submissionCard(s, true)) : [el("p", {}, "Nothing waiting.")]));
  $("#all").replaceChildren(...(subs.length ? subs.map((s) => submissionCard(s, false)) : [el("p", {}, "No submissions yet.")]));
}

// ---- tabs ------------------------------------------------------------------------

function selectTab(which) {
  for (const t of ["assess", "review"]) {
    const on = t === which;
    $(`#tab-${t}`).setAttribute("aria-selected", String(on));
    $(`#tab-${t}`).tabIndex = on ? 0 : -1;
    $(`#view-${t}`).hidden = !on;
  }
}

// ---- wire up ---------------------------------------------------------------------

renderForm();
renderQueue();
$("#check-btn").addEventListener("click", runCheck);
$("#assess-form").addEventListener("submit", submit);
// Any answer change invalidates the previous check.
$("#assess-form").addEventListener("change", resetCheck);
document.querySelectorAll("[data-preset]").forEach((b) => b.addEventListener("click", () => applyPreset(PRESETS[b.dataset.preset])));
$("#tab-assess").addEventListener("click", () => selectTab("assess"));
$("#tab-review").addEventListener("click", () => selectTab("review"));
$("nav").addEventListener("keydown", (e) => {
  if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
  const next = $("#tab-assess").getAttribute("aria-selected") === "true" ? "review" : "assess";
  selectTab(next);
  $(`#tab-${next}`).focus();
});
$("#clear-btn").addEventListener("click", () => { localStorage.removeItem(STORE); renderQueue(); });
