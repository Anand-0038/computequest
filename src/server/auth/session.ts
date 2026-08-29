import { createHmac, timingSafeEqual } from "node:crypto";

import { cookies } from "next/headers";

import { INITIAL_DEMO_BALANCE } from "@/domain/constants";
import { getDatabase } from "@/server/db/client";
import { creditEntries, users } from "@/server/db/schema";
import { requireRuntimeEnv } from "@/server/env";

const COOKIE_NAME = "computequest_session";

function signatureFor(userId: string, secret: string) {
  return createHmac("sha256", secret).update(`computequest:${userId}`).digest("hex");
}

export function createSessionToken(userId: string, secret: string) {
  return `${userId}.${signatureFor(userId, secret)}`;
}

export function verifySessionToken(token: string, secret: string) {
  const separator = token.lastIndexOf(".");
  if (separator < 1) return null;
  const userId = token.slice(0, separator);
  const supplied = token.slice(separator + 1);
  if (!/^[0-9a-f-]{36}$/i.test(userId) || !/^[0-9a-f]{64}$/i.test(supplied)) return null;
  const expected = signatureFor(userId, secret);
  return timingSafeEqual(Buffer.from(supplied, "hex"), Buffer.from(expected, "hex")) ? userId : null;
}

export async function requireSessionUserId() {
  const env = requireRuntimeEnv();
  const token = (await cookies()).get(COOKIE_NAME)?.value;
  const userId = token ? verifySessionToken(token, env.SESSION_SIGNING_SECRET) : null;
  if (!userId) throw new Error("SESSION_REQUIRED");
  return userId;
}

export async function createAnonymousSession() {
  const env = requireRuntimeEnv();
  const userId = crypto.randomUUID();
  await ensureSessionUser(userId);
  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, createSessionToken(userId, env.SESSION_SIGNING_SECRET), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24,
  });
  return userId;
}

async function ensureSessionUser(userId: string) {
  const db = getDatabase();
  await db.transaction(async (tx) => {
    await tx.insert(users).values({ id: userId }).onConflictDoNothing({ target: users.id });
    await tx
      .insert(creditEntries)
      .values({
        id: crypto.randomUUID(),
        userId,
        amount: INITIAL_DEMO_BALANCE,
        type: "INITIAL_GRANT",
        referenceId: userId,
        idempotencyKey: `initial-grant:${userId}`,
      })
      .onConflictDoNothing({ target: creditEntries.idempotencyKey });
  });
}

export async function getOrCreateSessionUserId() {
  try {
    const userId = await requireSessionUserId();
    await ensureSessionUser(userId);
    return userId;
  } catch {
    return createAnonymousSession();
  }
}
