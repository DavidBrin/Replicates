"use client";

import { useState } from "react";
import { cn } from "@/lib/utils/cn";
import { Container } from "./Marketing";
import { MiniPanel, type MiniPanelProps } from "./MiniPanel";

export interface FeatureTab {
  id: string;
  /** Tab strip label. */
  label: string;
  /** Copy shown beside the visual when this tab is active. */
  body: string;
  /** The illustrative panel for this tab. */
  panel: MiniPanelProps;
}

export interface FeatureSectionProps {
  id?: string;
  eyebrow?: string;
  heading: string;
  deck?: string;
  tabs: FeatureTab[];
  /** Flip the text/visual order — used to alternate down the page. */
  reverse?: boolean;
  /** Tint the section band; the default is plain white. */
  tinted?: boolean;
}

/**
 * The alternating text / visual feature block, used three times on the page.
 *
 * Only the tab strip is interactive, so this is the one section that needs to
 * be a client component. The panels themselves are static markup.
 */
export function FeatureSection({
  id,
  eyebrow,
  heading,
  deck,
  tabs,
  reverse = false,
  tinted = false,
}: FeatureSectionProps) {
  const [active, setActive] = useState(0);
  const tab = tabs[active];

  return (
    <section
      id={id}
      className="mkt-section"
      style={tinted ? { background: "var(--mkt-gray-100)" } : undefined}
    >
      <Container>
        <div className="grid items-center gap-10 lg:grid-cols-2 lg:gap-16">
          {/* -- copy column ---------------------------------------------- */}
          <div className={cn(reverse && "lg:order-2")}>
            {eyebrow && <p className="mkt-eyebrow mb-3">{eyebrow}</p>}
            <h2 className="mkt-h2">{heading}</h2>
            {deck && <p className="mkt-deck mt-4 max-w-[46ch]">{deck}</p>}

            {tabs.length > 1 && (
              <div
                className="mkt-tabs mt-7"
                role="tablist"
                aria-label={heading}
              >
                {tabs.map((item, i) => (
                  <button
                    key={item.id}
                    type="button"
                    role="tab"
                    id={`${item.id}-tab`}
                    aria-selected={i === active}
                    aria-controls={`${item.id}-panel`}
                    className="mkt-tab"
                    onClick={() => setActive(i)}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            )}

            <p
              className="mkt-body mt-5 max-w-[46ch]"
              style={{ color: "var(--mkt-text-muted)" }}
            >
              {tab.body}
            </p>
          </div>

          {/* -- visual column -------------------------------------------- */}
          <div
            key={tab.id}
            id={`${tab.id}-panel`}
            role="tabpanel"
            aria-labelledby={`${tab.id}-tab`}
            tabIndex={0}
            className="mkt-tabpanel"
          >
            <MiniPanel {...tab.panel} />
          </div>
        </div>
      </Container>
    </section>
  );
}
