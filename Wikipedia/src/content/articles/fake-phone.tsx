import Image from "next/image";
import type { ArticleModule } from "@/lib/registry";
import { projects } from "@/content/projects";
import { fakePhoneMeta } from "@/content/articles/meta";
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

const project = projects.find((p) => p.slug === "Fake_Phone")!;

export const sections: Array<{ id: string; heading: string }> = [
  { id: "Overview", heading: "Overview" },
  { id: "Design_and_platform_constraints", heading: "Design and platform constraints" },
  { id: "Development", heading: "Development" },
  { id: "See_also", heading: "See also" },
  { id: "References", heading: "References" },
];

export const fakePhone: ArticleModule = {
  meta: fakePhoneMeta,
  body: (
    <>
      <Hatnote>
        This article is about the replica. For the interface it replicates, see{" "}
        <ExternalLink href={project.replicaOf.url}>{project.replicaOf.name}</ExternalLink>.
      </Hatnote>

      <Infobox
        title="Fake Phone"
        image={
          <Image
            src="/images/Fake_Phone.png"
            alt="Screenshot of the Fake Phone replica's home screen"
            width={147}
            height={300}
            className="h-auto w-full"
          />
        }
        rows={[
          { label: "Type", value: "Personal-safety web application" },
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
        <B>Fake Phone</B> is a personal-safety web application, developed in
        the <code>fake-phone</code> folder of the <code>Replicates</code>{" "}
        repository, that replicates the incoming-call screens of{" "}
        <ExternalLink href={project.replicaOf.url}>iOS and Android</ExternalLink>{" "}
        alongside a live-stream mode that uses the device&apos;s real camera.
      </P>

      <P>
        The application opens directly into a ringing call; ending that call
        is the only way to reach its settings, which also gives the settings
        screen social cover in front of another person.
      </P>

      <Section heading="Overview">
        <P>
          The app offers three voice tiers for the simulated caller: Silent,
          Scripted (the default), and an AI tier that is fully wired but
          remains completely inert without an API key, falling back silently
          rather than getting stuck on a &ldquo;connecting&rdquo; state. It is
          installable as a progressive web app.
        </P>
      </Section>

      <Section heading="Design and platform constraints">
        <P>
          The project documents its platform limits candidly rather than
          hiding them: mobile Safari suspends JavaScript timers when the
          device is locked, capping usable ring time at 60 seconds, and iOS
          exposes no vibration API to the web. Apple&apos;s App Store Review
          Guideline 1.1.6, which bans &ldquo;prank call&rdquo; apps,<Ref n={1} />{" "}
          is treated as a hard constraint on all of the product&apos;s
          language and framing.
        </P>
      </Section>

      <Section heading="Development">
        <P>
          The replica carries {project.testStats}, run across mobile Safari,
          mobile Chrome and desktop, and was built across{" "}
          {project.builtWith.toLowerCase()}.
        </P>
      </Section>

      <Section heading="See also">
        <ul className="list-disc pl-6">
          <li>
            <WikiLink to="Super_Smash_(replica)">Super Smash (replica)</WikiLink>
          </li>
          <li>
            <WikiLink to="Bet_(app)">Bet (app)</WikiLink>
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
              &ldquo;App Store Review Guidelines,&rdquo; §1.1.6. Apple Inc.
            </span>,
            <span key="2">
              <code>fake-phone/README.md</code>.
            </span>,
          ]}
        />
      </Section>

      <Categories categories={["Software replicas", "Personal safety software", "Progressive web applications"]} />
    </>
  ),
};
