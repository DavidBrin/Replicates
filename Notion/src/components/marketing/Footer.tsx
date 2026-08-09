import Link from "next/link";
import { brand, routes } from "@/config/app.config";
import { Container } from "./Marketing";
import { CaretDown, Globe, NotionMark, SocialIcon } from "./icons";
import { FOOTER_COLUMNS } from "./copy";

const SOCIALS = ["X", "LinkedIn", "Instagram", "GitHub"];

/**
 * Site footer: four link columns, a language selector, socials and the legal
 * row. The product name comes from `brand.name` so a rebrand does not leave a
 * stale literal in the copyright.
 */
export function Footer() {
  const year = 2026;

  return (
    <footer
      style={{
        borderTop: "1px solid var(--mkt-border-base)",
        background: "#fff",
      }}
    >
      <Container className="py-14">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-[auto_repeat(4,minmax(0,1fr))] lg:gap-12">
          <div className="lg:pr-8">
            <Link
              href={routes.home}
              className="inline-flex"
              aria-label={`${brand.name} home`}
            >
              <NotionMark size={30} />
            </Link>
          </div>

          {FOOTER_COLUMNS.map((column) => (
            <nav key={column.heading} aria-label={column.heading}>
              <h2 className="mkt-footer-heading">{column.heading}</h2>
              <ul>
                {column.links.map((link) => (
                  <li key={link.label}>
                    <Link href={link.href} className="mkt-footer-link">
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>

        {/* -- legal row ---------------------------------------------------- */}
        <div
          className="mt-12 flex flex-col gap-4 pt-6 md:flex-row md:items-center md:justify-between"
          style={{ borderTop: "1px solid var(--mkt-border-base)" }}
        >
          <div className="flex flex-wrap items-center gap-4">
            <button
              type="button"
              className="mkt-nav__link"
              style={{ fontSize: 14, lineHeight: "20px", padding: "4px 8px" }}
              aria-label="Change language — currently English (US)"
            >
              <Globe />
              English (US)
              <CaretDown size={10} />
            </button>
            <span className="mkt-small flex items-center gap-2">
              <Link href={routes.home} className="mkt-footer-link">
                Cookie settings
              </Link>
              <span aria-hidden="true" style={{ color: "var(--mkt-gray-300)" }}>
                ·
              </span>
              <span style={{ color: "var(--mkt-text-muted)" }}>
                © {year} {brand.name}
              </span>
            </span>
          </div>

          <ul className="flex items-center gap-1">
            {SOCIALS.map((social) => (
              <li key={social}>
                <Link
                  href={routes.home}
                  aria-label={social}
                  className="grid size-8 place-items-center rounded-[4px]"
                  style={{ color: "var(--mkt-gray-500)" }}
                >
                  <SocialIcon name={social} />
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </Container>
    </footer>
  );
}
