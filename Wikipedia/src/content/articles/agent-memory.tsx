import type { ArticleModule } from "@/lib/registry";
import { projects } from "@/content/projects";
import { agentMemoryMeta } from "@/content/articles/meta";
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

const project = projects.find((item) => item.slug === "Agent_Memory")!;

export const sections: Array<{ id: string; heading: string }> = [
  { id: "Overview", heading: "Overview" },
  { id: "Memory_model", heading: "Memory model" },
  { id: "Trace", heading: "Trace" },
  { id: "Scope", heading: "Scope" },
  { id: "See_also", heading: "See also" },
  { id: "References", heading: "References" },
];

export const agentMemory: ArticleModule = {
  meta: agentMemoryMeta,
  body: (
    <>
      <Hatnote>
        This article is about the interactive research demo. For the portfolio search engine that hosts it, see{" "}
        <WikiLink to="Davids_Internet">David&apos;s Internet</WikiLink>.
      </Hatnote>

      <Infobox
        title="Agent Memory"
        rows={[
          { label: "Type", value: "Interactive research demo" },
          { label: "Status", value: "Active research; deterministic prototype replay" },
          {
            label: "Origin",
            value: <ExternalLink href={project.replicaOf.url}>{project.replicaOf.name}</ExternalLink>,
          },
          { label: "Developer", value: "David" },
          { label: "Written in", value: project.stack.join(", ") },
          { label: "Tests", value: project.testStats },
          { label: "Built with", value: project.builtWith },
          { label: "Hosted on", value: <code>David-Internet/demos/agent-memory</code> },
          {
            label: "Website",
            value: <ExternalLink href={project.liveUrl}>{project.liveUrl ?? "not deployed"}</ExternalLink>,
          },
        ]}
      />

      <P>
        <B>Agent Memory</B> is an interactive explanation of David&apos;s Memory OS v0 experiment for AI agents. It replays a deterministic Python scenario as a static browser trace: every observation enters an append-only log, a write gate explains whether it becomes governed memory, and recorded retrieval packets show their citations or abstention.<Ref n={1} />
      </P>

      <Section heading="Overview">
        <P>
          The page begins with flat retrieval-augmented generation (RAG) as a conceptual comparison: a query yields similar snippets, but similarity alone does not make a record current, trustworthy, permitted, or traceable. The working chapters then follow the prototype&apos;s captured data rather than recreating a policy or ranker in TypeScript.
        </P>
      </Section>

      <Section heading="Memory model">
        <P>
          Memory OS v0 treats memory as evidence under governance rather than a single vector index. A correction supersedes an earlier preference by closing its validity window; the original remains auditable without answering later queries. A session-scoped instruction can remain local to its session, and sensitivity or trust can prevent a relevant-looking record from entering context.
        </P>
      </Section>

      <Section heading="Trace">
        <P>
          The trace contrasts a poisoned web observation with instruction-shaped text from a verified private policy actor. The former is neutralized and quarantined as evidence, while the latter is accepted with a recorded <code>policy_authorized</code> decision. A later retrieval example reaches a stale-document episode through a shared entity and names why that traversal entered the cited context packet.
        </P>
      </Section>

      <Section heading="Scope">
        <P>
          The demo is not a production agent or a free-form chat interface. Memory OS v0 uses deterministic lexical candidate finding and a one-hop temporal entity index. It does not yet use embeddings, a vector database, background consolidation, or a learned policy.
        </P>
      </Section>

      <Section heading="See also">
        <ul className="list-disc pl-6">
          <li><WikiLink to="ArXiv_Semantic_Graph">arXiv Semantic Graph</WikiLink></li>
          <li><WikiLink to="Davids_Internet">David&apos;s Internet</WikiLink></li>
        </ul>
      </Section>

      <Section heading="References">
        <References
          refs={[
            <span key="1"><code>Agent_Memory/experiments/memory_os_v0</code>, deterministic prototype and trace exporter.</span>,
          ]}
        />
      </Section>

      <Categories categories={agentMemoryMeta.categories} />
    </>
  ),
};
