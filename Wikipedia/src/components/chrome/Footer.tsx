import { Greyed } from "./Greyed";

/**
 * The `#f8f9fa` footer strip: last-edited line, license line, greyed
 * footer link rows. Per research/03.
 */
export function Footer({ lastEdited }: { lastEdited?: string }) {
  return (
    /*
      The served footer is white with a single hairline above it, sits at the
      full width of the page container (not inset like the content column),
      and is generously spaced: 50px above the last-edited line, 82px below
      the link row, with both set at 12px. The replica used to render it as a
      tight `#f8f9fa` strip, which read as a different site's footer.
    */
    <footer className="mt-8 border-t border-[color:var(--toolbar-rule)] pb-[82px] pt-[50px] text-[12px] text-[color:var(--text)]">
      <ul className="m-0 list-none space-y-1 p-0 leading-[1.4]">
        {lastEdited && <li>This page was last edited on {lastEdited}.</li>}
        <li>
          Text is available under the Creative Commons Attribution-ShareAlike
          License 4.0; additional terms may apply.
        </li>
      </ul>
      <nav aria-label="Footer" className="mt-6 flex flex-wrap gap-x-5 gap-y-1 leading-[24px]">
        {[
          "Privacy policy",
          "About Wikipedia",
          "Disclaimers",
          "Contact Wikipedia",
          "Code of Conduct",
          "Developers",
          "Statistics",
          "Cookie statement",
          "Mobile view",
        ].map((item) => (
          <Greyed key={item} title="This page is not part of this replica">
            {item}
          </Greyed>
        ))}
      </nav>
    </footer>
  );
}
