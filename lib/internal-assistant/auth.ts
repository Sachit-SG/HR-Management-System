import { timingSafeEqual } from "node:crypto";

const HEADER_NAMES = ["x-internal-api-key", "x-hr-internal-api-key"] as const;

/**
 * Validates Hub → HR internal assistant requests.
 * Set `HR_INTERNAL_ASSISTANT_API_KEY` on HR Vercel/Doppler (server-only).
 */
export function validateInternalAssistantRequest(request: Request): {
  ok: boolean;
  reason?: string;
} {
  if (process.env.HR_ASSISTANT_CONNECTOR_ENABLED === "false") {
    return { ok: false, reason: "connector_disabled" };
  }

  const expected = process.env.HR_INTERNAL_ASSISTANT_API_KEY?.trim();
  if (!expected) {
    return { ok: false, reason: "missing_server_key" };
  }

  let provided: string | undefined;
  for (const name of HEADER_NAMES) {
    const v = request.headers.get(name)?.trim();
    if (v) {
      provided = v;
      break;
    }
  }
  if (!provided) {
    const auth = request.headers.get("authorization")?.trim();
    if (auth?.toLowerCase().startsWith("bearer ")) {
      provided = auth.slice(7).trim();
    }
  }
  if (!provided) {
    return { ok: false, reason: "missing_api_key" };
  }

  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, reason: "invalid_api_key" };
  }

  return { ok: true };
}
