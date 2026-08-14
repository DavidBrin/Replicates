import { notFound } from "next/navigation";

import { getConnector } from "@/adapters/ai";
import { accessForPage } from "@/components/members/workspace-access";
import { can } from "@/domain/policy";
import { cn } from "@/lib/cn";

/**
 * `/[workspace]/settings/ai` — which model this deployment talks to, if any.
 *
 * ## Unconfigured is a state, not an error
 *
 * `getConnector()` returns a `DisabledConnector` when no key is present. It
 * never throws, and neither does this page: it renders "Disabled" with the two
 * environment variables that would change that. A clone anybody can run has to
 * have a sensible default for "no API key", and an error boundary is not it
 * (`ports/ai.ts`, `DECISIONS.md` D14).
 *
 * ## The key never reaches this page
 *
 * `connector.configured` is a boolean and `connector.model` is a model name.
 * Neither the key nor a prefix of it is read here, because a settings screen
 * that renders `sk-ant-…` is a settings screen that puts a credential in a
 * screenshot. Whether a key *works* is a question only a request can answer,
 * and the app answers it where the request is made.
 */

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ workspace: string }>;
}

const PROVIDER_LABELS: Readonly<Record<string, string>> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  none: "None",
};

export default async function AiSettingsPage({ params }: PageProps) {
  const { workspace: urlKey } = await params;
  const access = await accessForPage(urlKey);
  if (!access) notFound();

  // Reading the connector's status is workspace furniture, not administration:
  // anybody who can open the app can see whether the summarise button will do
  // anything. Changing it is a deployment action, not a screen.
  if (!can(access.actor, "workspace.view", { kind: "workspace" })) notFound();

  const connector = getConnector();
  const configured = connector.configured;

  return (
    <div className="mx-auto flex w-full max-w-[720px] flex-col gap-6 px-6 py-6">
      <div>
        <h1 className="text-large font-[var(--weight-title)] text-primary">
          AI
        </h1>
        <p className="text-mini text-tertiary">
          One connector port, two vendor adapters. The application never names a
          provider — which model answers is a deployment choice.
        </p>
      </div>

      <section
        data-testid="ai-connector-status"
        className={cn(
          "flex flex-col gap-3 rounded-[var(--radius-lg)] border p-4",
          configured ? "border-default bg-panel" : "border-dashed border-default bg-panel",
        )}
      >
        <div className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className="size-2 rounded-full"
            style={{
              background: configured ? "var(--success)" : "var(--text-quaternary)",
            }}
          />
          <span className="text-small font-[var(--weight-medium)] text-primary">
            {configured ? "Connected" : "Disabled"}
          </span>
        </div>

        <dl className="grid grid-cols-[100px_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-small">
          <dt className="text-tertiary">Provider</dt>
          <dd className="text-primary">
            {PROVIDER_LABELS[connector.provider] ?? connector.provider}
          </dd>
          <dt className="text-tertiary">Model</dt>
          <dd className="font-mono text-mini text-primary">
            {configured ? connector.model : "—"}
          </dd>
        </dl>

        {configured ? (
          <p className="text-mini text-tertiary">
            Summaries and drafting are available. Requests are made server-side;
            the key never reaches a browser.
          </p>
        ) : (
          <div className="flex flex-col gap-2 text-mini text-tertiary">
            <p>
              No provider is configured, so the AI affordances render as disabled
              rather than failing. Set one of these and restart:
            </p>
            <ul className="flex flex-col gap-1">
              <li className="flex items-center gap-2">
                <code className="rounded-[var(--radius-sm)] bg-elevated px-1.5 py-0.5 font-mono text-micro text-secondary">
                  ANTHROPIC_API_KEY
                </code>
                <span>for Claude</span>
              </li>
              <li className="flex items-center gap-2">
                <code className="rounded-[var(--radius-sm)] bg-elevated px-1.5 py-0.5 font-mono text-micro text-secondary">
                  OPENAI_API_KEY
                </code>
                <span>for GPT</span>
              </li>
            </ul>
            <p>
              With both set,{" "}
              <code className="rounded-[var(--radius-sm)] bg-elevated px-1.5 py-0.5 font-mono text-micro text-secondary">
                AI_DEFAULT_PROVIDER
              </code>{" "}
              picks between them; with one set, it is used whatever that variable
              says.
            </p>
          </div>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-small font-[var(--weight-title)] text-primary">
          What it is used for
        </h2>
        <ul className="flex list-disc flex-col gap-1 pl-4 text-small text-secondary">
          <li>Summarising a project from its description and open issues.</li>
          <li>Drafting an issue description from a title.</li>
          <li>Suggesting a title from a description.</li>
        </ul>
        <p className="text-mini text-tertiary">
          Not agents. The brief excludes them, and a connector that returns text
          is a different thing from a process that acts on a workspace.
        </p>
      </section>
    </div>
  );
}
