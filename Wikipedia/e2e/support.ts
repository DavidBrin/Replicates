/**
 * Shared fixtures for the e2e suite: every title registered in
 * `src/content/articles/index.ts` (David's Internet + replica and demo
 * articles), and the homepage table link texts mapped to the article
 * titles they land on. Kept in one place so a content-agent rename only
 * needs updating here.
 */
export const KNOWN_TITLES = [
  "David's Internet",
  "Linear (replica)",
  "Notion (replica)",
  "YouTube (replica)",
  "Super Smash (replica)",
  "Fake Phone",
  "Bet (app)",
  "Dollar Pixels",
  "Verilog",
  "Nocturnal Neuro",
  "Signals and Systems Lab",
  "Quantum Playground",
  "HardHack 2026",
  "ESP32 Thermal TinyML",
  "Organoids on Psychedelics",
  "Anatomy of a Spike",
  "Computer Vision",
  "arXiv Semantic Graph",
] as const;

export const PROJECT_LINKS: Array<{ linkText: string; title: string }> = [
  { linkText: "Linear", title: "Linear (replica)" },
  { linkText: "Notion", title: "Notion (replica)" },
  { linkText: "YouTube", title: "YouTube (replica)" },
  { linkText: "Super Smash", title: "Super Smash (replica)" },
  { linkText: "Fake Phone", title: "Fake Phone" },
  { linkText: "Bet", title: "Bet (app)" },
  { linkText: "Dollar Pixels", title: "Dollar Pixels" },
  { linkText: "Verilog", title: "Verilog" },
  { linkText: "Nocturnal Neuro", title: "Nocturnal Neuro" },
  { linkText: "Signals and Systems Lab", title: "Signals and Systems Lab" },
  { linkText: "Quantum Playground", title: "Quantum Playground" },
  { linkText: "HardHack 2026", title: "HardHack 2026" },
  { linkText: "ESP32 Thermal TinyML", title: "ESP32 Thermal TinyML" },
  { linkText: "Organoids on Psychedelics", title: "Organoids on Psychedelics" },
  { linkText: "Anatomy of a Spike", title: "Anatomy of a Spike" },
  { linkText: "Computer Vision", title: "Computer Vision" },
  { linkText: "arXiv Semantic Graph", title: "arXiv Semantic Graph" },
];
