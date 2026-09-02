import type { ArticleModule } from "@/lib/registry";
import { projects } from "@/content/projects";
import { visionMeta } from "@/content/articles/meta";
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

const project = projects.find((p) => p.slug === "Computer_Vision")!;

export const sections: Array<{ id: string; heading: string }> = [
  { id: "Overview", heading: "Overview" },
  { id: "Photometric_stereo", heading: "Photometric stereo" },
  { id: "Development", heading: "Development" },
  { id: "See_also", heading: "See also" },
  { id: "References", heading: "References" },
];

export const vision: ArticleModule = {
  meta: visionMeta,
  body: (
    <>
      <Hatnote>
        This article is about the interactive demo. For the search engine that
        hosts it, see <WikiLink to="Davids_Internet">David&apos;s Internet</WikiLink>.
      </Hatnote>

      <Infobox
        title="Computer Vision"
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
          { label: "Hosted on", value: <code>David-Internet/demos/vision</code> },
          {
            label: "Website",
            value: <ExternalLink href={project.liveUrl}>{project.liveUrl ?? "not deployed"}</ExternalLink>,
          },
        ]}
      />

      <P>
        <B>Computer Vision</B> is an interactive demonstration of David&apos;s
        CSE 152A coursework at UC San Diego. It is hosted on{" "}
        <WikiLink to="Davids_Internet">David&apos;s Internet</WikiLink> and
        presents classical computer-vision methods in course order.<Ref n={1} />
      </P>

      <P>
        The page covers photometric stereo, epipolar geometry, corner and
        feature matching, bag-of-words face classification, and archived CNN
        and transfer-learning results. The live mathematical components are
        TypeScript ports checked against the original NumPy solutions.
      </P>

      <Section heading="Overview">
        <P>
          The geometry panel applies the normalized eight-point algorithm to
          the course&apos;s dino image pair, so clicks in either view draw the
          matching epipolar line. A corner detector and an SSD versus NCC
          comparison use the same images. Separate panels show a 100-word
          visual vocabulary and stored results from FashionMNIST and STL-10
          coursework.
        </P>
      </Section>

      <Section heading="Photometric stereo">
        <P>
          Four photographs of a face under known lighting are used to recover
          normals, albedo, and depth through per-pixel least-squares solves.
          A three-image or four-image comparison is available. In this view, a draggable light relights the recovered face,
          using the reconstructed surface rather than a new source image.
        </P>
      </Section>

      <Section heading="Development">
        <P>
          The demo presents coursework from winter and spring 2025. Its
          photometric-stereo solver, Horn integration, eight-point solver,
          corner detector, and SSD and NCC implementations are fixture-tested
          against the NumPy solutions. {project.testStats}.
        </P>
      </Section>

      <Section heading="See also">
        <ul className="list-disc pl-6">
          <li>
            <WikiLink to="ArXiv_Semantic_Graph">arXiv Semantic Graph</WikiLink>
          </li>
          <li>
            <WikiLink to="ESP32_Thermal_TinyML">ESP32 Thermal TinyML</WikiLink>
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
              <code>content/vision/README.md</code>, David&apos;s Internet.
            </span>,
          ]}
        />
      </Section>

      <Categories categories={["Interactive demos", "Computer vision", "2026 establishments"]} />
    </>
  ),
};
