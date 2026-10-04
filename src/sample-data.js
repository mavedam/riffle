// SYNTHETIC demo data. These are not real observations from any stream or
// from the OneAquaHealth platform. They exist so the outlier checks have a
// site history to compare against during the demo.

const v = (date, channel, banks, vegetation, clarity, algae, litter, flow, habitat) => ({
  observedAt: `${date}T10:00:00Z`,
  scores: { channel, banks, vegetation, clarity, algae, litter, flow, habitat },
});

export const SITES = [
  {
    id: "demo-a",
    name: "Demo Site A: semi-natural urban stretch (synthetic)",
    lat: 40.205,
    lon: -8.415,
    history: [
      v("2026-06-02", 4, 4, 4, 4, 4, 3, 4, 4),
      v("2026-06-16", 4, 4, 4, 4, 4, 4, 4, 4),
      v("2026-06-30", 4, 3, 4, 4, 3, 3, 4, 4),
      v("2026-07-14", 4, 4, 4, 4, 4, 3, 3, 4),
      v("2026-07-28", 4, 4, 5, 4, 4, 4, 4, 4),
      v("2026-08-11", 4, 4, 4, 5, 4, 3, 3, 4),
      v("2026-08-25", 4, 4, 4, 4, 4, 3, 4, 3),
      v("2026-09-08", 4, 4, 4, 4, 3, 3, 4, 4),
    ],
  },
  {
    id: "demo-b",
    name: "Demo Site B: walled channel near a road (synthetic)",
    lat: 40.198,
    lon: -8.43,
    history: [
      v("2026-06-05", 2, 3, 2, 3, 3, 2, 3, 2),
      v("2026-06-19", 2, 3, 2, 3, 3, 2, 3, 2),
      v("2026-07-03", 2, 3, 2, 2, 3, 2, 3, 2),
      v("2026-07-17", 2, 3, 2, 3, 2, 2, 2, 2),
      v("2026-07-31", 2, 2, 2, 3, 3, 1, 3, 2),
      v("2026-08-14", 2, 3, 2, 3, 3, 2, 3, 2),
      v("2026-08-28", 2, 3, 2, 3, 3, 2, 3, 2),
    ],
  },
  {
    id: "demo-new",
    name: "New site, no history yet (synthetic)",
    lat: 40.21,
    lon: -8.4,
    history: [],
  },
];
