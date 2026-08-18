/**
 * The boxed "Categories:" bar at the foot of every article. Category links
 * have no dedicated category pages in this replica, so they render greyed
 * rather than as live (and permanently red) internal links.
 */
export function Categories({ categories }: { categories: string[] }) {
  if (categories.length === 0) return null;

  return (
    /* Box geometry lives in globals.css under `.catlinks`. */
    <div className="catlinks">
      <span className="font-normal">Categories:</span>
      {/*
        MediaWiki draws the separators between category names as a left
        border on each `li` — not as a literal "|" character, which at 14px
        reads as a capital I sitting in the middle of the list.
      */}
      <ul className="m-0 inline list-none p-0">
        {categories.map((category) => (
          <li
            key={category}
            className="my-[2px] inline-block border-l border-[color:var(--rule)] px-2 first:border-l-0 first:pl-1"
          >
            <span
              className="text-[color:var(--text)]/70"
              title="Category pages are not part of this replica"
            >
              {category}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
