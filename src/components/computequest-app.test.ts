import { describe, expect, it } from "vitest";

import { deriveActiveStage, deriveComputeCell } from "@/components/computequest-app";

describe("ComputeQuest persisted stage rail", () => {
  it.each([
    [null, false, 0],
    [{ task: { id: "task", status: "AWAITING_CREDITS" } }, false, 1],
    [{ task: { id: "task", status: "AWAITING_CREDITS" }, quest: { state: "ACTIVE" } }, false, 2],
    [{ task: { id: "task", status: "AWAITING_CREDITS" }, settlement: { status: "SUBMITTED" } }, false, 3],
    [{ task: { id: "task", status: "PROCESSING" }, job: { id: "job", status: "PROCESSING" } }, false, 4],
    [{ task: { id: "task", status: "COMPLETED" }, job: { id: "job", status: "COMPLETED" } }, false, 5],
  ])("maps persisted state to stage %#", (task, result, expected) => {
    expect(deriveActiveStage({ task, result })).toBe(expected);
  });
});

describe("ComputeQuest compute cell", () => {
  it("shows the real starter ledger balance before a task exists", () => {
    expect(deriveComputeCell({ activeStage: 0, sessionBalance: 4, sessionReady: true, task: null })).toMatchObject({
      balance: 4,
      label: "24 CE / DECK",
    });
  });

  it("shows the persisted funding gap", () => {
    expect(deriveComputeCell({
      activeStage: 1,
      sessionBalance: 4,
      sessionReady: true,
      task: { task: { id: "task", status: "AWAITING_CREDITS" }, balance: 4, shortage: 20 },
    })).toMatchObject({ balance: 4, label: "20 CE GAP" });
  });

  it("shows the post-spend balance while generation is running", () => {
    expect(deriveComputeCell({
      activeStage: 4,
      sessionBalance: 4,
      sessionReady: true,
      task: {
        task: { id: "task", status: "PROCESSING" },
        job: { id: "job", status: "PROCESSING" },
        balance: 0,
      },
    })).toMatchObject({ balance: 0, label: "AI WORKING" });
  });

  it("labels a provider refund without claiming completion", () => {
    expect(deriveComputeCell({
      activeStage: 4,
      sessionBalance: 4,
      sessionReady: true,
      task: {
        task: { id: "task", status: "FAILED" },
        job: { id: "job", status: "REFUNDED" },
        balance: 24,
      },
    })).toMatchObject({ balance: 24, label: "CREDITS REFUNDED" });
  });
});
