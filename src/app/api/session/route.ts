import { NextResponse } from "next/server";

import { getOrCreateSessionUserId } from "@/server/auth/session";
import { getCreditBalance } from "@/server/services/tasks";

export async function POST() {
  try {
    const userId = await getOrCreateSessionUserId();
    const balance = await getCreditBalance(userId);
    return NextResponse.json({ ready: true, balance });
  } catch (error) {
    const message = error instanceof Error ? error.message : "SESSION_CREATE_FAILED";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
