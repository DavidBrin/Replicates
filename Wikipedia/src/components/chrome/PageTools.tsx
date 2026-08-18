import { Greyed } from "./Greyed";

/**
 * `.vector-column-end` — the 196px right rail. On the served page this slot
 * carries the page-tools / appearance panel; here it carries MediaWiki's
 * Tools list, greyed, because none of those pages exist in a static replica
 * (DECISIONS D5). It is not decoration: without it the content column sits
 * left of where Wikipedia puts it and the page reads visibly off-centre.
 */
const TOOLS = [
  "What links here",
  "Related changes",
  "Special pages",
  "Permanent link",
  "Page information",
  "Cite this page",
];

export function PageTools() {
  return (
    <nav
      aria-label="Tools"
      className="sticky top-16 hidden max-h-[calc(100vh-5rem)] overflow-auto text-[14px] min-[1120px]:block"
    >
      <div className="flex items-center gap-4 border-b border-[color:var(--toolbar-rule)] pb-2">
        <span className="font-bold">Tools</span>
        <Greyed
          className="rounded-[2px] bg-[color:var(--subtle-bg)] px-2 py-0.5 text-[13px]"
          title="Hiding the tools panel is not functional in this replica"
        >
          hide
        </Greyed>
      </div>
      <ul className="m-0 list-none p-0 pt-2">
        {TOOLS.map((tool) => (
          <li key={tool}>
            <Greyed
              className="block py-[3px]"
              title="This page is not part of this replica"
            >
              {tool}
            </Greyed>
          </li>
        ))}
      </ul>
    </nav>
  );
}
