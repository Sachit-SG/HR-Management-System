import { NextResponse } from "next/server";
import { logInternalAssistant } from "@/lib/internal-assistant/log";

export function jsonOk<T extends Record<string, unknown>>(data: T, status = 200) {
  return NextResponse.json({ ok: true, ...data }, { status });
}

export function jsonError(
  error: string,
  status: number,
  extra?: Record<string, unknown>,
) {
  logInternalAssistant("ERROR", { error, status, ...extra });
  return NextResponse.json({ ok: false, error, ...extra }, { status });
}

export function unauthorized(reason: string) {
  const status = reason === "connector_disabled" ? 503 : 401;
  const message =
    reason === "missing_server_key"
      ? "HR internal assistant API key is not configured."
      : reason === "connector_disabled"
        ? "HR assistant connector is disabled."
        : reason === "missing_api_key"
          ? "Missing internal API key."
          : "Invalid internal API key.";
  return jsonError(message, status, { reason });
}

export function forbidden(message: string, reason?: string) {
  return jsonError(message, 403, reason ? { reason } : undefined);
}
