import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { config } from "./config.js";
import {
  appointmentChangeAction,
  bookAppointmentAction,
  checkEligibilityAction,
  createPatientDraftAction,
  getAvailabilityAction,
  submitIntakeAction,
} from "./core/actions.js";
import { getIntegrationProvider } from "./integrations/registry.js";
import { redactUnknown } from "./security.js";

type ReqContext = {
  actorId: string;
  scopes: string[];
  idempotencyKey?: string;
};

function send(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(body));
}

function unauthorized(res: ServerResponse): void {
  send(res, 401, { ok: false, error: "unauthorized" });
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.from(chunk));
  }
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
  } catch {
    throw new Error("invalid_json");
  }
}

function contextFromHeaders(req: IncomingMessage): ReqContext {
  const actorId = String(req.headers["x-actor-id"] ?? "api-client");
  const scopes = String(req.headers["x-scopes"] ?? "admin")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const idempotencyKey =
    typeof req.headers["idempotency-key"] === "string" ? req.headers["idempotency-key"] : undefined;
  return { actorId, scopes, idempotencyKey };
}

function isAuthorizedRequest(req: IncomingMessage): boolean {
  if (!config.apiServerAuthToken) return true;
  const auth = req.headers.authorization ?? "";
  return auth === `Bearer ${config.apiServerAuthToken}`;
}

export function startApiServer(): void {
  if (!config.apiServerAuthToken) {
    console.warn(
      "API_SERVER_AUTH_TOKEN is not set; API endpoints are unauthenticated. Set a token before production use.",
    );
  }
  const server = createServer(async (req, res) => {
    try {
      if (!req.url || !req.method) return send(res, 404, { ok: false, error: "not_found" });
      if (!isAuthorizedRequest(req)) return unauthorized(res);
      const ctx = contextFromHeaders(req);
      const method = req.method.toUpperCase();
      const url = req.url.split("?")[0];

      if (method === "GET" && url === "/healthz") {
        return send(res, 200, {
          ok: true,
          provider: getIntegrationProvider().name,
          pilot_mode: config.pilotMode,
        });
      }

      if (method === "GET" && url === "/readyz") {
        const p = getIntegrationProvider();
        return send(res, 200, { ok: true, provider: p.name, capabilities: p.capabilities });
      }

      if (method === "GET" && url === "/availability") {
        const out = await getAvailabilityAction({
          actorId: ctx.actorId,
          authorizationScopes: ctx.scopes,
          sessionKey: `api:${ctx.actorId}`,
        });
        return send(res, out.ok ? 200 : 400, redactUnknown(out));
      }

      if (method === "POST" && url === "/appointments/book") {
        const body = await readJson(req);
        const out = await bookAppointmentAction(
          {
            actorId: ctx.actorId,
            authorizationScopes: ctx.scopes,
            sessionKey: `api:${ctx.actorId}`,
            idempotencyKey: ctx.idempotencyKey,
          },
          {
            rawText: String(body.rawText ?? body.whenHint ?? ""),
            whenHint: body.whenHint ? String(body.whenHint) : undefined,
            patientRef: body.patientRef ? String(body.patientRef) : null,
            visitType: body.visitType ? String(body.visitType) : null,
          },
        );
        return send(res, out.ok ? 200 : 400, redactUnknown(out));
      }

      if (method === "POST" && url === "/appointments/change") {
        const body = await readJson(req);
        const action = String(body.action ?? "");
        let reqBody:
          | { action: "cancel"; publicRef: string }
          | { action: "reschedule"; publicRef: string; newSlotLabel: string }
          | { action: "waitlist"; publicRef: string; whenHint: string; rawNotes?: string };
        if (action === "cancel") {
          reqBody = { action: "cancel", publicRef: String(body.publicRef ?? "") };
        } else if (action === "reschedule") {
          reqBody = {
            action: "reschedule",
            publicRef: String(body.publicRef ?? ""),
            newSlotLabel: String(body.newSlotLabel ?? ""),
          };
        } else {
          reqBody = {
            action: "waitlist",
            publicRef: String(body.publicRef ?? ""),
            whenHint: String(body.whenHint ?? ""),
            rawNotes: body.rawNotes ? String(body.rawNotes) : undefined,
          };
        }
        const out = await appointmentChangeAction(
          {
            actorId: ctx.actorId,
            authorizationScopes: ctx.scopes,
            sessionKey: `api:${ctx.actorId}`,
            idempotencyKey: ctx.idempotencyKey,
          },
          reqBody,
        );
        return send(res, out.ok ? 200 : 400, redactUnknown(out));
      }

      if (method === "POST" && url === "/eligibility/check") {
        const body = await readJson(req);
        const out = await checkEligibilityAction(
          {
            actorId: ctx.actorId,
            authorizationScopes: ctx.scopes,
            sessionKey: `api:${ctx.actorId}`,
          },
          {
            patientId: body.patientId ? String(body.patientId) : undefined,
            payer: body.payer ? String(body.payer) : undefined,
            memberId: body.memberId ? String(body.memberId) : undefined,
          },
        );
        return send(res, out.ok ? 200 : 400, redactUnknown(out));
      }

      if (method === "POST" && url === "/intake/submit") {
        const body = await readJson(req);
        const out = await submitIntakeAction(
          {
            actorId: ctx.actorId,
            authorizationScopes: ctx.scopes,
            sessionKey: `api:${ctx.actorId}`,
            idempotencyKey: ctx.idempotencyKey,
          },
          {
            meds: String(body.meds ?? ""),
            allergies: String(body.allergies ?? ""),
            pharmacy: String(body.pharmacy ?? ""),
          },
        );
        return send(res, out.ok ? 200 : 400, redactUnknown(out));
      }

      if (method === "POST" && url === "/drafts/patient-message") {
        const body = await readJson(req);
        const out = await createPatientDraftAction(
          {
            actorId: ctx.actorId,
            authorizationScopes: ctx.scopes,
            sessionKey: `api:${ctx.actorId}`,
          },
          {
            channel: String(body.channel ?? "sms") === "email" ? "email" : "sms",
            purpose: String(body.purpose ?? ""),
            who: body.who ? String(body.who) : undefined,
            when: body.when ? String(body.when) : undefined,
          },
        );
        return send(res, out.ok ? 200 : 400, redactUnknown(out));
      }

      return send(res, 404, { ok: false, error: "not_found" });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return send(res, 500, { ok: false, error: message });
    }
  });

  server.listen(config.apiServerPort, () => {
    console.log(`Receptionist API server listening on :${config.apiServerPort}`);
  });
}
