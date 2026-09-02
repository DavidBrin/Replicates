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
        <B>Early 3D Modeling</B> is an interactive demonstration of
        David&apos;s earliest engineering work, from high-school coursework
        around 2020 and 2021. It pairs a gallery of Autodesk Inventor renders
        with a VEXcode VR robot simulator written in TypeScript for the
        page.<Ref n={1} />
      </P>

      <P>
        The gallery groups eighteen renders into seven projects, among them a
        Rube Goldberg machine assembly, a glider with its manufacturing
        drawing, two gear chains, and a box-crusher design. Multi-render
        projects play as build-up cross-fades, a gear pair turns at its true
        ratio, and each card carries a feature story inferred from the
        archived part files, which the page discloses. One archived
        screenshot, saved as &ldquo;Wing simulator&rdquo;, is NASA
        Glenn&apos;s FoilSim JS rather than an Inventor render, and appears
        separately with that attribution.
      </P>

      <Section heading="Overview">
        <P>
          The two halves of the page match the two halves of the archive:
          static CAD output presented as an annotated gallery, and robot
          programs that still run. Original VEXcode screenshots appear beside
          the simulation for comparison, and the drawing files render as
          blueprint-styled cards.
        </P>
      </Section>

      <Section heading="VEX simulator">
        <P>
          Six original 2020 programs execute against a TypeScript port of the
          VEXcode VR drivetrain, pen and sensor API: a wall maze solved by
          eye sensors, a perimeter octagon drawn pen-down, a dance routine, a
          random drive, and two Python programs. The block or code listing
          highlights in step with the robot, pen trails draw on the canvas,
          and an arrow-key mode lets the visitor drive. The playgrounds are
          top-down approximations drawn for the page, and no VEX assets were
          copied. The perimeter program&apos;s file did not survive; its
          listing was rebuilt from a screenshot and is labeled as
          reconstructed.
        </P>
      </Section>

      <Section heading="Development">
        <P>
          No STL or GLB exports of the Inventor models exist, so the page has
          no 3D viewer and animates render sequences instead. At build time
          the Blockly XML of the block programs is parsed into listings, the
          Python sources are extracted, and the six programs are traced
          headless to pin their listings in a fixture. {project.testStats}.
        </P>
      </Section>

      <Section heading="See also">
        <ul className="list-disc pl-6">
          <li>
            <WikiLink to="Early_Code">Early Code</WikiLink>
          </li>
          <li>
            <WikiLink to="Verilog">Verilog</WikiLink>
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
              <code>content/modeling/README.md</code>, David&apos;s Internet.
            </span>,
          ]}
        />
      </Section>

      <Categories categories={["Interactive demos", "Computer-aided design", "2026 establishments"]} />
    </>
  ),
};
