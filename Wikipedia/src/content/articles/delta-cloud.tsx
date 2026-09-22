import type { ArticleModule } from "@/lib/registry";
import { projects } from "@/content/projects";
import { deltaCloudMeta } from "@/content/articles/meta";
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

const project = projects.find((item) => item.slug === "Delta_Cloud")!;

export const sections: Array<{ id: string; heading: string }> = [
  { id: "Overview", heading: "Overview" },
  { id: "Architecture", heading: "Architecture" },
  { id: "Compute_planes", heading: "Compute planes" },
  { id: "Environments", heading: "Environments" },
  { id: "Scope", heading: "Scope" },
  { id: "See_also", heading: "See also" },
  { id: "References", heading: "References" },
];

export const deltaCloud: ArticleModule = {
  meta: deltaCloudMeta,
  body: (
    <>
      <Hatnote>
        This article is about the interactive infrastructure map. For the portfolio search engine that hosts it, see{" "}
        <WikiLink to="Davids_Internet">David&apos;s Internet</WikiLink>.
      </Hatnote>

      <Infobox
        title="Delta Cloud"
        rows={[
          { label: "Type", value: "Interactive architecture map" },
          { label: "Status", value: "Drawn September 2026 from a private Terraform repository" },
          {
            label: "Subject",
            value: <ExternalLink href={project.replicaOf.url}>{project.replicaOf.name}</ExternalLink>,
          },
          { label: "Developer", value: "David" },
          { label: "Written in", value: project.stack.join(", ") },
          { label: "Tests", value: project.testStats },
          { label: "Built with", value: project.builtWith },
          { label: "Hosted on", value: <code>David-Internet/demos/delta-cloud</code> },
          {
            label: "Website",
            value: <ExternalLink href={project.liveUrl}>{project.liveUrl ?? "not deployed"}</ExternalLink>,
          },
        ]}
      />

      <P>
        <B>Delta Cloud</B> is an interactive map of the Amazon Web Services infrastructure behind the Katalyxt platform, read from the company&apos;s private Terraform repository and redrawn at whiteboard resolution. It shows an agent-orchestrated control plane on serverless containers, a stateless compute engine on two GPU planes, the private network that keeps them apart, and the account-level ring of secrets, registry, observability, schedules, audit, and continuous integration around them.<Ref n={1} />
      </P>

      <Section heading="Overview">
        <P>
          The page has three parts. A clickable map of one environment opens a plain-language card for each box — what it is and why it is there — and three animated traces walk a user query, a document ingest, and a deploy across the arrows. A second figure draws the difference between the two GPU compute planes. A table closes with staging beside production: the same shape, different numbers.
        </P>
      </Section>

      <Section heading="Architecture">
        <P>
          Each environment is one virtual private cloud with public, application, and data subnets across several availability zones. Only load balancers, behind a managed web application firewall, sit in public subnets. The control plane (DELTA) runs on Fargate with autoscaling and is the only tier that may reach the PostgreSQL database, the Redis cache, the three private object-storage buckets, or a customer&apos;s connector roles; its agents call Claude on Bedrock through a private endpoint. The compute engine (GAMMA) holds no credentials at all, receiving a short-lived signed URL per request and reporting back over a VPC-internal load balancer with HMAC-signed webhooks. Container pulls, secret injection, logs, and key-management calls travel through VPC endpoints rather than the NAT gateway.
        </P>
      </Section>

      <Section heading="Compute planes">
        <P>
          Heavy models outgrew CPU containers, so the compute engine runs on GPU-optimized EC2 instances in two independent planes split by workload shape. Long, bursty ingest and refinement go to AWS Batch, which scales between a warm floor and a burst ceiling on a pinned instance type so replays are byte-identical; cold starts are mitigated in layers by the warm floor, a boot-time image pre-pull, and a pre-baked machine image that a Lambda adopts into Terraform when a new bake lands. User-facing search runs on a separate always-warm GPU service so a query never waits for a boot. A third, CPU-only Batch plane on Fargate handles ingest that needs no accelerator.
        </P>
      </Section>

      <Section heading="Environments">
        <P>
          Staging and production share one Terraform root behind two thin wrappers. Production is the same drawing with larger numbers: more availability zones, more and larger tasks, a warm GPU floor, a failover cache, deletion protection on the database, and a reviewed plan, re-plan, and apply gate behind required reviewers. Both live in one account, and a per-environment deny boundary on each deploy role keeps a staging apply from reaching production state, secrets, or data.
        </P>
      </Section>

      <Section heading="Scope">
        <P>
          No Terraform is reproduced. Account identifiers, network ranges, resource and secret names, hostnames, and exact sizes are omitted on purpose, and a unit test refuses those shapes in the map&apos;s data. The demo shows infrastructure only, not the product built on it, and does not draw the retired Azure mirror kept in the repository for rollback.
        </P>
      </Section>

      <Section heading="See also">
        <ul className="list-disc pl-6">
          <li><WikiLink to="Agent_Memory">Agent Memory</WikiLink></li>
          <li><WikiLink to="Davids_Internet">David&apos;s Internet</WikiLink></li>
        </ul>
      </Section>

      <Section heading="References">
        <References
          refs={[
            <span key="1">Katalyxt <code>Infrastructure</code> repository (private), Terraform for AWS: root module, per-environment wrappers, and the architecture decisions README, as read on 21 September 2026.</span>,
          ]}
        />
      </Section>

      <Categories categories={deltaCloudMeta.categories} />
    </>
  ),
};
