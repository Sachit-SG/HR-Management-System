"use server";

import { loadTimecardModalPool } from "@/lib/time-clock/load-timecard-modal-pool";
import type { EnrichedPunchRow } from "@/lib/time-clock/types";
import { getRbacContext, hasPermission } from "@/lib/rbac/context";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type FetchTimecardModalPoolResult =
  | { ok: true; rows: EnrichedPunchRow[] }
  | { ok: false; error: string };

export async function fetchTimecardModalPool(params: {
  timeClockId: string;
  locationId: string;
}): Promise<FetchTimecardModalPoolResult> {
  const timeClockId = params.timeClockId?.trim();
  const locationId = params.locationId?.trim();
  if (!timeClockId || !locationId) {
    return { ok: false, error: "Missing time clock or location." };
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const rbac = await getRbacContext(supabase, user);
  if (rbac.enabled && !hasPermission(rbac, PERMISSIONS.TIME_CLOCK_VIEW)) {
    return { ok: false, error: "You do not have permission to view timesheets." };
  }

  let viewerEmployeeId: string | null = null;
  const canSeeTeam =
    !rbac.enabled || hasPermission(rbac, PERMISSIONS.TIME_CLOCK_MANAGE);
  if (!canSeeTeam && user?.email) {
    const { data: viewerEmp } = await supabase
      .from("employees")
      .select("id")
      .ilike("email", user.email.trim())
      .eq("status", "active")
      .maybeSingle();
    viewerEmployeeId = (viewerEmp as { id?: string } | null)?.id ?? null;
  }

  try {
    const rows = await loadTimecardModalPool(supabase, {
      timeClockId,
      locationId,
      viewerEmployeeId,
    });
    return { ok: true, rows };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Could not load timecard history.",
    };
  }
}
