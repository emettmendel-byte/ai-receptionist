/**
 * Resolve Slack post_at (unix seconds) from NL entities. Prototype rules only.
 */
export function resolvePostAt(args: {
  when_iso?: string;
  when?: string;
  now?: Date;
}): { postAt: number; label: string } | null {
  const now = args.now ?? new Date();
  // Slack scheduleMessage generally requires post_at far enough in the future; 60s is safe for demos.
  const minSkew = 60;

  if (args.when_iso) {
    const d = new Date(args.when_iso);
    const t = Math.floor(d.getTime() / 1000);
    const soon = Math.floor(now.getTime() / 1000) + minSkew;
    if (!Number.isNaN(t) && t >= soon) {
      return { postAt: t, label: args.when_iso };
    }
  }

  const w = args.when?.toLowerCase() ?? "";
  const rel = w.match(/in\s+(\d+)\s*(second|minute|hour)s?/i);
  if (rel) {
    const n = parseInt(rel[1], 10);
    const u = rel[2].toLowerCase();
    const add =
      u.startsWith("second") ? n * 1000 : u.startsWith("minute") ? n * 60_000 : n * 3600_000;
    const ms = Math.max(minSkew * 1000, add);
    const postMs = now.getTime() + ms;
    return {
      postAt: Math.floor(postMs / 1000),
      label: `in ${n} ${u}`,
    };
  }

  return null;
}
