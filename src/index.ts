import { App } from "@slack/bolt";
import { assertSlackEnv, config } from "./config.js";
import { flushDueReminders } from "./scheduler.js";
import { handleUserMessage } from "./handler.js";
import { shouldProcessInboundMessage } from "./messageDedupe.js";
import { resolveInboundMessageText } from "./voice/messageText.js";

assertSlackEnv();

const app = new App({
  token: config.slackBotToken,
  appToken: config.slackAppToken,
  socketMode: true,
  signingSecret: config.slackSigningSecret,
});

function parentThreadTs(threadTs: string | undefined, messageTs: string): string {
  return threadTs ?? messageTs;
}

app.message(async ({ message, say, context }) => {
  if (!("user" in message) || !message.user) return;
  if ("bot_id" in message && message.bot_id) return;

  const subtype = "subtype" in message ? message.subtype : undefined;
  if (subtype && subtype !== "file_share") return;

  const channelId =
    "channel" in message && typeof message.channel === "string" ? message.channel : undefined;
  if (!channelId) return;

  const ts = "ts" in message && typeof message.ts === "string" ? message.ts : undefined;
  if (!ts) return;

  const threadTs =
    "thread_ts" in message && typeof message.thread_ts === "string"
      ? message.thread_ts
      : undefined;

  const pThread = parentThreadTs(threadTs, ts);

  const bodyUserId =
    typeof context.userId === "string" && context.userId ? context.userId : message.user;

  if (!shouldProcessInboundMessage({ channelId, messageTs: ts, userId: bodyUserId })) {
    return;
  }

  const resolved = await resolveInboundMessageText(
    message as unknown as Record<string, unknown>,
    config.slackBotToken,
  );

  if (resolved.kind === "skip") return;

  if (resolved.kind === "notify") {
    await say({ text: resolved.text, thread_ts: pThread });
    return;
  }

  if (!resolved.text.trim()) return;

  await handleUserMessage({
    app,
    bodyUserId,
    text: resolved.text,
    channelId,
    messageTs: ts,
    threadTs,
    say,
  });
});

setInterval(() => {
  void flushDueReminders(app.client);
}, 60_000);

await app.start();
console.log("Greens Health AI receptionist (socket mode) is running.");
