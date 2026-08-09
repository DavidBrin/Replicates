/**
 * A miniature, purely presentational rendering of the product for the hero.
 *
 * Deliberately *not* wrapped in browser chrome — the live site shows the app
 * surface directly, with no title bar and no traffic lights, and the panel's
 * hairline border plus the bottom fade do the framing instead.
 *
 * Everything is divs and inline SVG: no screenshot, no network request, and it
 * stays sharp on any display.
 */

const EVENTS = [
  { time: "9:00 AM", label: "Design sync", tint: "#93CDFE" },
  { time: "11:30 AM", label: "Pricing review", tint: "#A39E98" },
  { time: "2:00 PM", label: "Agent standup", tint: "#62AEF0" },
];

const AGENTS = ["Research agent", "QA triage", "Weekly report"];
const TEAMSPACES = ["Engineering", "Design", "Go-to-market"];
const PRIVATE = ["Meeting notes", "Reading list"];

const VIEWS = ["Board", "Table", "Timeline", "Calendar"];

interface MockCard {
  title: string;
  chip: string;
  tone: "blue" | "gray" | "green" | "amber";
  faces: number;
}

const COLUMNS: { name: string; cards: MockCard[] }[] = [
  {
    name: "Backlog",
    cards: [
      { title: "Vendor onboarding flow", chip: "Ops", tone: "gray", faces: 2 },
      { title: "Card controls v2", chip: "Design", tone: "blue", faces: 1 },
      { title: "Expense policy refresh", chip: "Finance", tone: "amber", faces: 2 },
    ],
  },
  {
    name: "In progress",
    cards: [
      { title: "Approvals inbox", chip: "Eng", tone: "blue", faces: 3 },
      { title: "Receipt matching", chip: "AI", tone: "green", faces: 1 },
    ],
  },
  {
    name: "In review",
    cards: [
      { title: "Q3 spend report", chip: "Finance", tone: "amber", faces: 2 },
      { title: "SSO rollout", chip: "Security", tone: "gray", faces: 1 },
    ],
  },
  {
    name: "Done",
    cards: [
      { title: "Bill pay redesign", chip: "Design", tone: "blue", faces: 2 },
      { title: "Travel policy", chip: "Ops", tone: "green", faces: 1 },
    ],
  },
];

const TONES: Record<MockCard["tone"], { bg: string; fg: string }> = {
  blue: { bg: "var(--mkt-blue-200)", fg: "var(--mkt-blue-700)" },
  gray: { bg: "var(--mkt-gray-200)", fg: "var(--mkt-gray-600)" },
  green: { bg: "#E8F1EC", fg: "#2A533C" },
  amber: { bg: "#F9F3DC", fg: "#655121" },
};

const FACE_COLORS = ["#93CDFE", "#F9F3DC", "#E8F1EC", "#DFDCD9", "#E6F3FE"];

export function AppMockup() {
  return (
    <div className="mkt-mock flex" style={{ background: "#fff" }}>
      {/* ---------------------------------------------------- sidebar --- */}
      <aside
        className="hidden w-[200px] shrink-0 flex-col gap-0.5 p-2 sm:flex"
        style={{
          background: "var(--mkt-gray-100)",
          borderRight: "1px solid var(--mkt-border-base)",
        }}
      >
        <div className="mkt-mock__sidebar-row" style={{ fontWeight: 600 }}>
          <span
            className="grid size-4 place-items-center rounded-[3px] text-[9px] font-semibold text-white"
            style={{ background: "var(--mkt-gray-900)" }}
          >
            R
          </span>
          Ramp
        </div>

        <div className="mkt-mock__sidebar-row">
          <Glyph kind="search" /> Search
        </div>
        <div className="mkt-mock__sidebar-row">
          <Glyph kind="home" /> Home
        </div>

        <p className="mkt-mock__section-label">Upcoming events</p>
        {EVENTS.map((event) => (
          <div key={event.label} className="mkt-mock__sidebar-row">
            <span
              className="size-1.5 shrink-0 rounded-full"
              style={{ background: event.tint }}
            />
            <span style={{ color: "var(--mkt-gray-400)" }}>{event.time}</span>
            <span className="truncate">{event.label}</span>
          </div>
        ))}

        <p className="mkt-mock__section-label">Agents</p>
        {AGENTS.map((agent) => (
          <div key={agent} className="mkt-mock__sidebar-row">
            <Glyph kind="spark" /> {agent}
          </div>
        ))}

        <p className="mkt-mock__section-label">Teamspaces</p>
        {TEAMSPACES.map((space) => (
          <div key={space} className="mkt-mock__sidebar-row">
            <Glyph kind="page" /> {space}
          </div>
        ))}

        <p className="mkt-mock__section-label">Private</p>
        {PRIVATE.map((page) => (
          <div key={page} className="mkt-mock__sidebar-row">
            <Glyph kind="page" /> {page}
          </div>
        ))}
      </aside>

      {/* ------------------------------------------------------- main --- */}
      <div className="min-w-0 flex-1">
        <div
          className="flex items-center gap-2 px-4 py-2"
          style={{ color: "var(--mkt-gray-400)" }}
        >
          <span>Teamspaces</span>
          <span>/</span>
          <span style={{ color: "var(--mkt-gray-700)" }}>Ramp HQ</span>
        </div>

        <div className="px-4 pt-2">
          <h3
            className="flex items-center gap-2"
            style={{
              fontSize: 22,
              lineHeight: "28px",
              fontWeight: 700,
              letterSpacing: "-0.02em",
              color: "var(--mkt-gray-900)",
            }}
          >
            <span aria-hidden="true">🏗️</span> Ramp HQ
          </h3>

          {/* view tab strip */}
          <div
            className="mt-3 flex items-center gap-3"
            style={{ borderBottom: "1px solid var(--mkt-border-base)" }}
          >
            {VIEWS.map((view, i) => (
              <span
                key={view}
                className="pb-1.5"
                style={
                  i === 0
                    ? {
                        color: "var(--mkt-gray-900)",
                        fontWeight: 600,
                        boxShadow: "inset 0 -2px var(--mkt-gray-900)",
                      }
                    : { color: "var(--mkt-gray-400)" }
                }
              >
                {view}
              </span>
            ))}
            <span style={{ color: "var(--mkt-gray-400)" }}>+ New</span>
          </div>
        </div>

        {/* kanban */}
        <div className="flex gap-2 overflow-hidden px-4 pt-3 pb-6">
          {COLUMNS.map((column) => (
            <div key={column.name} className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 px-1 pb-2">
                <span style={{ fontWeight: 600, color: "var(--mkt-gray-700)" }}>
                  {column.name}
                </span>
                <span style={{ color: "var(--mkt-gray-400)" }}>
                  {column.cards.length}
                </span>
              </div>
              <div className="flex flex-col gap-1.5">
                {column.cards.map((card) => (
                  <div key={card.title} className="mkt-mock__card">
                    <p
                      className="truncate"
                      style={{ color: "var(--mkt-gray-800)", fontWeight: 500 }}
                    >
                      {card.title}
                    </p>
                    <div className="mt-1.5 flex items-center justify-between gap-1">
                      <span
                        className="mkt-chip"
                        style={{
                          background: TONES[card.tone].bg,
                          color: TONES[card.tone].fg,
                        }}
                      >
                        {card.chip}
                      </span>
                      <span className="flex">
                        {Array.from({ length: card.faces }).map((_, i) => (
                          <span
                            key={i}
                            className="-ml-1 size-3.5 rounded-full first:ml-0"
                            style={{
                              background: FACE_COLORS[i % FACE_COLORS.length],
                              boxShadow: "0 0 0 1.5px #fff",
                            }}
                          />
                        ))}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Tiny 12px sidebar glyphs. */
function Glyph({ kind }: { kind: "search" | "home" | "spark" | "page" }) {
  const props = {
    width: 12,
    height: 12,
    viewBox: "0 0 12 12",
    fill: "none",
    "aria-hidden": true as const,
    stroke: "currentColor",
    strokeWidth: 1.2,
    className: "shrink-0",
    style: { color: "var(--mkt-gray-400)" },
  };
  switch (kind) {
    case "search":
      return (
        <svg {...props}>
          <circle cx="5.2" cy="5.2" r="3.4" />
          <path d="m7.8 7.8 2.4 2.4" strokeLinecap="round" />
        </svg>
      );
    case "home":
      return (
        <svg {...props}>
          <path d="M1.8 5.4 6 2l4.2 3.4V10H1.8V5.4Z" strokeLinejoin="round" />
        </svg>
      );
    case "spark":
      return (
        <svg {...props}>
          <path d="M6 1.6 7.2 4.8 10.4 6 7.2 7.2 6 10.4 4.8 7.2 1.6 6l3.2-1.2L6 1.6Z" strokeLinejoin="round" />
        </svg>
      );
    default:
      return (
        <svg {...props}>
          <path d="M2.8 1.6h4L9.2 4v6.4H2.8V1.6Z" strokeLinejoin="round" />
        </svg>
      );
  }
}
