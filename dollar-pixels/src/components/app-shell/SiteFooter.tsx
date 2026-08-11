import { cn } from "@/lib/cn";

/**
 * The repo's own README. Relative rather than an absolute URL so it follows a
 * fork or a rename; whoever owns static assets has to serve the file for the
 * link to resolve in a deployment.
 */
const README_HREF = "/README.md";

/**
 * Footer chrome.
 *
 * The wording is the point of this component. It says what the site is, and it
 * says plainly what it is not — the original's own copyright line and
 * disclaimer are its property and are neither reproduced nor paraphrased into
 * something that could be mistaken for an endorsement (DECISIONS D20).
 */
export function SiteFooter({ className }: { className?: string }) {
  return (
    <footer
      className={cn(
        "mt-8 border-t border-(--rule) bg-(--chrome) text-xs text-(--panel)",
        className,
      )}
    >
      <div className="mx-auto flex w-full max-w-(--layout-max) flex-col gap-1 px-4 py-4">
        <p>
          Dollar Pixels is a 2026 rebuild of the 2005 Million Dollar Homepage, written from
          research as a study of the idea: one grid, sold by the block, $1 for nine pixels.
        </p>
        <p>
          It is an independent project. It is not affiliated with, endorsed by, or connected
          to the original site or its creator, it shares none of its code or artwork, and no
          pixel bought here has anything to do with one bought there.
        </p>
        <p>
          <a href={README_HREF} className="text-(--panel-2) underline">
            README
          </a>{" "}
          — how it is built, what it stores, and what the money does.
        </p>
      </div>
    </footer>
  );
}
