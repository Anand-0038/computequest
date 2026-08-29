import { z } from "zod";

export const HEARTBEAT_INTERVAL_MS = 3_000;
export const MAX_CREDITABLE_HEARTBEAT_GAP_MS = 7_000;
export const PLAYBACK_TIME_TOLERANCE_MS = 1_250;
export const QUEST_SESSION_TTL_MS = 15 * 60_000;

export const heartbeatSchema = z.object({
  sequence: z.number().int().positive(),
  documentVisible: z.boolean(),
  windowFocused: z.boolean(),
  mediaPlaying: z.boolean(),
  fullscreen: z.boolean(),
  pictureInPicture: z.boolean(),
  buffering: z.boolean(),
  playbackRate: z.number().finite().positive().max(4),
  mediaTimeMs: z.number().int().nonnegative(),
  durationMs: z.number().int().positive(),
});

export type HeartbeatInput = z.infer<typeof heartbeatSchema>;

export function isQuestSessionExpired(serverStartedAt: Date, now: Date) {
  return now.getTime() - serverStartedAt.getTime() >= QUEST_SESSION_TTL_MS;
}

export function calculateHeartbeatTransition(input: {
  heartbeat: HeartbeatInput;
  previousSequence: number;
  previousHeartbeatAt: Date | null;
  previousEligible: boolean;
  previousMediaTimeMs: number | null;
  now: Date;
}) {
  const { heartbeat, previousSequence, previousHeartbeatAt, previousEligible, previousMediaTimeMs, now } = input;
  if (heartbeat.sequence !== previousSequence + 1) {
    return { accepted: false as const, reason: "INVALID_SEQUENCE" as const };
  }

  const baseReason = getAttentionReason(heartbeat);
  const baseEligible = baseReason === "VERIFIED";

  if (!previousHeartbeatAt) {
    return {
      accepted: true as const,
      creditedMs: 0,
      eligible: baseEligible,
      reason: baseReason,
      nextState: baseEligible ? ("ACTIVE" as const) : ("PAUSED" as const),
    };
  }

  const gapMs = now.getTime() - previousHeartbeatAt.getTime();
  if (gapMs < 0) {
    return { accepted: false as const, reason: "CLOCK_REGRESSION" as const };
  }

  const mediaDeltaMs = previousMediaTimeMs === null ? 0 : heartbeat.mediaTimeMs - previousMediaTimeMs;
  let eligible = baseEligible;
  let reason = baseReason;
  if (eligible && previousEligible && previousMediaTimeMs !== null) {
    if (mediaDeltaMs < 0) {
      eligible = false;
      reason = "PLAYBACK_TIME_REGRESSION";
    } else if (Math.abs(mediaDeltaMs - gapMs) > PLAYBACK_TIME_TOLERANCE_MS) {
      eligible = false;
      reason = "PLAYBACK_TIME_MISMATCH";
    }
  }
  if (eligible && gapMs > MAX_CREDITABLE_HEARTBEAT_GAP_MS) {
    eligible = false;
    reason = "HEARTBEAT_GAP";
  }

  return {
    accepted: true as const,
    creditedMs: previousEligible && eligible ? gapMs : 0,
    eligible,
    reason,
    nextState: eligible ? ("ACTIVE" as const) : ("PAUSED" as const),
  };
}

export type AttentionReason =
  | "VERIFIED"
  | "DOCUMENT_HIDDEN"
  | "WINDOW_BLURRED"
  | "FULLSCREEN_EXITED"
  | "PICTURE_IN_PICTURE"
  | "VIDEO_BUFFERING"
  | "VIDEO_NOT_PLAYING"
  | "PLAYBACK_RATE_CHANGED"
  | "PLAYBACK_TIME_REGRESSION"
  | "PLAYBACK_TIME_MISMATCH"
  | "HEARTBEAT_GAP";

export function getAttentionReason(heartbeat: HeartbeatInput): AttentionReason {
  if (!heartbeat.documentVisible) return "DOCUMENT_HIDDEN";
  if (!heartbeat.windowFocused) return "WINDOW_BLURRED";
  if (!heartbeat.fullscreen) return "FULLSCREEN_EXITED";
  if (heartbeat.pictureInPicture) return "PICTURE_IN_PICTURE";
  if (heartbeat.buffering) return "VIDEO_BUFFERING";
  if (!heartbeat.mediaPlaying) return "VIDEO_NOT_PLAYING";
  if (Math.abs(heartbeat.playbackRate - 1) > 0.001) return "PLAYBACK_RATE_CHANGED";
  return "VERIFIED";
}
