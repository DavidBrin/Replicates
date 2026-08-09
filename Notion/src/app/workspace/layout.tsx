import type { Metadata } from "next";
import { WorkspaceProviders } from "./providers";
import { WorkspaceShell } from "@/components/app-shell/WorkspaceShell";

export const metadata: Metadata = {
  title: "Workspace",
};

export default function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  return (
    <WorkspaceProviders>
      <WorkspaceShell>{children}</WorkspaceShell>
    </WorkspaceProviders>
  );
}
