"use server";

import { loadTimesheetPeriodSlice } from "@/lib/time-clock/load-timesheet-period-slice";
import { attachPtoLabels } from "@/lib/time-clock/time-off-display";
import type { TimesheetPeriodConfig, TimesheetPeriodKind } from "@/lib/time-clock/timesheet-period";
import { getRbacContext, hasPermission } from "@/lib/rbac/context";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type FetchTimesheetPeriodResult =
  | { ok: true; slice: Awaited<ReturnType<typeof loadTimesheetPeriodSlice>> }
  | { ok: false; error: string };

export async function fetchTimesheetPeriod(params: {
  timeClockId: string;
  locationId: string;
  periodKind: TimesheetPeriodKind;
  periodConfig: TimesheetPeriodConfig;
  anchorYmd?: string | null;
  rangeFromYmd?: string | null;
  rangeToYmd?: string | null;
}): Promise<FetchTimesheetPeriodResult> {
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
    const slice = await loadTimesheetPeriodSlice(supabase, {
      timeClockId,
      locationId,
      periodKind: params.periodKind,
      periodConfig: params.periodConfig,
      anchorYmd: params.anchorYmd,
      rangeFromYmd: params.rangeFromYmd,
      rangeToYmd: params.rangeToYmd,
      viewerEmployeeId,
    });

    const { data: torRaw } = await supabase
      .from("time_off_records")
      .select("id, employee_id, time_off_type, start_at, end_at")
      .eq("location_id", locationId)
      .eq("status", "approved")
      .lt("start_at", slice.periodEndExclusiveIso)
      .gt("end_at", slice.periodStartIso);

    const timeOffRecords = (torRaw ?? []) as {
      id: string;
      employee_id: string;
      time_off_type: string;
      start_at: string;
      end_at: string;
    }[];

    const rows =
      timeOffRecords.length > 0
        ? attachPtoLabels(slice.rows, timeOffRecords, "day")
        : slice.rows;

    return { ok: true, slice: { ...slice, rows } };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Could not load this pay period.",
    };
  }
}
