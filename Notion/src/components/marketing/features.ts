/**
 * Content for the three alternating feature sections.
 *
 * Split out from `FeatureSection.tsx` so the component stays about behaviour
 * and this file stays about product story — and so the page can be re-ordered
 * without editing any JSX.
 */

import type { FeatureSectionProps } from "./FeatureSection";

export const FEATURE_AGENTS: FeatureSectionProps = {
  eyebrow: "Agents",
  heading: "Keep work moving 24/7.",
  deck: "Hand off the repeatable parts. Your agents pick up the thread while the team sleeps.",
  tabs: [
    {
      id: "custom-agents",
      label: "Custom Agents",
      body: "Describe the job once in plain language. The agent learns your workspace, follows your rules, and reports back where the work already lives.",
      panel: {
        title: "Vendor renewal agent",
        subtitle: "Runs daily at 07:00 · last run 4m ago",
        rows: [
          { kind: "row", text: "Scan contracts expiring in 30 days", chip: "Done", tone: "green", meta: "07:00" },
          { kind: "row", text: "Draft renewal brief", chip: "Done", tone: "green", meta: "07:02" },
          { kind: "row", text: "Ping owner in Projects", chip: "Running", tone: "blue", meta: "07:04" },
          { kind: "divider" },
          { kind: "text", text: "3 renewals flagged. 1 needs a decision from Finance.", muted: true },
        ],
      },
    },
    {
      id: "qa-agents",
      label: "Q&A agents",
      body: "Point an agent at a teamspace and it answers questions from it — with the source page attached, so nobody has to take its word for it.",
      panel: {
        title: "#ask-finance",
        subtitle: "Answers from 412 pages in Finance",
        rows: [
          { kind: "bubble", side: "right", text: "What's our per-diem for Berlin?" },
          { kind: "bubble", side: "left", text: "€64/day, plus lodging up to €180. Source: Travel policy → EU rates." },
          { kind: "bubble", side: "right", text: "Does that cover contractors?" },
          { kind: "bubble", side: "left", text: "No — contractors invoice actuals. Source: Contractor handbook §4." },
        ],
      },
    },
    {
      id: "routing-agents",
      label: "Task routing agents",
      body: "New work lands in the right queue with the right owner and the right due date, before anyone has to triage it by hand.",
      panel: {
        title: "Intake triage",
        subtitle: "18 requests routed today",
        rows: [
          { kind: "row", text: "Broken SSO redirect", chip: "Security", tone: "red", meta: "→ Ana" },
          { kind: "row", text: "New laptop, design hire", chip: "IT", tone: "blue", meta: "→ Rui" },
          { kind: "row", text: "Contract review, Acme", chip: "Legal", tone: "amber", meta: "→ Kate" },
          { kind: "row", text: "Refund exception", chip: "Finance", tone: "green", meta: "→ Sam" },
          { kind: "chips", items: [{ text: "0 unassigned", tone: "green" }, { text: "avg 40s to route", tone: "gray" }] },
        ],
      },
    },
    {
      id: "reporting-agents",
      label: "Reporting agents",
      body: "A written weekly update, assembled from what actually changed — not from what people remembered to type into a form.",
      panel: {
        title: "Weekly update — Ramp HQ",
        subtitle: "Generated Monday 06:00",
        rows: [
          { kind: "bar", label: "Shipped", value: 62, tone: "green" },
          { kind: "bar", label: "In review", value: 24, tone: "blue" },
          { kind: "bar", label: "Blocked", value: 14, tone: "red" },
          { kind: "divider" },
          { kind: "text", text: "Approvals inbox shipped Thursday. SSO rollout slipped a week — waiting on the security review.", muted: true },
        ],
      },
    },
  ],
};

export const FEATURE_ASSISTANTS: FeatureSectionProps = {
  eyebrow: "AI",
  heading: "Ask your on-demand assistants.",
  deck: "Answers grounded in your own work, not a guess from the open internet.",
  reverse: true,
  tinted: true,
  tabs: [
    {
      id: "notion-agent",
      label: "Notion Agent",
      body: "Ask it to write, restructure, summarise or plan. It edits the page in front of you and cites what it drew on.",
      panel: {
        title: "Notion Agent",
        subtitle: "Working in Ramp HQ",
        rows: [
          { kind: "bubble", side: "right", text: "Turn the Q3 retro into a one-page brief for the board." },
          { kind: "bubble", side: "left", text: "Drafted. I pulled the three recurring themes and dropped the per-team detail." },
          { kind: "chips", items: [{ text: "Q3 retro", tone: "blue" }, { text: "Board notes", tone: "gray" }, { text: "OKRs", tone: "gray" }] },
        ],
      },
    },
    {
      id: "enterprise-search",
      label: "Enterprise Search",
      body: "One search bar across docs, projects, tickets and mail. It ranks by what your team actually relies on.",
      panel: {
        title: "Search: \"refund policy\"",
        subtitle: "Across 6 connected apps",
        rows: [
          { kind: "row", text: "Refund & credit policy v4", chip: "Doc", tone: "blue", meta: "Finance" },
          { kind: "row", text: "RFC: exception thresholds", chip: "Project", tone: "amber", meta: "3d ago" },
          { kind: "row", text: "Re: refund for Acme", chip: "Mail", tone: "gray", meta: "yesterday" },
          { kind: "row", text: "Support macro — refunds", chip: "Ticket", tone: "green", meta: "updated" },
        ],
      },
    },
    {
      id: "meeting-notes",
      label: "AI Meeting Notes",
      body: "Recording, transcript, decisions and follow-ups — attached to the project they belong to, before the call has ended.",
      panel: {
        title: "Pricing review — notes",
        subtitle: "32 min · 6 attendees",
        rows: [
          { kind: "text", text: "Decision: hold the Business tier at $24 through Q4." },
          { kind: "divider" },
          { kind: "task", text: "Model the $28 scenario", done: true },
          { kind: "task", text: "Update the pricing page copy" },
          { kind: "task", text: "Brief the sales team Friday" },
        ],
      },
    },
  ],
};

export const FEATURE_WORKSPACE: FeatureSectionProps = {
  eyebrow: "One workspace",
  heading: "Bring all your work together.",
  deck: "Docs, knowledge and projects in the same place, so context never has to be re-explained.",
  tabs: [
    {
      id: "docs",
      label: "Docs",
      body: "Write with everything else one link away. Every doc is a database row, a project brief and a page at the same time.",
      panel: {
        title: "Launch brief — Approvals inbox",
        subtitle: "Edited 12 minutes ago by Ana",
        rows: [
          { kind: "text", text: "Goal: cut approval turnaround from 2 days to 2 hours." },
          { kind: "chips", items: [{ text: "Owner: Ana", tone: "blue" }, { text: "Ships Nov 12", tone: "amber" }, { text: "Eng + Design", tone: "gray" }] },
          { kind: "divider" },
          { kind: "task", text: "Scope the reviewer queue", done: true },
          { kind: "task", text: "Instrument time-to-approve" },
        ],
      },
    },
    {
      id: "knowledge-base",
      label: "Knowledge Base",
      body: "Verified pages, clear owners and a review date. The wiki stops rotting the moment someone is accountable for it.",
      panel: {
        title: "Knowledge Base",
        subtitle: "412 pages · 96% verified",
        rows: [
          { kind: "row", text: "Engineering onboarding", chip: "Verified", tone: "green", meta: "Rui" },
          { kind: "row", text: "Incident runbook", chip: "Verified", tone: "green", meta: "Ana" },
          { kind: "row", text: "Brand guidelines", chip: "Review due", tone: "amber", meta: "Kate" },
          { kind: "row", text: "Data retention", chip: "Verified", tone: "green", meta: "Sam" },
        ],
      },
    },
    {
      id: "projects",
      label: "Projects",
      body: "Board, table, timeline or calendar over the same records — every view is a lens, never a second copy.",
      panel: {
        title: "Q4 roadmap",
        subtitle: "Board · grouped by status",
        rows: [
          { kind: "row", text: "Approvals inbox", chip: "In progress", tone: "blue", meta: "Nov 12" },
          { kind: "row", text: "Receipt matching", chip: "In review", tone: "amber", meta: "Nov 19" },
          { kind: "row", text: "SSO rollout", chip: "Blocked", tone: "red", meta: "Dec 1" },
          { kind: "row", text: "Bill pay redesign", chip: "Done", tone: "green", meta: "Oct 30" },
        ],
      },
    },
  ],
};
