import Image from "next/image";
import type { ArticleModule } from "@/lib/registry";
import { projects } from "@/content/projects";
import { flStudioMeta } from "@/content/articles/meta";
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

const project = projects.find((p) => p.slug === "FL_Studio_(replica)")!;

export const sections: Array<{ id: string; heading: string }> = [
  { id: "Overview", heading: "Overview" },
  { id: "Notes,_not_steps", heading: "Notes, not steps" },
  { id: "Development", heading: "Development" },
  { id: "See_also", heading: "See also" },
  { id: "References", heading: "References" },
];

export const flStudio: ArticleModule = {
  meta: flStudioMeta,
  body: (
    <>
      <Hatnote>
        This article is about the replica. For the original product, see{" "}
        <ExternalLink href={project.replicaOf.url}>{project.replicaOf.name}</ExternalLink>.
      </Hatnote>

      <Infobox
        title="FL Studio (replica)"
        image={
          <Image
            src="/images/FL_Studio_(replica).png"
            alt="Screenshot of the FL Studio replica's docked Channel Rack, Playlist, and Mixer"
            width={300}
            height={188}
            className="h-auto w-full"
          />
        }
        rows={[
          { label: "Type", value: "Browser DAW" },
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
        <B>FL Studio (replica)</B> is a browser rebuild of{" "}
        <ExternalLink href={project.replicaOf.url}>FL Studio</ExternalLink>
        &apos;s core sequencing loop: Channel Rack, Piano Roll, Playlist, a
        Mixer, and the transport that drives all four.<Ref n={1} /> It is not
        a full DAW. The scoped workflow is: program a 16-step drum pattern,
        add a bassline in the piano roll, arrange two patterns into a song,
        hear it through a master fader, save it, and reload it.
      </P>

      <P>
        Every sound is synthesized from oscillators, noise, and filters at
        runtime. No sample files ship, and no Image-Line assets are in the
        repository or the bundle.
      </P>

      <Section heading="Overview">
        <P>
          The app is entirely client-side. There is no database and no
          environment variable. The first Play click creates the
          AudioContext, because Chrome will not let the engine start any
          earlier. A project can be saved and reloaded in the browser.
        </P>
      </Section>

      <Section heading="Notes, not steps">
        <P>
          The architectural bet is that the step grid and the piano roll
          edit the same list. A <B>Channel Rack step is a Note of length zero</B>{" "}
          at a quantized tick. Opening the piano roll on a drum channel
          shows the steps as notes because they always were.
        </P>
      </Section>

      <Section heading="Development">
        <P>
          The replica carries {project.testStats}. It was built from{" "}
          {project.builtWith.toLowerCase()}. The Vercel project root is{" "}
          <code>fl-studio</code>, with no space in the name, because serverless
          function names cannot contain spaces.
        </P>
      </Section>

      <Section heading="See also">
        <ul className="list-disc pl-6">
          <li><WikiLink to="Super_Smash_(replica)">Super Smash (replica)</WikiLink></li>
          <li><WikiLink to="Early_3D_Modeling">Early 3D Modeling</WikiLink></li>
          <li><WikiLink to="Davids_Internet">David&apos;s Internet</WikiLink></li>
        </ul>
      </Section>

      <Section heading="References">
        <References
          refs={[
            <span key="1"><code>fl-studio/README.md</code>.</span>,
          ]}
        />
      </Section>

      <Categories categories={["Software replicas", "Digital audio workstations", "Browser applications"]} />
    </>
  ),
};
