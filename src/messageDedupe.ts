const DEFAULT_DEDUPE_TTL_MS = 10 * 60 * 1000;

type InboundMessageFingerprint = {
  channelId: string;
  messageTs: string;
  userId: string;
};

const seenInboundMessages = new Map<string, number>();

function makeKey(input: InboundMessageFingerprint): string {
  return `${input.channelId}:${input.messageTs}:${input.userId}`;
}

function pruneExpired(nowMs: number, ttlMs: number): void {
  for (const [key, seenAtMs] of seenInboundMessages.entries()) {
    if (nowMs - seenAtMs > ttlMs) seenInboundMessages.delete(key);
  }
}

/**
 * Returns true if this inbound message fingerprint has not been seen recently.
 * Useful for Slack duplicate event deliveries/retries in socket mode.
 */
export function shouldProcessInboundMessage(
  input: InboundMessageFingerprint,
  nowMs = Date.now(),
  ttlMs = DEFAULT_DEDUPE_TTL_MS,
): boolean {
  pruneExpired(nowMs, ttlMs);

  const key = makeKey(input);
  const previous = seenInboundMessages.get(key);
  if (typeof previous === "number" && nowMs - previous <= ttlMs) {
    return false;
  }

  seenInboundMessages.set(key, nowMs);
  return true;
}

export function _resetInboundMessageDedupeForTests(): void {
  seenInboundMessages.clear();
}
