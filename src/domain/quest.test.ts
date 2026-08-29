import { describe, expect, it } from "vitest";

import { calculateHeartbeatTransition, isQuestSessionExpired, QUEST_SESSION_TTL_MS } from "@/domain/quest";

const activeHeartbeat = {
  sequence: 2,
  documentVisible: true,
  windowFocused: true,
  mediaPlaying: true,
  fullscreen: true,
  pictureInPicture: false,
  buffering: false,
  playbackRate: 1,
  mediaTimeMs: 3_000,
  durationMs: 40_000,
};

describe("server heartbeat accounting", () => {
  it("credits an eligible continuous interval", () => {
    const transition = calculateHeartbeatTransition({
      heartbeat: activeHeartbeat,
      previousSequence: 1,
      previousHeartbeatAt: new Date("2026-08-29T06:00:00.000Z"),
      previousEligible: true,
      previousMediaTimeMs: 0,
      now: new Date("2026-08-29T06:00:03.000Z"),
    });
    expect(transition).toMatchObject({ accepted: true, creditedMs: 3_000, nextState: "ACTIVE" });
  });

  it("pauses and credits nothing when focus is lost", () => {
    const transition = calculateHeartbeatTransition({
      heartbeat: { ...activeHeartbeat, windowFocused: false },
      previousSequence: 1,
      previousHeartbeatAt: new Date("2026-08-29T06:00:00.000Z"),
      previousEligible: true,
      previousMediaTimeMs: 0,
      now: new Date("2026-08-29T06:00:03.000Z"),
    });
    expect(transition).toMatchObject({ accepted: true, creditedMs: 0, nextState: "PAUSED" });
  });

  it("does not credit the interval that resumes after an ineligible heartbeat", () => {
    const transition = calculateHeartbeatTransition({
      heartbeat: activeHeartbeat,
      previousSequence: 1,
      previousHeartbeatAt: new Date("2026-08-29T06:00:00.000Z"),
      previousEligible: false,
      previousMediaTimeMs: 0,
      now: new Date("2026-08-29T06:00:03.000Z"),
    });
    expect(transition).toMatchObject({ accepted: true, creditedMs: 0, nextState: "ACTIVE" });
  });

  it("does not credit an oversized heartbeat gap", () => {
    const transition = calculateHeartbeatTransition({
      heartbeat: activeHeartbeat,
      previousSequence: 1,
      previousHeartbeatAt: new Date("2026-08-29T06:00:00.000Z"),
      previousEligible: true,
      previousMediaTimeMs: 0,
      now: new Date("2026-08-29T06:00:08.000Z"),
    });
    expect(transition).toMatchObject({ accepted: true, creditedMs: 0 });
  });

  it("rejects skipped or replayed sequences", () => {
    const transition = calculateHeartbeatTransition({
      heartbeat: { ...activeHeartbeat, sequence: 5 },
      previousSequence: 1,
      previousHeartbeatAt: null,
      previousEligible: false,
      previousMediaTimeMs: null,
      now: new Date(),
    });
    expect(transition).toEqual({ accepted: false, reason: "INVALID_SEQUENCE" });
  });

  it("rejects a playback-time jump even when client booleans claim eligibility", () => {
    const transition = calculateHeartbeatTransition({
      heartbeat: { ...activeHeartbeat, mediaTimeMs: 9_000 },
      previousSequence: 1,
      previousHeartbeatAt: new Date("2026-08-29T06:00:00.000Z"),
      previousEligible: true,
      previousMediaTimeMs: 0,
      now: new Date("2026-08-29T06:00:03.000Z"),
    });
    expect(transition).toMatchObject({
      accepted: true,
      creditedMs: 0,
      eligible: false,
      reason: "PLAYBACK_TIME_MISMATCH",
      nextState: "PAUSED",
    });
  });

  it.each([
    ["fullscreen", false, "FULLSCREEN_EXITED"],
    ["pictureInPicture", true, "PICTURE_IN_PICTURE"],
    ["buffering", true, "VIDEO_BUFFERING"],
    ["playbackRate", 1.5, "PLAYBACK_RATE_CHANGED"],
  ] as const)("pauses when %s fails", (field, value, reason) => {
    const transition = calculateHeartbeatTransition({
      heartbeat: { ...activeHeartbeat, [field]: value },
      previousSequence: 1,
      previousHeartbeatAt: new Date("2026-08-29T06:00:00.000Z"),
      previousEligible: true,
      previousMediaTimeMs: 0,
      now: new Date("2026-08-29T06:00:03.000Z"),
    });
    expect(transition).toMatchObject({ creditedMs: 0, eligible: false, reason, nextState: "PAUSED" });
  });
});

describe("quest session expiry", () => {
  const startedAt = new Date("2026-08-29T06:00:00.000Z");

  it("keeps a session valid immediately before the deadline", () => {
    expect(isQuestSessionExpired(startedAt, new Date(startedAt.getTime() + QUEST_SESSION_TTL_MS - 1))).toBe(false);
  });

  it("expires a session at the absolute deadline", () => {
    expect(isQuestSessionExpired(startedAt, new Date(startedAt.getTime() + QUEST_SESSION_TTL_MS))).toBe(true);
  });
});
