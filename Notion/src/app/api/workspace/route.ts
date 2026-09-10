/**
 * Optional server-side persistence.
 *
 * Inert by default: with no `DATABASE_URL` configured, every method answers
 * `501 Not Implemented` rather than throwing. That is what lets the project
 * deploy to Vercel with zero environment variables — the route exists, is
 * type-checked and is deployed, but nothing depends on it until you opt in
 * with `NEXT_PUBLIC_STORAGE_DRIVER=rest`.
 *
 * To enable it, provision a database (Neon, Supabase, or anything Postgres),
 * set both `DATABASE_URL` and `NEXT_PUBLIC_STORAGE_DRIVER=rest`. Persistence
 * lives in `./persistence` (Neon JSONB snapshot). The database driver is
 * imported *inside* the handler so it never enters the client bundle and a
 * missing dependency cannot break the build.
 *
 * This endpoint is intentionally unauthenticated (demo / single-tenant). Set
 * `WORKSPACE_PERSISTENCE_SECRET` and send matching `x-workspace-secret` from
 * the client if the deployment is reachable beyond a private preview.
 */

import { NextResponse } from "next/server";
import type { WorkspaceSnapshot } from "@/lib/model/types";

/** Server persistence is configured only when a connection string exists. */
function isConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL?.trim());
}

function unauthorizedIfSecretMismatch(request: Request): NextResponse | null {
  const expected = process.env.WORKSPACE_PERSISTENCE_SECRET?.trim();
  if (!expected) return null;
  const provided = request.headers.get("x-workspace-secret");
  if (provided === expected) return null;
  return NextResponse.json(
    { error: "Invalid or missing x-workspace-secret." },
    { status: 401 },
  );
}

const NOT_CONFIGURED = NextResponse.json(
  {
    error: "Server persistence is not configured.",
    hint: "Set DATABASE_URL and NEXT_PUBLIC_STORAGE_DRIVER=rest to enable Neon persistence. The app works without it using browser storage.",
  },
  { status: 501 },
);

export async function GET(request: Request) {
  if (!isConfigured()) return NOT_CONFIGURED;
  const denied = unauthorizedIfSecretMismatch(request);
  if (denied) return denied;

  const { readSnapshot } = await import("./persistence");
  const snapshot = await readSnapshot();
  // A missing snapshot is a normal first-run state, and the client adapter
  // reads 404 as "nothing saved yet".
  if (!snapshot) return new NextResponse(null, { status: 404 });
  return NextResponse.json(snapshot);
}

export async function PUT(request: Request) {
  if (!isConfigured()) return NOT_CONFIGURED;
  const denied = unauthorizedIfSecretMismatch(request);
  if (denied) return denied;

  let snapshot: WorkspaceSnapshot;
  try {
    snapshot = (await request.json()) as WorkspaceSnapshot;
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }
  if (!snapshot?.workspace || !snapshot?.pages) {
    return NextResponse.json({ error: "Not a workspace snapshot." }, { status: 422 });
  }

  const { writeSnapshot } = await import("./persistence");
  await writeSnapshot(snapshot);
  return new NextResponse(null, { status: 204 });
}

export async function DELETE(request: Request) {
  if (!isConfigured()) return NOT_CONFIGURED;
  const denied = unauthorizedIfSecretMismatch(request);
  if (denied) return denied;

  const { deleteSnapshot } = await import("./persistence");
  await deleteSnapshot();
  return new NextResponse(null, { status: 204 });
}
