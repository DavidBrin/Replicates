import Image from "next/image";
import type { ArticleModule } from "@/lib/registry";
import { projects } from "@/content/projects";
import { dollarPixelsMeta } from "@/content/articles/meta";
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

const project = projects.find((p) => p.slug === "Dollar_Pixels")!;

export const sections: Array<{ id: string; heading: string }> = [
  { id: "Overview", heading: "Overview" },
  { id: "Architecture", heading: "Architecture" },
  { id: "Development", heading: "Development" },
  { id: "Reception", heading: "Reception" },
  { id: "See_also", heading: "See also" },
  { id: "References", heading: "References" },
];

export const dollarPixels: ArticleModule = {
  meta: dollarPixelsMeta,
  body: (
    <>
      <Hatnote>
        This article is about the replica. For the site it replicates, see{" "}
        <ExternalLink href={project.replicaOf.url}>{project.replicaOf.name}</ExternalLink>.
      </Hatnote>

      <Infobox
        title="Dollar Pixels"
        image={
          <Image
            src="/images/Dollar_Pixels.png"
            alt="Screenshot of the Dollar Pixels replica's pixel wall"
            width={300}
            height={169}
            className="h-auto w-full"
          />
        }
        rows={[
          { label: "Type", value: "Advertising / novelty website" },
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
        <B>Dollar Pixels</B> is a rebuild of{" "}
        <ExternalLink href={project.replicaOf.url}>the 2005 Million Dollar Homepage</ExternalLink>,
        developed in the <code>dollar-pixels</code> folder of the{" "}
        <code>Replicates</code> repository. It sells 3×3-pixel blocks for $1
        each on a 1200×1200 grid of 160,000 blocks. The grid is 1200 rather
        than 1000 pixels wide because 1000 is not evenly divisible by 3.
      </P>

      <P>
        Blocks deliberately carry no outbound links, a departure from the
        original. A 2017 study found 547 of the original Million Dollar
        Homepage&apos;s links dead,
        representing roughly $342,000 of spend pointing at nothing, and a
        surviving mirror of the page has since rewritten a further 1,164
        links to point at archive snapshots.<Ref n={1} />
      </P>

      <Section heading="Overview">
        <P>
          The replica permits users to buy a page. An Unlisted page costs $10
          and
          includes 69 free blocks, or a Premium page priced at half face
          value that pays its creator a share of the price of every block
          sold on it. The site defaults to play money, with Stripe payments
          reachable by setting a single environment variable through the same{" "}
          <code>settle()</code> code path.
        </P>
      </Section>

      <Section heading="Architecture">
        <P>
          The pixel wall is drawn with a canvas renderer that supports O(1)
          hit-testing when a visitor clicks a block.
        </P>
      </Section>

      <Section heading="Development">
        <P>
          The replica carries {project.testStats}, and was built across{" "}
          {project.builtWith.toLowerCase()}.
        </P>
      </Section>

      <Section heading="Reception">
        <P>
          Independent review of the project found five distinct bugs in its
          money-handling paths where, in each case, two halves of a
          transaction were individually correct but combined incorrectly. For
          example, a payment webhook marked an event as processed
          before the corresponding purchase had actually been settled.
        </P>
      </Section>

      <Section heading="See also">
        <ul className="list-disc pl-6">
          <li>
            <WikiLink to="Bet_(app)">Bet (app)</WikiLink>
          </li>
          <li>
            <WikiLink to="Super_Smash_(replica)">Super Smash (replica)</WikiLink>
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
              A 2017 study of the original Million Dollar Homepage&apos;s
              outbound links, as cited in{" "}
              <code>dollar-pixels/README.md</code>.
            </span>,
          ]}
        />
      </Section>

      <Categories categories={["Software replicas", "Advertising websites"]} />
    </>
  ),
};
