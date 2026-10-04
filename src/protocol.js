// Riffle demo assessment protocol.
//
// Loosely modeled on public visual stream assessment protocols (e.g. the
// NRCS Stream Visual Assessment Protocol). It is NOT the OneAquaHealth
// Citizen Science App schema. Mapping to that schema is listed as next work
// in the README. Every metric is scored 1-5 where 5 = best condition.

export const METRICS = [
  {
    id: "channel",
    question: "How natural does the stream channel look?",
    term: "Channel alteration",
    help: "Concrete walls, straightened banks or culverts mean the channel has been altered.",
    options: [
      [1, "Concrete or piped"],
      [2, "Mostly straightened or walled"],
      [3, "Some walls or rip-rap"],
      [4, "Mostly natural, a few changes"],
      [5, "Natural bends, no walls"],
    ],
  },
  {
    id: "banks",
    question: "Are the banks holding firm?",
    term: "Bank stability",
    help: "Look for bare soil collapsing into the water, exposed roots, or undercut edges.",
    options: [
      [1, "Collapsing in many places"],
      [2, "Frequent bare, slumping patches"],
      [3, "Some erosion"],
      [4, "Small patches only"],
      [5, "Firm, no visible erosion"],
    ],
  },
  {
    id: "vegetation",
    question: "How much plant cover grows along the banks?",
    term: "Riparian vegetation",
    help: "Trees, shrubs and tall grasses within about 10 metres of the water.",
    options: [
      [1, "Almost none"],
      [2, "A thin strip or mown lawn"],
      [3, "Patchy cover"],
      [4, "Mostly covered"],
      [5, "Dense, wide plant cover"],
    ],
  },
  {
    id: "clarity",
    question: "How clear is the water?",
    term: "Visual turbidity",
    help: "Can you see the stream bed in shallow parts?",
    options: [
      [1, "Opaque, cannot see 5 cm"],
      [2, "Very cloudy"],
      [3, "Slightly cloudy"],
      [4, "Mostly clear"],
      [5, "Clear to the bed"],
    ],
  },
  {
    id: "algae",
    question: "How much green slime or algae do you see?",
    term: "Nuisance algae (periphyton)",
    help: "Thick mats, long green strands, or surface scum.",
    options: [
      [1, "Thick mats or surface scum"],
      [2, "Lots of long strands"],
      [3, "Some patches"],
      [4, "A thin film on rocks"],
      [5, "None visible"],
    ],
  },
  {
    id: "litter",
    question: "How much trash is in or beside the stream?",
    term: "Refuse",
    help: "Count anything human-made: bags, bottles, tyres, carts.",
    options: [
      [1, "Dumped piles"],
      [2, "Lots of items"],
      [3, "Several items"],
      [4, "One or two items"],
      [5, "None"],
    ],
  },
  {
    id: "flow",
    question: "How is the water moving?",
    term: "Channel flow status",
    help: "Look across the whole width of the channel.",
    options: [
      [1, "Dry bed, no water"],
      [2, "Standing pools only"],
      [3, "A trickle"],
      [4, "Moderate flow"],
      [5, "Steady flow across the channel"],
    ],
  },
  {
    id: "habitat",
    question: "Are there places for fish and insects to hide?",
    term: "Instream cover",
    help: "Rocks, logs, overhanging plants, undercut banks, leaf packs.",
    options: [
      [1, "None, smooth bed"],
      [2, "Very few"],
      [3, "Some"],
      [4, "Many"],
      [5, "Many kinds, everywhere"],
    ],
  },
];

export const CONTEXT_FIELDS = {
  odor: [
    ["none", "No smell"],
    ["earthy", "Earthy or musty"],
    ["rotten_egg", "Rotten egg"],
    ["sewage", "Sewage"],
    ["chemical", "Chemical, fuel or solvent"],
  ],
  outfall: [
    ["none", "No pipes seen"],
    ["pipe_dry", "Pipe present, not flowing"],
    ["pipe_flowing", "Pipe flowing into the stream"],
  ],
  rain48h: [
    ["yes", "Yes"],
    ["no", "No"],
    ["unsure", "Not sure"],
  ],
};

export const METRIC_IDS = METRICS.map((m) => m.id);

export function metricById(id) {
  return METRICS.find((m) => m.id === id);
}
