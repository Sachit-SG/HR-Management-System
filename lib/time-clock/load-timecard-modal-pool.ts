/**
 * 90-day punch pool for the employee timecard modal — loaded on demand, not on
 * initial Timesheets page paint.
 */
import { attachBreakRollups, enrichPunchRows } from "@/lib/time-clock/enrich-punches";
import { loadBreaksByEntryIds } from "@/lib/time-clock/load-entry-breaks";
import { attachPtoLabels, type TimeOffRecordForUi } from "@/lib/time-clock/time-off-display";
import type { EnrichedPunchRow } from "@/lib/time-clock/types";
import type { SupabaseClient } from "@supabase/supabase-js";

const TIME_ENTRY_SELECT =
  "id, employee_id, clock_in_at, clock_out_at, status, archived_at, approved_at, punch_source, job_code, job_code_id, location_code_id, job_codes(label), location_codes(label), edited_at, edit_reason";

export async function loadTimecardModalPool(
  supabase: SupabaseClient,
  params: {
    timeClockId: string;
    locationId: string;
    /** When set, only return this employee's rows (self-serve). */
    viewerEmployeeId?: string | null;
  },
): Promise<EnrichedPunchRow[]> {
  const poolSince = new Date();
  poolSince.setDate(poolSince.getDate() - 90);

  const [{ data: empRows }, { data: poolRaw }, { data: shiftsWindow }] = await Promise.all([
    supabase
      .from("employees")
      .select("id, full_name, role")
      .eq("location_id", params.locationId)
      .eq("status", "active"),
    supabase
      .from("time_entries")
      .select(TIME_ENTRY_SELECT)
      .eq("time_clock_id", params.timeClockId)
      .is("archived_at", null)
      .gte("clock_in_at", poolSince.toISOString())
      .order("clock_in_at", { ascending: false })
      .limit(1200),
    supabase
      .from("shifts")
      .select("employee_id, shift_start, shift_end, notes")
      .eq("location_id", params.locationId)
      .gte("shift_start", poolSince.toISOString()),
  ]);

  const nameById = new Map(
    (empRows ?? []).map((e) => [e.id, (e as { full_name: string | null }).full_name ?? "Employee"] as const),
  );
  const roleById = new Map(
    (empRows ?? []).map((e) => [e.id, (e as { role: string | null }).role ?? ""] as const),
  );
  const shiftsList = (shiftsWindow ?? []) as {
    employee_id: string;
    shift_start: string;
    shift_end: string;
    notes: string | null;
  }[];

  let rows =
    poolRaw && poolRaw.length > 0 ? enrichPunchRows(poolRaw, nameById, roleById, shiftsList) : [];

  if (params.viewerEmployeeId) {
    rows = rows.filter((r) => r.employeeId === params.viewerEmployeeId);
  }

  if (rows.length === 0) return [];

  const breaksByEntryId = await loadBreaksByEntryIds(
    supabase,
    rows.map((r) => r.id),
  );
  rows = attachBreakRollups(rows, breaksByEntryId, new Date());

  const torStart = new Date(poolSince);
  torStart.setDate(torStart.getDate() - 7);
  const torEnd = new Date();
  torEnd.setDate(torEnd.getDate() + 90);

  const { data: torRaw } = await supabase
    .from("time_off_records")
    .select("id, employee_id, time_off_type, start_at, end_at")
    .eq("location_id", params.locationId)
    .eq("status", "approved")
    .lt("start_at", torEnd.toISOString())
    .gt("end_at", torStart.toISOString());

  const timeOffRecords = (torRaw ?? []) as TimeOffRecordForUi[];
  if (timeOffRecords.length > 0) {
    rows = attachPtoLabels(rows, timeOffRecords, "day");
  }

  return rows;
}
