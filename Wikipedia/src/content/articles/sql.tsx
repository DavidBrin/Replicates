import type { ArticleModule } from "@/lib/registry";
import { projects } from "@/content/projects";
import { sqlMeta } from "@/content/articles/meta";
import {
  B,
  Categories,
  ExternalLink,
  Hatnote,
  Infobox,
  P,
  Ref,
  References,
  Section,
  WikiLink,
} from "@/components/wiki";

const project = projects.find((p) => p.slug === "SQL_Playground")!;

export const sections: Array<{ id: string; heading: string }> = [
  { id: "Overview", heading: "Overview" },
  { id: "Query_runner", heading: "Query runner" },
  { id: "Development", heading: "Development" },
  { id: "See_also", heading: "See also" },
  { id: "References", heading: "References" },
];

export const sql: ArticleModule = {
  meta: sqlMeta,
  body: (
    <>
      <Hatnote>
        This article is about the interactive demo. For the search engine that
        hosts it, see <WikiLink to="Davids_Internet">David&apos;s Internet</WikiLink>.
      </Hatnote>

      <Infobox
        title="SQL Playground"
        rows={[
          { label: "Type", value: "Interactive demo" },
          {
            label: "Origin",
            value: <ExternalLink href={project.replicaOf.url}>{project.replicaOf.name}</ExternalLink>,
          },
          { label: "Developer", value: "David" },
          { label: "Written in", value: project.stack.join(", ") },
          { label: "Tests", value: project.testStats },
          { label: "Built with", value: project.builtWith },
          { label: "Hosted on", value: <code>David-Internet/demos/sql</code> },
          {
            label: "Website",
            value: <ExternalLink href={project.liveUrl}>{project.liveUrl ?? "not deployed"}</ExternalLink>,
          },
        ]}
      />

      <P>
        <B>SQL Playground</B> is an interactive demonstration of five databases
        from a DTU Databases course, running entirely in the browser.<Ref n={1} />
        Schemas were translated from MariaDB to SQLite at build time.{" "}
        <B>sql.js runs SQLite compiled to WebAssembly</B>, so there is no
        server.
      </P>

      <P>
        A schema browser draws tables and foreign keys beside hand-drawn ER
        designs. A query runner fires the weekly answer queries, or a visitor&apos;s
        own SQL, and highlights involved tables and touched rows.
      </P>

      <Section heading="Overview">
        <P>
          The five course databases are the Silberschatz University schema, a
          Family warm-up, a Cinema exam set, and the week 12 and 13 Takeaway
          and Bus Service sets. A reconstructed bike-shop schema supports the
          modification panel.
        </P>
      </Section>

      <Section heading="Query runner">
        <P>
          Forty-four presets cover joins, left joins, group-by-having,
          correlated subqueries, and the cinema exam&apos;s nine answers.
          MariaDB-only features are adapted and disclosed per preset. A
          modification panel replays INSERT, UPDATE, and DELETE with undo, a
          foreign-key toggle, and a trigger rewritten from SIGNAL to RAISE.
        </P>
      </Section>

      <Section heading="Development">
        <P>
          {project.testStats}. The engine is client-side so a static export of
          David&apos;s Internet can host the lab.
        </P>
      </Section>

      <Section heading="See also">
        <ul className="list-disc pl-6">
          <li><WikiLink to="ArXiv_Semantic_Graph">arXiv Semantic Graph</WikiLink></li>
          <li><WikiLink to="Quantum_Playground">Quantum Playground</WikiLink></li>
          <li><WikiLink to="Davids_Internet">David&apos;s Internet</WikiLink></li>
        </ul>
      </Section>

      <Section heading="References">
        <References
          refs={[
            <span key="1"><code>content/sql/README.md</code>, David&apos;s Internet.</span>,
          ]}
        />
      </Section>

      <Categories categories={["Interactive demos", "Databases", "2026 establishments"]} />
    </>
  ),
};
