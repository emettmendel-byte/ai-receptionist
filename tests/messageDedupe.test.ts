import { describe, expect, it } from "vitest";
import {
  _resetInboundMessageDedupeForTests,
  shouldProcessInboundMessage,
} from "../src/messageDedupe.js";

describe("message dedupe", () => {
  it("allows the first message and blocks immediate duplicate", () => {
    _resetInboundMessageDedupeForTests();
    const input = { channelId: "C1", messageTs: "171201.000001", userId: "U1" };

    expect(shouldProcessInboundMessage(input, 1_000, 60_000)).toBe(true);
    expect(shouldProcessInboundMessage(input, 2_000, 60_000)).toBe(false);
  });

  it("allows same ts from different users", () => {
    _resetInboundMessageDedupeForTests();

    expect(
      shouldProcessInboundMessage({ channelId: "C1", messageTs: "171201.000001", userId: "U1" }),
    ).toBe(true);
    expect(
      shouldProcessInboundMessage({ channelId: "C1", messageTs: "171201.000001", userId: "U2" }),
    ).toBe(true);
  });

  it("expires old keys after ttl", () => {
    _resetInboundMessageDedupeForTests();
    const input = { channelId: "C1", messageTs: "171201.000001", userId: "U1" };

    expect(shouldProcessInboundMessage(input, 10_000, 5_000)).toBe(true);
    expect(shouldProcessInboundMessage(input, 20_001, 5_000)).toBe(true);
  });
});
