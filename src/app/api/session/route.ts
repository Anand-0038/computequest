import { NextResponse } from "next/server";

import { getOrCreateSessionUserId } from "@/server/auth/session";

export async function POST() {
  try {
    await getOrCreateSessionUserId();
    return NextResponse.json({ ready: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "SESSION_CREATE_FAILED";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
