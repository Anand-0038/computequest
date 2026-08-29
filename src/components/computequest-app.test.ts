import { describe, expect, it } from "vitest";

import { deriveActiveStage, deriveComputeCell, shouldRecoverFundedJob } from "@/components/computequest-app";

describe("ComputeQuest persisted stage rail", () => {
  it.each([
    [null, false, 0],
    [{ task: { id: "task", status: "AWAITING_CREDITS" } }, false, 1],
    [{ task: { id: "task", status: "AWAITING_CREDITS" }, quest: { state: "ACTIVE" } }, false, 2],
    [{ task: { id: "task", status: "AWAITING_CREDITS" }, settlement: { status: "SUBMITTED" } }, false, 3],
    [{ task: { id: "task", status: "PROCESSING" }, job: { id: "job", status: "PROCESSING" } }, false, 4],
    [{ task: { id: "task", status: "FAILED" }, job: { id: "job", status: "FAILED" } }, false, 4],
    [{ task: { id: "task", status: "COMPLETED" }, job: { id: "job", status: "COMPLETED" } }, false, 5],
  ])("maps persisted state to stage %#", (task, result, expected) => {
    expect(deriveActiveStage({ task, result })).toBe(expected);
  });
});

describe("ComputeQuest compute cell", () => {
  it("shows the real starter ledger balance before a task exists", () => {
    expect(deriveComputeCell({ activeStage: 0, sessionBalance: 4, sessionReady: true, task: null })).toMatchObject({
      balance: 4,
      label: "DECK COST · 24 CE",
      shortage: 20,
      target: 24,
    });
  });

  it("shows the persisted funding gap", () => {
    expect(deriveComputeCell({
      activeStage: 1,
      sessionBalance: 4,
      sessionReady: true,
      task: { task: { id: "task", status: "AWAITING_CREDITS" }, balance: 4, shortage: 20 },
    })).toMatchObject({
      balance: 4,
      label: "FUNDING GAP",
      shortage: 20,
      target: 24,
      detail: expect.stringContaining("+20 CE"),
    });
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

  it("labels a capped stale-attempt refund as terminal", () => {
    expect(deriveComputeCell({
      activeStage: 4,
      sessionBalance: 0,
      sessionReady: true,
      task: {
        task: { id: "task", status: "FAILED" },
        job: { id: "job", status: "FAILED" },
        balance: 24,
      },
    })).toMatchObject({
      balance: 24,
      label: "CREDITS REFUNDED",
      detail: expect.stringContaining("start a new task"),
    });
  });
});

describe("ComputeQuest funded-job recovery", () => {
  it("restarts only a persisted funded job", () => {
    expect(shouldRecoverFundedJob({
      task: { id: "task", status: "FUNDED" },
      job: { id: "job", status: "FUNDED" },
    })).toBe(true);
    expect(shouldRecoverFundedJob({
      task: { id: "task", status: "PROCESSING" },
      job: { id: "job", status: "PROCESSING" },
    })).toBe(false);
    expect(shouldRecoverFundedJob(null)).toBe(false);
  });
});
