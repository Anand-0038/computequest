import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCreditBalance: vi.fn(),
  getOrCreateSessionUserId: vi.fn(),
}));

vi.mock("@/server/auth/session", () => ({ getOrCreateSessionUserId: mocks.getOrCreateSessionUserId }));
vi.mock("@/server/services/tasks", () => ({ getCreditBalance: mocks.getCreditBalance }));

import { POST } from "@/app/api/session/route";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("anonymous session route", () => {
  it("returns the current persisted compute-credit balance", async () => {
    const userId = "00000000-0000-4000-8000-000000000001";
    mocks.getOrCreateSessionUserId.mockResolvedValue(userId);
    mocks.getCreditBalance.mockResolvedValue(4);

    const response = await POST();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ready: true, balance: 4 });
    expect(mocks.getCreditBalance).toHaveBeenCalledWith(userId);
  });

  it("fails visibly when the session ledger cannot be read", async () => {
    mocks.getOrCreateSessionUserId.mockRejectedValue(new Error("DATABASE_UNAVAILABLE"));

    const response = await POST();

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "DATABASE_UNAVAILABLE" });
    expect(mocks.getCreditBalance).not.toHaveBeenCalled();
  });
});
