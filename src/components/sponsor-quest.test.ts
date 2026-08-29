import { describe, expect, it } from "vitest";

import { isVideoActuallyPlaying } from "@/components/sponsor-quest";

describe("sponsor video eligibility", () => {
  it("accepts only observed, playable media", () => {
    expect(isVideoActuallyPlaying({ paused: false, ended: false, readyState: 3, seeking: false })).toBe(true);
    expect(isVideoActuallyPlaying({ paused: false, ended: false, readyState: 4, seeking: false })).toBe(true);
  });

  it("rejects paused, ended, or buffering media", () => {
    expect(isVideoActuallyPlaying({ paused: true, ended: false, readyState: 4, seeking: false })).toBe(false);
    expect(isVideoActuallyPlaying({ paused: false, ended: true, readyState: 4, seeking: false })).toBe(false);
    expect(isVideoActuallyPlaying({ paused: false, ended: false, readyState: 2, seeking: false })).toBe(false);
    expect(isVideoActuallyPlaying({ paused: false, ended: false, readyState: 4, seeking: true })).toBe(false);
    expect(isVideoActuallyPlaying(null)).toBe(false);
  });
});
