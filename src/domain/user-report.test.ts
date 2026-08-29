import { describe, expect, it } from "vitest";

import { buildUserReport } from "@/domain/user-report";

describe("operator user report", () => {
  it("separates anonymous identities, ledger balances, tasks, and rewards", () => {
    const now = new Date("2026-08-29T12:00:00Z");
    const report = buildUserReport({
      now,
      users: [
        { id: "a", walletAddress: null, createdAt: new Date("2026-08-29T11:00:00Z") },
        { id: "b", walletAddress: "0xabc", createdAt: new Date("2026-08-20T11:00:00Z") },
      ],
      credits: [
        { userId: "a", amount: 4, type: "INITIAL_GRANT" },
        { userId: "a", amount: 20, type: "QUEST_GRANT" },
        { userId: "a", amount: -24, type: "TASK_SPEND" },
        { userId: "b", amount: 4, type: "INITIAL_GRANT" },
      ],
      tasks: [
        { userId: "a", status: "COMPLETED", createdAt: now },
        { userId: "b", status: "FAILED", createdAt: now },
      ],
      rewards: [
        { userId: "a", status: "CONFIRMED" },
        { userId: "b", status: "RESERVED" },
      ],
    });

    expect(report.identityBoundary).toMatchObject({ registeredAccounts: 0, durableSignIn: false });
    expect(report.users).toMatchObject({ anonymousIdentities: 2, walletLinked: 1, createdLast24Hours: 1 });
    expect(report.credits).toMatchObject({ issued: 28, spent: 24, currentOutstanding: 4, identitiesWithNegativeBalance: 0 });
    expect(report.tasks).toMatchObject({ total: 2, completed: 1, failed: 1 });
    expect(report.rewards).toEqual({ confirmed: 1, reserved: 1 });
  });
});
