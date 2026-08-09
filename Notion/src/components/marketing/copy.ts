/**
 * Every string on the marketing site.
 *
 * Kept out of the components so the page reads as structure and the copy can
 * be reviewed (or localised) in one pass. Product naming comes from
 * `brand.name` at the call site rather than being spelled out here, so a
 * rebrand does not require touching this file.
 */

import { routes } from "@/config/app.config";

export interface NavLeafItem {
  label: string;
  description: string;
  href: string;
}

export interface NavItem {
  label: string;
  href?: string;
  /** Present ⇒ the item is a mega-menu trigger rather than a plain link. */
  panel?: NavLeafItem[];
}

/** Centre column of the nav, in the order the live site ships them. */
export const NAV_ITEMS: NavItem[] = [
  {
    label: "Product",
    panel: [
      {
        label: "Docs",
        description: "Write, plan and think in one place.",
        href: routes.workspace,
      },
      {
        label: "Knowledge Base",
        description: "One home for every answer your team needs.",
        href: routes.workspace,
      },
      {
        label: "Projects",
        description: "Ship work on time, every time.",
        href: routes.workspace,
      },
      {
        label: "Notion AI",
        description: "Ask anything, and get answers from your work.",
        href: routes.workspace,
      },
      {
        label: "Calendar",
        description: "Time and tasks, finally in the same view.",
        href: routes.workspace,
      },
      {
        label: "Mail",
        description: "An inbox that drafts, sorts and follows up.",
        href: routes.workspace,
      },
      {
        label: "Templates",
        description: "Start from something that already works.",
        href: routes.workspace,
      },
    ],
  },
  {
    label: "Resources",
    panel: [
      {
        label: "Help center",
        description: "Guided answers for every feature.",
        href: routes.home,
      },
      {
        label: "Blog",
        description: "Product news and the thinking behind it.",
        href: routes.home,
      },
      {
        label: "Community",
        description: "Millions of makers, sharing what they build.",
        href: routes.home,
      },
      {
        label: "Guides",
        description: "Deep dives on getting set up fast.",
        href: routes.home,
      },
      {
        label: "Webinars",
        description: "Live sessions with the people who build it.",
        href: routes.home,
      },
      {
        label: "Customer stories",
        description: "How the best teams actually run.",
        href: routes.home,
      },
    ],
  },
  { label: "Developers", href: routes.home },
  { label: "Enterprise", href: routes.home },
  { label: "Pricing", href: routes.pricing },
  { label: "Request a demo", href: "#request-demo" },
];

export const HERO = {
  /** The pill rotates through these; the pill width morphs between them. */
  rotatingWords: ["Think", "Ship", "Create", "Jam"],
  headlinePrefix: "Where teams and agents",
  headlineSuffix: "together.",
  deck: "Capture context, find answers, and automate tasks with AI built for your team.",
} as const;

export const CTA = {
  primary: { label: "Get Notion free", href: routes.workspace },
  secondary: { label: "Request a demo", href: "#request-demo" },
} as const;

export const LOGO_WALL = {
  eyebrow: "Trusted by 98% of the Forbes Cloud 100",
  logos: [
    "OpenAI",
    "Figma",
    "Ramp",
    "Cursor",
    "Vercel",
    "Nvidia",
    "Volvo",
    "L'Oréal",
    "Discord",
    "1Password",
    "Affirm",
    "Riot Games",
    "Clay",
    "Remote",
    "Faire",
    "Toyota",
  ],
} as const;

export const STATS = [
  "Over 100M users worldwide",
  "#1 knowledge base 3 years running (G2)",
  "#1 AI enterprise search (G2)",
  "#1 rated AI writing (G2)",
  "62% of Fortune 100",
  "Over 50% of YC companies",
  "1.4M+ community members",
] as const;

export const TESTIMONIALS = {
  heading: "Trusted by teams that ship.",
  lead: {
    quote:
      "We replaced four tools with one. The agents pick up the busywork overnight, so Monday starts with decisions instead of status updates.",
    name: "Priya Raman",
    role: "VP Operations, Ramp",
  },
  rotating: [
    {
      quote:
        "Search actually finds the thing. That sounds small until it saves every engineer an hour a day.",
      name: "Marcus Ellery",
      role: "Staff Engineer, Cursor",
    },
    {
      quote:
        "Our onboarding doc went from a wiki nobody read to the first thing new hires open.",
      name: "Sofia Lindqvist",
      role: "Head of People, Volvo",
    },
    {
      quote:
        "The reporting agent writes the weekly update better than I did, and it never forgets a project.",
      name: "Dan Okafor",
      role: "Director of Product, Affirm",
    },
    {
      quote:
        "One workspace for docs, projects and answers. Nothing falls between the tools anymore.",
      name: "Yuki Tanaka",
      role: "Program Lead, Toyota",
    },
  ],
} as const;

export const CTA_BAND = {
  heading: "Get started today.",
  deck: "Free to try. Bring your whole team when you're ready.",
} as const;

export interface FooterColumn {
  heading: string;
  links: { label: string; href: string }[];
}

export const FOOTER_COLUMNS: FooterColumn[] = [
  {
    heading: "Company",
    links: [
      { label: "About us", href: routes.home },
      { label: "Careers", href: routes.home },
      { label: "Security", href: routes.home },
      { label: "Status", href: routes.home },
      { label: "Terms & privacy", href: routes.home },
      { label: "Your privacy rights", href: routes.home },
    ],
  },
  {
    heading: "Download",
    links: [
      { label: "iOS & Android", href: routes.home },
      { label: "Mac & Windows", href: routes.home },
      { label: "Calendar", href: routes.home },
      { label: "Web Clipper", href: routes.home },
    ],
  },
  {
    heading: "Resources",
    links: [
      { label: "Help center", href: routes.home },
      { label: "Pricing", href: routes.pricing },
      { label: "Blog", href: routes.home },
      { label: "Community", href: routes.home },
      { label: "Connections", href: routes.home },
      { label: "Templates", href: routes.home },
      { label: "Partner programs", href: routes.home },
    ],
  },
  {
    heading: "Notion for",
    links: [
      { label: "Enterprise", href: routes.home },
      { label: "Startups", href: routes.home },
      { label: "Small business", href: routes.home },
      { label: "Personal", href: routes.home },
    ],
  },
];

export interface PricingPlan {
  name: string;
  price: string;
  /** Shown under the price. Required so no plan falls back to wrong copy. */
  cadence: string;
  blurb: string;
  cta: { label: string; href: string };
  emphasis?: boolean;
  features: string[];
}

export const PRICING_PLANS: PricingPlan[] = [
  {
    name: "Free",
    price: "$0",
    cadence: "free forever",
    blurb: "For individuals organising every corner of their life.",
    cta: { label: "Get started", href: routes.workspace },
    features: [
      "Unlimited pages and blocks",
      "Collaborative workspace",
      "Basic page analytics",
      "7-day page history",
      "Integrate with Slack, GitHub and more",
    ],
  },
  {
    name: "Plus",
    price: "$12",
    cadence: "per seat / month",
    blurb: "For small teams that need a shared source of truth.",
    cta: { label: "Get started", href: routes.workspace },
    emphasis: true,
    features: [
      "Everything in Free",
      "Unlimited file uploads",
      "30-day page history",
      "Up to 100 guests",
      "Custom automations",
    ],
  },
  {
    name: "Business",
    price: "$24",
    cadence: "per seat / month",
    blurb: "For companies running projects and knowledge in one place.",
    cta: { label: "Get started", href: routes.workspace },
    features: [
      "Everything in Plus",
      "SAML single sign-on",
      "Private teamspaces",
      "Bulk PDF export",
      "90-day page history",
    ],
  },
  {
    name: "Enterprise",
    price: "Custom",
    cadence: "annual billing",
    blurb: "For organisations with advanced security and control needs.",
    cta: { label: "Request a demo", href: "#request-demo" },
    features: [
      "Everything in Business",
      "User provisioning (SCIM)",
      "Advanced security & audit log",
      "Customer success manager",
      "Unlimited page history",
    ],
  },
];
