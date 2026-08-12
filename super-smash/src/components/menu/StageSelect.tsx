"use client";

import { useRef } from "react";
import { useRouter } from "next/navigation";

import { toFloat } from "@/engine/fixed";
import { ModeTab, ScreenBanner } from "@/components/ui/Panel";
import { SkewButton, SkewPanel, SkewTag } from "@/components/ui/SkewPanel";
import { StageDiagram } from "@/components/ui/StageDiagram";
import { cn } from "@/lib/cn";
import {
  RANDOM_STAGE,
  STAGE_FORMS,
  STAGE_FORM_LABELS,
  findStage,
  useMatchConfig,
  useRoster,
  type MenuStage,
  type StageForm,
} from "@/lib/matchConfig";

const COLUMNS = 4;

/**
 * Stage select, which Ultimate puts *before* character select — the reverse of
 * every game before it, and the reason this flow runs rules → stage → fighters
 * (SPEC §9).
 */
export function StageSelect() {
  const router = useRouter();
  const roster = useRoster();
  const stageId = useMatchConfig((s) => s.stageId);
  const stageForm = useMatchConfig((s) => s.stageForm);
  const setStage = useMatchConfig((s) => s.setStage);
  const cycleStageForm = useMatchConfig((s) => s.cycleStageForm);

  const tiles = useRef<(HTMLButtonElement | null)[]>([]);
  const entries: (MenuStage | null)[] = [...roster.stages, null];
  const selected = stageId === RANDOM_STAGE ? null : findStage(roster, stageId);

  const onGridKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    const deltas: Record<string, number> = {
      ArrowRight: 1,
      ArrowLeft: -1,
      ArrowDown: COLUMNS,
      ArrowUp: -COLUMNS,
    };
    const delta = deltas[event.key];
    if (delta === undefined) return;
    const next = index + delta;
    if (next < 0 || next >= entries.length) return;
    event.preventDefault();
    tiles.current[next]?.focus();
  };

  return (
    <main className="flex min-h-dvh flex-col bg-[#101215]">
      <ScreenBanner
        onBack={() => router.push("/rules")}
        backLabel="Back to rules"
        tab={<ModeTab label="Stage" />}
      >
        <FormToggle form={stageForm} onCycle={cycleStageForm} />
      </ScreenBanner>

      <div className="mx-auto grid w-full max-w-6xl flex-1 gap-6 px-5 pb-10 lg:grid-cols-[1.4fr_1fr] sm:px-8">
        <section aria-label="Stages">
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {entries.map((stage, i) => {
              const id = stage?.id ?? RANDOM_STAGE;
              const active = stageId === id;
              return (
                <li key={id}>
                  <button
                    ref={(el) => {
                      tiles.current[i] = el;
                    }}
                    type="button"
                    aria-pressed={active}
                    aria-label={stage?.name ?? "Random"}
                    onClick={() => setStage(id)}
                    onKeyDown={(event) => onGridKeyDown(event, i)}
                    className={cn(
                      "group relative block w-full overflow-hidden border-[3px] transition-transform",
                      active
                        ? "border-smash-yellow shadow-[0_0_0_3px_var(--panel-ink),0_8px_0_rgb(0_0_0/0.45)] -translate-y-1"
                        : "border-panel-ink hover:-translate-y-1",
                    )}
                    style={{ transform: `skewX(-12deg)${active ? " translateY(-4px)" : ""}` }}
                  >
                    <span className="block" style={{ transform: "skewX(12deg) scale(1.12)" }}>
                      {stage ? (
                        <StageDiagram stage={stage} form={stageForm} labelled={false} className="aspect-[16/10]" />
                      ) : (
                        <span className="grid aspect-[16/10] place-items-center bg-[#20242b] font-display text-5xl text-smash-yellow">
                          ?
                        </span>
                      )}
                    </span>
                    <span
                      className="absolute inset-x-0 bottom-0 bg-panel-ink/85 px-2 py-1 text-left"
                      style={{ transform: "skewX(12deg)" }}
                    >
                      <span className="block truncate text-[0.6rem] leading-tight font-black tracking-[0.02em] text-white uppercase">
                        {stage?.name ?? "Random"}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>

          <p className="mt-4 text-xs text-white/45">
            Thumbnails are drawn from each stage&apos;s own geometry, so what you see is the layout the
            simulation will use — including the form you have selected.
          </p>
        </section>

        <aside aria-label="Stage preview" className="flex flex-col gap-4">
          <SkewPanel
            className="border-[3px] border-panel-ink bg-[#181b20]"
            innerClassName="overflow-hidden"
          >
            <div style={{ transform: "scale(1.1)" }}>
              {selected ? (
                <StageDiagram stage={selected} form={stageForm} emphasis="preview" className="aspect-[16/10]" />
              ) : (
                <div className="grid aspect-[16/10] place-items-center bg-[#20242b]">
                  <span className="font-display text-7xl text-smash-yellow">?</span>
                </div>
              )}
            </div>
          </SkewPanel>

          <SkewPanel
            className="border-[3px] border-panel-ink bg-panel-bone text-panel-ink"
            innerClassName="px-5 py-4"
          >
            <h2 className="font-display text-3xl leading-none tracking-[0.04em] uppercase">
              {selected?.name ?? "Random"}
            </h2>
            <p className="mt-1 text-sm font-bold text-panel-ink/60">
              {selected?.series ?? "Chosen when the match starts"}
            </p>

            {selected ? (
              <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                <Fact label="Form" value={STAGE_FORM_LABELS[stageForm]} />
                <Fact
                  label="Platforms"
                  value={String(selected.forms[stageForm].platforms.filter((p) => p.soft).length)}
                />
                <Fact
                  label="Blast L/R"
                  value={`${blast(selected.forms[stageForm].blastZone.left)} / ${blast(selected.forms[stageForm].blastZone.right)}`}
                />
                <Fact
                  label="Blast T/B"
                  value={`${blast(selected.forms[stageForm].blastZone.top)} / ${blast(selected.forms[stageForm].blastZone.bottom)}`}
                />
              </dl>
            ) : null}
          </SkewPanel>

          <SkewButton
            onClick={() => router.push("/fighters")}
            className="border-[4px] border-panel-ink bg-smash-yellow px-8 py-3 text-panel-ink shadow-[0_8px_0_rgb(0_0_0/0.45)] transition-transform hover:-translate-y-1"
            innerClassName="font-display text-xl tracking-[0.18em] uppercase"
          >
            Choose Fighters →
          </SkewButton>
        </aside>
      </div>
    </main>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="font-black tracking-[0.12em] text-panel-ink/50 uppercase">{label}</dt>
      <dd className="font-display text-lg leading-tight">{value}</dd>
    </div>
  );
}

/**
 * The three-state form control.
 *
 * It cycles on press rather than opening a picker, because that is what the
 * real game does — one button, three states, and the label tells you where you
 * are. `aria-label` carries both the current state and what pressing will do,
 * since a control whose meaning changes each press is otherwise unusable
 * without sight.
 */
function FormToggle({ form, onCycle }: { form: StageForm; onCycle: () => void }) {
  return (
    <div className="flex items-center gap-2">
      <SkewTag
        className="hidden border-[3px] border-panel-ink bg-panel-ink sm:inline-block"
        innerClassName="px-3 py-1 text-[0.65rem] font-black tracking-[0.14em] text-white/70 uppercase"
      >
        Form
      </SkewTag>
      <SkewButton
        onClick={onCycle}
        aria-label={`Form: ${STAGE_FORM_LABELS[form]}. Press to cycle.`}
        className="border-[3px] border-panel-ink bg-panel-bone px-1 py-1 text-panel-ink shadow-[0_5px_0_rgb(0_0_0/0.4)]"
        innerClassName="flex items-center gap-1"
      >
        {STAGE_FORMS.map((option) => (
          <span
            key={option}
            aria-hidden
            className={cn(
              "px-3 py-1 font-display text-sm tracking-[0.12em] uppercase transition-colors",
              option === form ? "bg-smash-yellow text-panel-ink" : "text-panel-ink/35",
            )}
          >
            {STAGE_FORM_LABELS[option]}
          </span>
        ))}
      </SkewButton>
    </div>
  );
}

/**
 * Blast zones are stored fixed-point, like the rest of the geometry. The
 * preview reports them in stage units because that is the form SPEC §8's table
 * is written in, and comparing the two is the point of showing them at all.
 */
function blast(value: number): string {
  return String(Math.round(toFloat(value)));
}
