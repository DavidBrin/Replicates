"use client";

import { useMemo } from "react";

import { checkMap, type MapCheck } from "@/lib/engineValidate";

import { useEditorStore } from "./editorStore";
import { UI } from "./palette";
import { PixelText } from "./ui";

/** Lists `validateMap`'s errors live; recomputed on every draft change. */
export function useMapCheck(): MapCheck {
  const draft = useEditorStore((s) => s.draft);
  return useMemo(() => checkMap(draft), [draft]);
}

export function ValidatePanel() {
  const check = useMapCheck();
  const errors = [...check.shapeErrors, ...check.ruleErrors];

  return (
    <div className="flex flex-col gap-1" data-testid="editor-validate" data-valid={check.valid ? "true" : "false"}>
      <div className="flex items-center gap-2">
        <span
          className="inline-block h-3 w-3 rounded-full border-2 border-[#1A1010]"
          style={{ background: check.valid ? UI.greenLight : check.engineReady ? UI.red : UI.cardYellow }}
          aria-hidden
        />
        <PixelText as="h3" className="text-xs uppercase tracking-wider">
          {check.valid ? "Map is valid" : check.engineReady ? `${errors.length} problem${errors.length === 1 ? "" : "s"}` : "Engine not ready"}
        </PixelText>
      </div>
      {errors.length > 0 ? (
        <ul className="max-h-40 list-disc overflow-auto rounded bg-[#1A1010]/40 px-5 py-1 text-xs text-[#F1E2B2]">
          {errors.map((error, i) => (
            <li key={`${i}-${error}`}>{error}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
