"use client";

export function Divider() {
  return (
    <div className="py-[6px]" contentEditable={false}>
      <div style={{ height: 1, background: "var(--bor-pri)" }} role="separator" />
    </div>
  );
}
