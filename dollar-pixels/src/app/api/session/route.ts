import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { SESSION_COOKIE } from "@/adapters/auth/demo-session";
import { signIn } from "@/domain/services/users";
import { AppError } from "@/domain/services/errors";
import { getContainer } from "@/lib/container";
import { handler, ok, readJson } from "@/lib/http";
import { firstIssue, signInSchema } from "@/lib/schemas";

export const POST = handler(async (req: Request) => {
  const parsed = signInSchema.safeParse(await readJson(req));
  if (!parsed.success) throw new AppError("invalid", firstIssue(parsed.error));

  const c = await getContainer();
  const user = await signIn(c, parsed.data.displayName);
  const token = await c.auth.createSession({ userId: user.id, handle: user.handle });

  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    // Not `secure` unconditionally: local development is plain http and a
    // secure cookie would simply never be stored there.
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });

  return ok({ user });
});

export const DELETE = handler(async () => {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
  return NextResponse.json({ ok: true, data: { signedOut: true } } as const);
});
