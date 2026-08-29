import { describe, expect, it } from "vitest";

import { deriveActiveStage } from "@/components/computequest-app";

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
