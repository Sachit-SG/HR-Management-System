import { NextResponse } from "next/server";

/** Liveness for Hub connector wiring (no API key required). */
export async function GET() {
  const connectorEnabled = process.env.HR_ASSISTANT_CONNECTOR_ENABLED !== "false";
  const keyConfigured = Boolean(process.env.HR_INTERNAL_ASSISTANT_API_KEY?.trim());
  const supabaseConfigured = Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() &&
      process.env.SUPABASE_SERVICE_ROLE_KEY?.trim(),
  );

  return NextResponse.json({
    ok: true,
    service: "hr-management-system",
    connectorEnabled,
    keyConfigured,
    supabaseConfigured,
    ready: connectorEnabled && keyConfigured && supabaseConfigured,
  });
}
