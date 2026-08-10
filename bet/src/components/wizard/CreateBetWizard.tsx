"use client";

import { useCallback, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import { createDraftStore, wizardDraftStorageKey } from "@/lib/draft-storage";
import { buildCreateMarketRequestBody } from "./build-request";
import { StepIndicator } from "./StepIndicator";
import { Step1Question, type WizardGroupOption } from "./Step1Question";
import { Step2Outcomes } from "./Step2Outcomes";
import { Step3Pricing } from "./Step3Pricing";
import { Step4Invite, type WizardFriend } from "./Step4Invite";
import { Step5Review } from "./Step5Review";
import { buildDefaultDraft, isWizardDraft, STEP_COUNT, type WizardDraft } from "./types";
import {
  findFirstInvalidStep,
  validateStep1,
  validateStep2,
  validateStep3,
  validateStep4,
  type FieldErrors,
  type StepNumber,
} from "./validation";

export interface CreateBetWizardProps {
  userId: string;
  groups: WizardGroupOption[];
  /** The group id to default a fresh draft to — resolved server-side from
   * `?group=<slug>` (the dashboard's "+ New bet" link) or the user's first
   * group. `page.tsx` guarantees `groups.length > 0` before rendering this
   * component at all. */
  initialGroupId: string;
  friends: WizardFriend[];
}

const STEP_VALIDATORS: Record<StepNumber, (draft: WizardDraft, now: Date) => FieldErrors> = {
  1: validateStep1,
  2: (draft) => validateStep2(draft),
  3: (draft) => validateStep3(draft),
  4: () => validateStep4(),
};

function subscribeNever(): () => void {
  return () => {};
}
function getMountedSnapshot(): boolean {
  return true;
}
function getMountedServerSnapshot(): boolean {
  return false;
}

function WizardSkeleton() {
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <Skeleton className="h-16 w-full" />
      <Card className="flex flex-col gap-4 p-6">
        <Skeleton className="h-5 w-1/3" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-10 w-full" />
      </Card>
    </div>
  );
}

/**
 * Public entry point — `src/app/(app)/app/new/page.tsx` renders this.
 * Gates the real, stateful wizard behind a client-only "mounted" flag
 * (the exact `useSyncExternalStore` pattern `ui/Toast.tsx`'s
 * `ToastProvider` already established in this codebase) so `WizardInner`
 * below only ever mounts fresh, client-side, AFTER hydration completes.
 *
 * That matters because `WizardInner`'s draft state is lazily initialized
 * by reading `localStorage` (draft restore). Doing that read during the
 * FIRST client render of a component that also rendered server-side (no
 * `window`) would make the client's very first paint disagree with the
 * server-rendered HTML the instant a draft exists — a textbook hydration
 * mismatch on every controlled input's `value` (React explicitly flags
 * `value`/`checked` prop mismatches during hydration). Mounting
 * `WizardInner` only after this outer gate flips means it never has
 * server-rendered output to disagree with in the first place — its own
 * first render already happens post-hydration.
 */
export function CreateBetWizard(props: CreateBetWizardProps) {
  const mounted = useSyncExternalStore(subscribeNever, getMountedSnapshot, getMountedServerSnapshot);
  if (!mounted) return <WizardSkeleton />;
  return <WizardInner {...props} />;
}

interface CreateMarketResponse {
  data?: { market?: { id: string; question: string } };
  error?: { message?: string };
}

function WizardInner({ userId, groups, initialGroupId, friends }: CreateBetWizardProps) {
  const router = useRouter();
  const toast = useToast();

  // Stable for this component's lifetime — `userId` never changes under
  // one mount, so a plain lazy `useState` (not a ref) is fine; nothing
  // else needs to react to it changing.
  const [storage] = useState(() => createDraftStore<WizardDraft>(wizardDraftStorageKey(userId)));

  const [draft, setDraft] = useState<WizardDraft>(() => {
    const restored = storage.get();
    // Only trust a restored draft if it's shaped right AND still points at
    // a group the user is actually in (group membership can't have
    // changed mid-draft in practice, but a stale/foreign draft is cheap
    // to detect and not worth trusting blindly).
    if (isWizardDraft(restored) && groups.some((g) => g.id === restored.groupId)) {
      return restored;
    }
    return buildDefaultDraft(initialGroupId);
  });

  const [step, setStep] = useState(1);
  const [maxStepReached, setMaxStepReached] = useState(1);
  const [attemptedSteps, setAttemptedSteps] = useState<ReadonlySet<number>>(() => new Set());
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [knownUsers, setKnownUsers] = useState<Map<string, WizardFriend>>(
    () => new Map(friends.map((f) => [f.id, f])),
  );

  const updateDraft = useCallback(
    (patch: Partial<WizardDraft>) => {
      setDraft((prev) => {
        const next = { ...prev, ...patch };
        // Persisted from the SAME event handler that changed it (never
        // from an effect) — every keystroke writes the whole draft, per
        // SPEC's "draft persistence on every change."
        storage.set(next);
        return next;
      });
    },
    [storage],
  );

  const onDiscoverUsers = useCallback((users: WizardFriend[]) => {
    if (users.length === 0) return;
    setKnownUsers((prev) => {
      const next = new Map(prev);
      for (const u of users) next.set(u.id, u);
      return next;
    });
  }, []);

  const displayedErrors: FieldErrors =
    step >= 1 && step <= 4 && attemptedSteps.has(step)
      ? STEP_VALIDATORS[step as StepNumber](draft, new Date())
      : {};

  function markAttempted(target: number) {
    setAttemptedSteps((prev) => {
      if (prev.has(target)) return prev;
      const next = new Set(prev);
      next.add(target);
      return next;
    });
  }

  function handleNext() {
    if (step < 1 || step > 4) return;
    const stepErrors = STEP_VALIDATORS[step as StepNumber](draft, new Date());
    markAttempted(step);
    if (Object.keys(stepErrors).length > 0) return;
    const next = Math.min(STEP_COUNT, step + 1);
    setStep(next);
    setMaxStepReached((m) => Math.max(m, next));
  }

  function handleBack() {
    setStep((s) => Math.max(1, s - 1));
  }

  function jumpToStep(target: number) {
    if (target < 1 || target > maxStepReached) return;
    setStep(target);
  }

  async function handleCreate() {
    if (submitting) return;

    const invalid = findFirstInvalidStep(draft, new Date());
    if (invalid) {
      markAttempted(invalid.step);
      setStep(invalid.step);
      setMaxStepReached((m) => Math.max(m, invalid.step));
      return;
    }

    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await fetch("/api/markets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildCreateMarketRequestBody(draft)),
      });
      const body: CreateMarketResponse = await res.json();
      if (!res.ok || body.error || !body.data?.market) {
        setSubmitError(body.error?.message ?? "Couldn't create the bet. Try again.");
        setSubmitting(false);
        return; // stays on step 5 (review) with the draft fully intact
      }

      const market = body.data.market;
      const groupSlug = groups.find((g) => g.id === draft.groupId)?.slug;
      storage.clear();
      toast.show({ title: "Bet created", description: market.question, variant: "success" });
      router.push(groupSlug ? `/app/g/${groupSlug}/m/${market.id}` : "/app");
    } catch {
      setSubmitError("Couldn't create the bet. Check your connection and try again.");
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold text-(--text-1)">Create a bet</h1>
        <p className="text-sm text-(--text-2)">Set it up, then invite your group.</p>
      </div>

      <StepIndicator currentStep={step} maxStepReached={maxStepReached} onSelectStep={jumpToStep} />

      <Card className="p-6">
        {step === 1 ? (
          <Step1Question draft={draft} errors={displayedErrors} groups={groups} onChange={updateDraft} />
        ) : null}
        {step === 2 ? (
          <Step2Outcomes draft={draft} errors={displayedErrors} onChange={updateDraft} />
        ) : null}
        {step === 3 ? (
          <Step3Pricing draft={draft} errors={displayedErrors} onChange={updateDraft} />
        ) : null}
        {step === 4 ? (
          <Step4Invite
            draft={draft}
            friends={friends}
            knownUsers={knownUsers}
            onDiscoverUsers={onDiscoverUsers}
            groupId={draft.groupId}
            onChange={updateDraft}
          />
        ) : null}
        {step === 5 ? (
          <Step5Review
            draft={draft}
            groups={groups}
            knownUsers={knownUsers}
            onEditStep={jumpToStep}
            submitting={submitting}
            submitError={submitError}
            onCreate={handleCreate}
          />
        ) : null}
      </Card>

      <div className="flex items-center justify-between">
        <Button type="button" variant="ghost" onClick={handleBack} disabled={step === 1}>
          Back
        </Button>
        {step < 5 ? (
          <Button type="button" onClick={handleNext}>
            Next
          </Button>
        ) : null}
      </div>
    </div>
  );
}
