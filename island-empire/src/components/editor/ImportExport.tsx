"use client";

import { useState } from "react";

import { parseMapDefinition } from "@/lib/mapSchema";

import { useEditorStore } from "./editorStore";
import { PixelButton, PixelText } from "./ui";

/** A JSON textarea: Export fills it from the draft, Import parses it back. */
export function ImportExport() {
  const draft = useEditorStore((s) => s.draft);
  const load = useEditorStore((s) => s.load);
  const [text, setText] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const [notice, setNotice] = useState<string | null>(null);

  const doExport = () => {
    setText(JSON.stringify(draft, null, 2));
    setErrors([]);
    setNotice("Exported the current draft.");
  };

  const doImport = () => {
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      setErrors(["not valid JSON"]);
      setNotice(null);
      return;
    }
    const result = parseMapDefinition(raw);
    if (!result.ok) {
      setErrors(result.errors);
      setNotice(null);
      return;
    }
    load({ ...result.map, id: null });
    setErrors([]);
    setNotice(`Imported "${result.map.name}".`);
  };

  return (
    <div className="flex flex-col gap-1.5" data-testid="editor-import-export">
      <PixelText as="h3" className="text-xs uppercase tracking-wider">
        Import / Export JSON
      </PixelText>
      <textarea
        data-testid="editor-json"
        className="h-28 w-full rounded border-2 border-[#1A1010] bg-[#F1E2B2] p-1 font-mono text-[10px] text-[#1A1010]"
        value={text}
        onChange={(e) => setText(e.target.value)}
        spellCheck={false}
        aria-label="Map JSON"
      />
      <div className="flex gap-1.5">
        <PixelButton onClick={doExport} data-testid="editor-export" className="text-xs">
          Export
        </PixelButton>
        <PixelButton onClick={doImport} data-testid="editor-import" className="text-xs" disabled={text.trim() === ""}>
          Import
        </PixelButton>
      </div>
      {notice ? <p className="text-xs text-[#F1E2B2]">{notice}</p> : null}
      {errors.length > 0 ? (
        <ul className="list-disc px-5 text-xs text-[#FFB4A8]" data-testid="editor-import-errors">
          {errors.map((error, i) => (
            <li key={`${i}-${error}`}>{error}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
