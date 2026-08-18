import { Greyed } from "./Greyed";

/**
 * `.vector-page-toolbar`: Article | Talk tabs on the left, Read | Edit |
 * View history tabs on the right — only Article + Read are real per D5.
 * `#siteSub` renders below.
 *
 * Geometry measured off the served page at 1440x900: the tab strip is a
 * 32px row; the selected tab is *normal* weight in body #202122 with a 2px
 * #202122 underline (not bold with a blue one); unselected tabs are plain
 * #3366cc links; the hairline under the strip is #c8ccd1, lighter than the
 * --rule used for section headings; and #siteSub sits *below* that hairline
 * with 8px of clearance, at the same 14px as the tabs.
 */
const TAB = "inline-flex h-8 items-center border-b-2 border-transparent text-[14px]";
const SELECTED = `${TAB} border-b-[color:var(--text)] text-[color:var(--text)]`;

export function PageToolbar() {
  return (
    <>
      <div className="border-b border-[color:var(--toolbar-rule)]">
        <div className="flex flex-wrap items-end justify-between gap-x-4">
          <ul className="m-0 flex list-none gap-4 p-0">
            <li>
              <span className={SELECTED}>Article</span>
            </li>
            <li>
              <Greyed
                as="span"
                className={TAB}
                title="Talk pages are not functional in this replica"
              >
                Talk
              </Greyed>
            </li>
          </ul>
          <ul className="m-0 flex list-none items-end gap-4 p-0">
            <li>
              <span className={SELECTED}>Read</span>
            </li>
            <li>
              <Greyed
                as="span"
                className={TAB}
                title="Editing is not available in this replica"
              >
                Edit
              </Greyed>
            </li>
            <li>
              <Greyed
                as="span"
                className={TAB}
                title="Page history is not tracked in this replica"
              >
                View history
              </Greyed>
            </li>
            <li>
              <Greyed
                as="span"
                className={`${TAB} px-1`}
                title="The tools menu is not functional in this replica"
              >
                <span aria-hidden="true" className="text-[16px] leading-none">⋮</span>
              </Greyed>
            </li>
          </ul>
        </div>
      </div>
      <div id="siteSub" className="mt-2 text-[14px]">
        From Wikipedia, the free encyclopedia
      </div>
    </>
  );
}
