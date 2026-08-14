"use client";

/**
 * The workspace the client half of the app is currently inside.
 *
 * The layout is a server component: it loads the workspace, the viewer, their
 * teams and their views once per navigation, and everything below it reads them
 * from here. The alternative — prop-drilling the same five objects through the
 * shell, the sidebar, the header and the toolbar — means every one of those
 * components has a signature describing data it does not use.
 *
 * Nothing in here is mutable. It is a snapshot of one render, replaced whole
 * when the server sends a new one, so there is no synchronisation question: the
 * issue store owns everything that changes without a navigation.
 */

import { createContext, useContext, type ReactNode } from "react";

import type { Team, TeamId, UserId, ViewId, WorkspaceId } from "@/domain/entities";

export interface ShellUser {
  readonly id: UserId;
  readonly name: string;
  readonly email: string;
  readonly avatarUrl: string | null;
  readonly avatarColor: string;
}

export type ShellTeam = Pick<
  Team,
  "id" | "key" | "name" | "icon" | "color" | "private"
>;

export interface ShellWorkspace {
  readonly id: WorkspaceId;
  readonly name: string;
  readonly urlKey: string;
}

export interface ShellView {
  readonly id: ViewId;
  readonly name: string;
  readonly icon: string;
  readonly color: string;
  readonly teamId: TeamId | null;
}

export interface ShellData {
  readonly workspace: ShellWorkspace;
  /** Every workspace the viewer belongs to, for the switcher. */
  readonly workspaces: readonly ShellWorkspace[];
  readonly user: ShellUser;
  /** Only the teams this viewer may see — a guest's sidebar is their whole world. */
  readonly teams: readonly ShellTeam[];
  readonly views: readonly ShellView[];
  readonly unreadCount: number;
}

const WorkspaceContext = createContext<ShellData | null>(null);

export function WorkspaceProvider({
  value,
  children,
}: {
  value: ShellData;
  children: ReactNode;
}) {
  return (
    <WorkspaceContext.Provider value={value}>
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspace(): ShellData {
  const value = useContext(WorkspaceContext);
  if (!value) {
    throw new Error("useWorkspace must be used inside <WorkspaceProvider>");
  }
  return value;
}

/** `/{urlKey}/…`, built once so no component concatenates a path by hand. */
export function workspacePath(urlKey: string, ...segments: string[]): string {
  return `/${[urlKey, ...segments].map(encodeURIComponent).join("/")}`;
}
