import type { ArticleModule } from "@/lib/registry";
import { B, Categories, Hatnote, Infobox, P, Ref, References, Section, WikiLink, WikiTable } from "@/components/wiki";

/**
 * The one demo article proving the registry -> primitives pipeline end to
 * end. Not a real project article — those belong to the content agent
 * building out `src/content/articles/*` per the TODO in `./index.ts`.
 */
export const sandbox: ArticleModule = {
  meta: {
    slug: "Sandbox",
    title: "Sandbox",
    shortDescription: "A demonstration article proving the wiki-primitive pipeline",
    categories: ["Meta", "Demonstration articles"],
    lastEdited: "18 August 2026",
  },
  body: (
    <>
      <Hatnote>
        This article is a pipeline demonstration. For the encyclopedia&apos;s
        actual subject, see <WikiLink to="David's Internet">David&apos;s Internet</WikiLink>.
      </Hatnote>

      <Infobox
        title="Sandbox"
        rows={[
          { label: "Type", value: "Demonstration article" },
          { label: "Proves", value: "registry → wiki primitives → rendered page" },
          { label: "Status", value: <span>Exists</span> },
        ]}
      />

      <P>
        <B>Sandbox</B> is a demonstration article that exercises every wiki
        primitive at least once: an infobox, a hatnote, a section with a
        subsection, a table, a footnote, and both a live internal link and a
        red link to a page that does not exist.<Ref n={1} />
      </P>

      <Section heading="Purpose">
        <P>
          This section exists to prove that <WikiLink to="Sandbox">an
          article can link to itself</WikiLink> and that a link to a
          slug nothing registers, such as{" "}
          <WikiLink to="This Article Does Not Exist">this one</WikiLink>,
          renders as a red link instead.
        </P>

        <Section heading="A subsection">
          <P>
            Subsections render as an <code>h3</code> nested under the parent
            section&apos;s <code>h2</code>, without their own edit
            affordance.
          </P>
        </Section>
      </Section>

      <Section heading="A table">
        <WikiTable>
          <thead>
            <tr>
              <th>Primitive</th>
              <th>Exercised above</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Infobox</td>
              <td>Yes</td>
            </tr>
            <tr>
              <td>WikiLink (blue)</td>
              <td>Yes</td>
            </tr>
            <tr>
              <td>WikiLink (red)</td>
              <td>Yes</td>
            </tr>
          </tbody>
        </WikiTable>
      </Section>

      <Section heading="References">
        <References
          refs={[
            <span key="1">
              &ldquo;Sandbox (Wikipedia).&rdquo; The English Wikipedia project
              maintains an identically-purposed page for the same reason.
            </span>,
          ]}
        />
      </Section>

      <Categories categories={["Meta", "Demonstration articles"]} />
    </>
  ),
};
