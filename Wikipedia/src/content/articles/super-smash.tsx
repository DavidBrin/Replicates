import Image from "next/image";
import type { ArticleModule } from "@/lib/registry";
import { projects } from "@/content/projects";
import { superSmashMeta } from "@/content/articles/meta";
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

const project = projects.find((p) => p.slug === "Super_Smash_(replica)")!;

export const sections: Array<{ id: string; heading: string }> = [
  { id: "Overview", heading: "Overview" },
  { id: "Architecture", heading: "Architecture" },
  { id: "Development", heading: "Development" },
  { id: "Reception", heading: "Reception" },
  { id: "See_also", heading: "See also" },
  { id: "References", heading: "References" },
];

export const superSmash: ArticleModule = {
  meta: superSmashMeta,
  body: (
    <>
      <Hatnote>
        This article is about the replica. For the game it replicates, see{" "}
        <ExternalLink href={project.replicaOf.url}>{project.replicaOf.name}</ExternalLink>.
      </Hatnote>

      <Infobox
        title="Super Smash (replica)"
        image={
          <Image
            src="/images/Super_Smash_(replica).png"
            alt="Screenshot of the Super Smash replica's main menu"
            width={300}
            height={169}
            className="h-auto w-full"
          />
        }
        rows={[
          { label: "Type", value: "Fighting game" },
          {
            label: "Replica of",
            value: <ExternalLink href={project.replicaOf.url}>{project.replicaOf.name}</ExternalLink>,
          },
          { label: "Developer", value: "David" },
          { label: "Written in", value: project.stack.join(", ") },
          { label: "Tests", value: project.testStats },
          { label: "Built with", value: project.builtWith },
          { label: "Repository", value: <code>../{project.folder}</code> },
          {
            label: "Website",
            value: <ExternalLink href={project.liveUrl}>{project.liveUrl ?? "not deployed"}</ExternalLink>,
          },
        ]}
      />

      <P>
        <B>Super Smash (replica)</B> is a browser rebuild of{" "}
        <ExternalLink href={project.replicaOf.url}>Super Smash Bros. Ultimate</ExternalLink>&apos;s
        versus mode, developed in the <code>super-smash</code> folder of the{" "}
        <code>Replicates</code> repository. It implements 8 of the original
        game&apos;s 89 fighters, chosen to span different fighter archetypes.
      </P>

      <P>
        Every fighter is drawn entirely from code, as a bone hierarchy of
        capsules and circles, with no assets taken from Nintendo; every sound
        is synthesised from oscillators rather than sampled.
      </P>

      <Section heading="Overview">
        <P>
          The replica&apos;s knockback equation matches Ultimate&apos;s own,
          stage geometry is sourced from Kurogane Hammer&apos;s published
          frame-data reference,<Ref n={1} /> and frame data is drawn from
          decompiled game scripts.
        </P>
      </Section>

      <Section heading="Architecture">
        <P>
          Unlike the original, which is delay-based, the replica adds
          rollback netcode over WebRTC. The game simulation runs in Q12
          fixed-point arithmetic with a seeded pseudo-random number generator
          held inside its <code>GameState</code>, and a layering test fails
          the build outright if <code>Math.random</code>, <code>Date.now</code>,
          or any transcendental <code>Math</code> function is used inside the
          engine. Netcode is tuned to 2 frames of input delay with an 8-frame
          prediction cap; a shared-WiFi LAN path required no additional code,
          relying on ICE host candidates.
        </P>
      </Section>

      <Section heading="Development">
        <P>
          The replica carries {project.testStats}, and was built across{" "}
          {project.builtWith.toLowerCase()}, developed against a frozen
          engine contract.
        </P>
      </Section>

      <Section heading="Reception">
        <P>
          The rollback implementation was verified against a ground-truth run
          across six network link conditions, including one with up to
          150&nbsp;ms of latency and 40&nbsp;ms of jitter, recording 82
          rollbacks over the course of testing.
        </P>
      </Section>

      <Section heading="See also">
        <ul className="list-disc pl-6">
          <li>
            <WikiLink to="Fake_Phone">Fake Phone</WikiLink>
          </li>
          <li>
            <WikiLink to="Dollar_Pixels">Dollar Pixels</WikiLink>
          </li>
          <li>
            <WikiLink to="Davids_Internet">David&apos;s Internet</WikiLink>
          </li>
        </ul>
      </Section>

      <Section heading="References">
        <References
          refs={[
            <span key="1">
              &ldquo;Stage Data.&rdquo; <i>Kurogane Hammer</i>.{" "}
              <ExternalLink href="https://kuroganehammer.com">kuroganehammer.com</ExternalLink>.
            </span>,
            <span key="2">
              <code>super-smash/README.md</code>.
            </span>,
          ]}
        />
      </Section>

      <Categories categories={["Software replicas", "Fighting games", "Browser games"]} />
    </>
  ),
};
