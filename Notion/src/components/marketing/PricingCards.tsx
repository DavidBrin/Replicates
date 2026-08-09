import Link from "next/link";
import { cn } from "@/lib/utils/cn";
import { Container } from "./Marketing";
import { Check } from "./icons";
import { PRICING_PLANS } from "./copy";

/**
 * The four plan cards.
 *
 * One card is emphasised with the blue border rather than a coloured fill, so
 * the row stays quiet — the same restraint the rest of the page uses.
 */
export function PricingCards() {
  return (
    <Container className="pb-20">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {PRICING_PLANS.map((plan) => (
          <div
            key={plan.name}
            className={cn("mkt-card flex flex-col p-6")}
            style={{
              borderColor: plan.emphasis
                ? "var(--mkt-blue-500)"
                : "var(--mkt-border-base)",
              boxShadow: plan.emphasis ? "var(--shadow-200)" : undefined,
            }}
          >
            <div className="flex items-center gap-2">
              <h2
                className="text-[18px] leading-6 font-semibold"
                style={{ color: "var(--mkt-text-strong)" }}
              >
                {plan.name}
              </h2>
              {plan.emphasis && (
                <span
                  className="mkt-chip"
                  style={{
                    background: "var(--mkt-blue-200)",
                    color: "var(--mkt-blue-700)",
                  }}
                >
                  Most popular
                </span>
              )}
            </div>

            <p
              className="mt-4 text-[34px] leading-none font-semibold"
              style={{
                color: "var(--mkt-text-strong)",
                letterSpacing: "-0.03em",
              }}
            >
              {plan.price}
            </p>
            <p
              className="mkt-small mt-1"
              style={{ color: "var(--mkt-text-muted)" }}
            >
              {plan.cadence}
            </p>

            <p
              className="mkt-small mt-4"
              style={{ color: "var(--mkt-text-muted)" }}
            >
              {plan.blurb}
            </p>

            <Link
              href={plan.cta.href}
              className={cn(
                "mkt-cta mt-6 w-full",
                plan.emphasis ? "mkt-cta--primary" : "mkt-cta--soft",
              )}
            >
              {plan.cta.label}
            </Link>

            <ul className="mt-6 flex flex-col gap-2">
              {plan.features.map((feature) => (
                <li key={feature} className="flex items-start gap-2">
                  <Check
                    size={14}
                    className="mt-1 shrink-0 text-[var(--mkt-blue-600)]"
                  />
                  <span
                    className="mkt-small"
                    style={{ color: "var(--mkt-text-normal)" }}
                  >
                    {feature}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </Container>
  );
}
