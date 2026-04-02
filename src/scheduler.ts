import { randomUUID } from "node:crypto";
import type { WebClient } from "@slack/web-api";
import { getDb } from "./db.js";

export type ReminderJobRow = {
  id: string;
  fire_at: number;
  channel_id: string;
  thread_ts: string | null;
  text: string;
  user_id: string;
  status: string;
  slack_scheduled_id: string | null;
};

export function insertReminderJob(row: Omit<ReminderJobRow, "slack_scheduled_id"> & { slack_scheduled_id?: string }): void {
  getDb()
    .prepare(
      `INSERT INTO reminder_jobs(id, fire_at, channel_id, thread_ts, text, user_id, status, slack_scheduled_id, created_at)
       VALUES(?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      row.id,
      row.fire_at,
      row.channel_id,
      row.thread_ts,
      row.text,
      row.user_id,
      row.status,
      row.slack_scheduled_id ?? null,
      new Date().toISOString(),
    );
}

export function markReminderScheduled(id: string, slackScheduledId: string): void {
  getDb()
    .prepare(`UPDATE reminder_jobs SET slack_scheduled_id = ?, status = 'scheduled' WHERE id = ?`)
    .run(slackScheduledId, id);
}

export function markReminderError(id: string, err: string): void {
  getDb()
    .prepare(`UPDATE reminder_jobs SET status = 'error', error = ? WHERE id = ?`)
    .run(err, id);
}

export async function scheduleSlackReminder(client: WebClient, args: {
  channelId: string;
  threadTs: string | undefined;
  postAt: number;
  text: string;
  userId: string;
}): Promise<{ jobId: string; scheduledMessageId: string }> {
  const jobId = randomUUID();
  insertReminderJob({
    id: jobId,
    fire_at: args.postAt,
    channel_id: args.channelId,
    thread_ts: args.threadTs ?? null,
    text: args.text,
    user_id: args.userId,
    status: "pending",
  });

  const res = await client.chat.scheduleMessage({
    channel: args.channelId,
    post_at: args.postAt,
    text: args.text,
    thread_ts: args.threadTs,
  });

  if (!res.ok || !res.scheduled_message_id) {
    markReminderError(jobId, res.error ?? "scheduleMessage failed");
    throw new Error(res.error ?? "scheduleMessage failed");
  }

  markReminderScheduled(jobId, res.scheduled_message_id);
  return { jobId, scheduledMessageId: res.scheduled_message_id };
}

/** Fallback poller: post now if a pending job missed Slack scheduling (demo resilience). */
export async function flushDueReminders(client: WebClient, nowSec: number = Math.floor(Date.now() / 1000)): Promise<void> {
  const rows = getDb()
    .prepare(
      `SELECT * FROM reminder_jobs WHERE status = 'pending' AND fire_at <= ? ORDER BY fire_at ASC LIMIT 10`,
    )
    .all(nowSec) as ReminderJobRow[];

  for (const r of rows) {
    try {
      await client.chat.postMessage({
        channel: r.channel_id,
        thread_ts: r.thread_ts ?? undefined,
        text: `${r.text}\n_(fallback post — scheduleMessage was not confirmed)_`,
      });
      getDb().prepare(`UPDATE reminder_jobs SET status = 'posted_fallback' WHERE id = ?`).run(r.id);
    } catch (e) {
      markReminderError(r.id, e instanceof Error ? e.message : String(e));
    }
  }
}
