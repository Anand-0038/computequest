import { describe, expect, it } from "vitest";

import { createSessionToken, verifySessionToken } from "@/server/auth/session";

const secret = "a-secure-test-secret-with-at-least-32-characters";
const userId = "00000000-0000-4000-8000-000000000001";

describe("anonymous session tokens", () => {
  it("accepts an authentic signed token", () => {
    expect(verifySessionToken(createSessionToken(userId, secret), secret)).toBe(userId);
  });

  it("rejects a tampered user identifier", () => {
    const token = createSessionToken(userId, secret);
    expect(verifySessionToken(`00000000-0000-4000-8000-000000000002.${token.split(".")[1]}`, secret)).toBeNull();
  });
});
