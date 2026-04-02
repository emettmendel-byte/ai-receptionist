import type { MetricsEntry } from "./types.js";
import { redactUnknown } from "./security.js";

export function logMetric(m: MetricsEntry): void {
  console.log(
    JSON.stringify(redactUnknown({
      type: "receptionist_metric",
      ...m,
      manual_baseline_minutes: "5-10",
      automated_target_seconds: 30,
    })),
  );
}
