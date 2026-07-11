/**
 * Fast path for Timesheets period navigation — only period rows, holidays, and lock.
 * (Not the 90-day modal pool or full page shell.)
 */
import { attachBreakRollups, enrichPunchRows } from "@/lib/time-clock/enrich-punches";
import { loadBreaksByEntryIds } from "@/lib/time-clock/load-entry-breaks";
import {
  getPeriodBounds,
  periodBoundsFromDateStrings,
  periodBoundsToQueryIso,
  type PeriodBounds,
  type TimesheetPeriodConfig,
  type TimesheetPeriodKind,
} from "@/lib/time-clock/timesheet-period";
import type { EnrichedPunchRow } from "@/lib/time-clock/types";
import type { SupabaseClient } from "@supabase/supabase-js";

export type TimesheetHolidayRow = {
  holiday_date: string;
  name: string;
  is_paid?: boolean | null;
  paid_hours?: number | null;
};

export type TimesheetPayPeriodLock = {
  id: string;
  status: "open" | "locked";
  startDateYmd: string;
  endDateYmd: string;
  lockedAt: string | null;
  lockedByName: string | null;
} | null;

export type TimesheetPeriodSlice = {
  rows: EnrichedPunchRow[];
  holidays: TimesheetHolidayRow[];
  payPeriodLock: TimesheetPayPeriodLock;
  periodStartIso: string;
  periodEndExclusiveIso: string;
  rangeFromYmd: string | null;
  rangeToYmd: string | null;
  periodKind: TimesheetPeriodKind;
};

function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function parseAnchorYmd(anchorYmd: string | null | undefined): Date {
  if (anchorYmd && /^\d{4}-\d{2}-\d{2}$/.test(anchorYmd)) {
    const [y, mo, d] = anchorYmd.split("-").map(Number);
    return new Date(y, mo - 1, d, 12, 0, 0, 0);
  }
  return new Date();
}

export function resolveTimesheetPeriodBounds(params: {
  periodKind: TimesheetPeriodKind;
  periodConfig: TimesheetPeriodConfig;
  anchorYmd?: string | null;
  rangeFromYmd?: string | null;
  rangeToYmd?: string | null;
}): { bounds: PeriodBounds; rangeFromYmd: string | null; rangeToYmd: string | null } {
  const custom =
    params.rangeFromYmd && params.rangeToYmd
      ? periodBoundsFromDateStrings(params.rangeFromYmd, params.rangeToYmd)
      : null;
  const bounds =
    custom ?? getPeriodBounds(parseAnchorYmd(params.anchorYmd), params.periodKind, params.periodConfig);
  return {
    bounds,
    rangeFromYmd: custom ? params.rangeFromYmd! : null,
    rangeToYmd: custom ? params.rangeToYmd! : null,
  };
}

export async function loadTimesheetPeriodSlice(
  supabase: SupabaseClient,
  params: {
    timeClockId: string;
    locationId: string;
    periodKind: TimesheetPeriodKind;
    periodConfig: TimesheetPeriodConfig;
    anchorYmd?: string | null;
    rangeFromYmd?: string | null;
    rangeToYmd?: string | null;
    /** When set, only return this employee's rows (self-serve). */
    viewerEmployeeId?: string | null;
  },
): Promise<TimesheetPeriodSlice> {
  const { bounds, rangeFromYmd, rangeToYmd } = resolveTimesheetPeriodBounds(params);
  const { gte, lt } = periodBoundsToQueryIso(bounds);

  const [{ data: empRows }, { data: tsRaw }, { data: holidayRows }] = await Promise.all([
    supabase
      .from("employees")
      .select("id, full_name, role")
      .eq("location_id", params.locationId)
      .eq("status", "active"),
    supabase
      .from("time_entries")
      .select(
        "id, employee_id, clock_in_at, clock_out_at, status, archived_at, approved_at, punch_source, job_code, job_code_id, location_code_id, job_codes(label), location_codes(label), edited_at, edit_reason",
      )
      .eq("time_clock_id", params.timeClockId)
      .is("archived_at", null)
      .gte("clock_in_at", gte)
      .lt("clock_in_at", lt)
      .order("clock_in_at", { ascending: false })
      .limit(2500),
    supabase
      .from("company_holidays")
      .select("holiday_date, name, is_paid, paid_hours")
      .gte("holiday_date", ymd(bounds.start))
      .lt("holiday_date", ymd(bounds.endExclusive)),
  ]);

  const nameById = new Map(
    (empRows ?? []).map((e) => [e.id, (e as { full_name: string | null }).full_name ?? "Employee"] as const),
  );
  const roleById = new Map(
    (empRows ?? []).map((e) => [e.id, (e as { role: string | null }).role ?? ""] as const),
  );

  const shiftStart = new Date(bounds.start);
  shiftStart.setDate(shiftStart.getDate() - 14);
  const { data: shiftsWindow } = await supabase
    .from("shifts")
    .select("employee_id, shift_start, shift_end, notes")
    .eq("location_id", params.locationId)
    .gte("shift_start", shiftStart.toISOString())
    .lt("shift_start", bounds.endExclusive.toISOString());

  const shiftsList = (shiftsWindow ?? []) as {
    employee_id: string;
    shift_start: string;
    shift_end: string;
    notes: string | null;
  }[];

  let rows =
    tsRaw && tsRaw.length > 0 ? enrichPunchRows(tsRaw, nameById, roleById, shiftsList) : [];

  if (params.viewerEmployeeId) {
    rows = rows.filter((r) => r.employeeId === params.viewerEmployeeId);
  }

  const entryIds = rows.map((r) => r.id);
  let breaksByEntryId = new Map<string, import("@/lib/time-clock/breaks").TimeEntryBreakRow[]>();
  if (entryIds.length > 0) {
    try {
      breaksByEntryId = await loadBreaksByEntryIds(supabase, entryIds);
    } catch {
      breaksByEntryId = new Map();
    }
  }
  rows = rows.length > 0 ? attachBreakRollups(rows, breaksByEntryId, new Date()) : [];

  const holidays = (holidayRows ?? []) as TimesheetHolidayRow[];

  const visiblePeriodEndInclusive = new Date(bounds.endExclusive);
  visiblePeriodEndInclusive.setDate(visiblePeriodEndInclusive.getDate() - 1);
  const visibleStartYmd = ymd(bounds.start);
  const visibleEndYmd = ymd(visiblePeriodEndInclusive);

  let payPeriodLock: TimesheetPayPeriodLock = null;
  try {
    const { data: lockRow } = await supabase
      .from("pay_periods")
      .select("id, status, locked_at, locked_by, employees:locked_by(full_name, first_name, last_name)")
      .eq("time_clock_id", params.timeClockId)
      .eq("start_date", visibleStartYmd)
      .eq("end_date", visibleEndYmd)
      .maybeSingle();
    if (lockRow) {
      type EmpName = { full_name: string | null; first_name: string | null; last_name: string | null };
      const r = lockRow as {
        id: string;
        status: string;
        locked_at: string | null;
        employees?: EmpName | EmpName[] | null;
      };
      const emp: EmpName | null = Array.isArray(r.employees)
        ? r.employees[0] ?? null
        : r.employees ?? null;
      const fn = emp?.first_name?.trim() ?? "";
      const ln = emp?.last_name?.trim() ?? "";
      const combined = [fn, ln].filter(Boolean).join(" ").trim();
      payPeriodLock = {
        id: r.id,
        status: r.status === "locked" ? "locked" : "open",
        startDateYmd: visibleStartYmd,
        endDateYmd: visibleEndYmd,
        lockedAt: r.locked_at ?? null,
        lockedByName: combined || (emp?.full_name?.trim() ?? null),
      };
    } else {
      payPeriodLock = {
        id: "",
        status: "open",
        startDateYmd: visibleStartYmd,
        endDateYmd: visibleEndYmd,
        lockedAt: null,
        lockedByName: null,
      };
    }
  } catch {
    payPeriodLock = null;
  }

  return {
    rows,
    holidays,
    payPeriodLock,
    periodStartIso: bounds.start.toISOString(),
    periodEndExclusiveIso: bounds.endExclusive.toISOString(),
    rangeFromYmd,
    rangeToYmd,
    periodKind: params.periodKind,
  };
}
