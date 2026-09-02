import type { ArticleModule } from "@/lib/registry";
import { projects } from "@/content/projects";
import { modelingMeta } from "@/content/articles/meta";
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

const project = projects.find((p) => p.slug === "Early_3D_Modeling")!;

export const sections: Array<{ id: string; heading: string }> = [
  { id: "Overview", heading: "Overview" },
  { id: "VEX_simulator", heading: "VEX simulator" },
  { id: "Development", heading: "Development" },
  { id: "See_also", heading: "See also" },
  { id: "References", heading: "References" },
];

export const modeling: ArticleModule = {
  meta: modelingMeta,
  body: (
    <>
      <Hatnote>
        This article is about the interactive demo. For the search engine that
        hosts it, see <WikiLink to="Davids_Internet">David&apos;s Internet</WikiLink>.
      </Hatnote>

      <Infobox
        title="Early 3D Modeling"
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
          { label: "Hosted on", value: <code>David-Internet/demos/modeling</code> },
          {
            label: "Website",
            value: <ExternalLink href={project.liveUrl}>{project.liveUrl ?? "not deployed"}</ExternalLink>,
          },
        ]}
      />

      <P>
        <B>Early 3D Modeling</B> is an interactive demonstration of David&apos;s
        earliest engineering work from about 2020 to 2021: Autodesk Inventor
        CAD projects told as feature stories, and VEXcode VR robot programs
        running in a live 2D simulator.<Ref n={1} />
      </P>

      <P>
        The Inventor gallery groups renders of a Goldberg machine, a glider
        with its manufacturing drawing, gear chains, the Space Crush box
        crusher, and a peg toy. Feature stories are inferred from the part
        files; gears turn in the build-up animations.
      </P>

      <Section heading="Overview">
        <P>
          Seven CAD groups and thirty archived part and assembly files sit
          beside three manufacturing drawings. No 3D exports exist in the
          archive, so the page shows the original renders rather than a
          reconstructed mesh viewer.
        </P>
      </Section>

      <Section heading="VEX simulator">
        <P>
          Original <B>VEXcode VR programs execute against a ported drivetrain</B>
          , pen, and sensor API written in TypeScript for this page. Wall Maze,
          a perimeter octagon, a dance, a random drive, and the Python Art
          Canvas all run with the current block highlighted as the robot
          moves. A drive-it-yourself mode is included. No VEX assets were
          copied.
        </P>
      </Section>

      <Section heading="Development">
        <P>
          {project.testStats}. Seventeen VEX programs were archived; six were
          ported onto the page.
        </P>
      </Section>

      <Section heading="See also">
        <ul className="list-disc pl-6">
          <li><WikiLink to="Early_Code">Early Code</WikiLink></li>
          <li><WikiLink to="HardHack_2026">HardHack 2026</WikiLink></li>
          <li><WikiLink to="Davids_Internet">David&apos;s Internet</WikiLink></li>
        </ul>
      </Section>

      <Section heading="References">
        <References
          refs={[
            <span key="1"><code>content/modeling/README.md</code>, David&apos;s Internet.</span>,
          ]}
        />
      </Section>

      <Categories categories={["Interactive demos", "Computer-aided design", "2026 establishments"]} />
    </>
  ),
};
