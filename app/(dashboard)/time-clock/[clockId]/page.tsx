import { cookies } from "next/headers";
import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import { TimeClockPanel } from "@/components/time-clock/time-clock-panel";
import { TimeClockDetailShell } from "@/components/time-clock/time-clock-detail-shell";
import { TimeClockSettingsForm } from "@/components/time-clock/time-clock-settings-form";
import { TimeClockTodayShell } from "@/components/time-clock/time-clock-today-shell";
import { locationsForSession } from "@/lib/dashboard/locations-for-session";
import { isAllLocations, resolveSelectedLocationId, type LocationRow } from "@/lib/dashboard/resolve-location";
import {
  attachBreakRollups,
  enrichPunchRows,
} from "@/lib/time-clock/enrich-punches";
import { getLocalDayBounds } from "@/lib/time-clock/punch-display";
import {
  getPeriodBounds,
  normalizePeriodConfig,
  parsePeriodKind,
  periodBoundsFromDateStrings,
  periodBoundsToQueryIso,
  type TimesheetPeriodKind,
} from "@/lib/time-clock/timesheet-period";
import type { EnrichedPunchRow, TimeClockTodayMetrics } from "@/lib/time-clock/types";
import { DEMO_LOCATIONS } from "@/lib/mock/dashboard-demo";
import { TimeSheetsPanel } from "@/components/time-clock/time-sheets-panel";
import { getChainPayrollDefaults, type ChainPayrollDefault } from "@/app/actions/chain-payroll-defaults";
import { isEmployeePortalUser } from "@/lib/rbac/employee-portal";
import { getRbacContext, hasPermission } from "@/lib/rbac/context";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { takeLatestPunchPerEmployee } from "@/lib/time-clock/dedupe-punches";
import type { TimeEntryBreakRow } from "@/lib/time-clock/breaks";
import { loadBreaksByEntryIds } from "@/lib/time-clock/load-entry-breaks";
import { loadTimeClockRowForDetailPage } from "@/lib/time-clock/load-time-clock-row";
import { loadTimeClockTodayData } from "@/lib/time-clock/load-time-clock-today";
import { getActivePayrollPolicy } from "@/lib/payroll/policy";
import { DEFAULT_PAYROLL_POLICY } from "@/lib/payroll/payable-hours";
import {
  attachPtoLabels,
  type TimeOffRecordForUi,
} from "@/lib/time-clock/time-off-display";
import type { PendingTimeOffRequestRow } from "@/lib/time-clock/pending-time-off";

type PageProps = {
  params: Promise<{ clockId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const TIME_ENTRY_SELECT =
  "id, employee_id, clock_in_at, clock_out_at, status, archived_at, approved_at, punch_source, job_code, job_code_id, location_code_id, job_codes(label), location_codes(label), edited_at, edit_reason";

export default async function TimeClockDetailPage({ params, searchParams }: PageProps) {
  const { clockId } = await params;
  const sp = await searchParams;
  const viewParam = typeof sp.view === "string" ? sp.view : undefined;
  const wantsTimesheets = viewParam === "timesheets";
  const wantsSettings = viewParam === "settings";
  const wantsToday = !wantsTimesheets && !wantsSettings;

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const rbac = await getRbacContext(supabase, user);
  if (rbac.enabled) {
    if (!user) redirect("/login");
    if (!hasPermission(rbac, PERMISSIONS.TIME_CLOCK_VIEW)) redirect("/forbidden");
  }
  if (isEmployeePortalUser(rbac)) {
    redirect("/");
  }
  const canArchiveTimeEntries =
    !rbac.enabled || hasPermission(rbac, PERMISSIONS.TIME_CLOCK_MANAGE);
  /** Track B: owner-only lock controls. */
  const canLockPayPeriods = !rbac.enabled || hasPermission(rbac, PERMISSIONS.ORG_OWNER);
  /** Region (chain) payroll defaults are Owner-edited only. */
  const canEditChainPayrollDefaults =
    !rbac.enabled || hasPermission(rbac, PERMISSIONS.ORG_OWNER);
  // Smart group assignments are not shown in Settings (for now).

  const cookieStore = await cookies();

  const [{ data: locRows }, { clock, error: clockErr }] = await Promise.all([
    supabase
      .from("locations")
      .select("id, name")
      .neq("status", "archived")
      .order("sort_order", { ascending: true }),
    loadTimeClockRowForDetailPage(supabase, clockId),
  ]);

  let rawLocations: LocationRow[] = (locRows ?? []).map((r) => ({ id: r.id, name: r.name }));
  if (rawLocations.length === 0) {
    rawLocations = DEMO_LOCATIONS;
  }
  const locations = locationsForSession(rawLocations);
  const locNameById = new Map((locRows ?? []).map((l) => [l.id, l.name] as const));

  const locationId = resolveSelectedLocationId(
    locations,
    cookieStore.get("hr_location_id")?.value,
  );
  const scopeAll = isAllLocations(locationId);

  if (!clock) {
    if (clockErr) {
      return (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-sm text-red-900">
          <p className="font-semibold">Could not load this time clock</p>
          <p className="mt-2 whitespace-pre-wrap">{clockErr.message}</p>
          <p className="mt-3 text-xs text-red-800/90">
            Common cause: your database setup is out of date (missing newer Time Clock fields). Ask an admin to
            update the database, then refresh.
          </p>
        </div>
      );
    }
    notFound();
  }

  const tc = clock as Record<string, unknown>;

  if (!scopeAll && tc.location_id !== locationId) {
    redirect("/time-clock");
  }

  const effectiveLocationId = scopeAll ? (tc.location_id as string) : locationId;
  const locationName = scopeAll
    ? locNameById.get(tc.location_id as string) ?? "Location"
    : locations.find((l) => l.id === locationId)?.name ?? "Location";

  const isArchived = tc.status === "archived";

  const defaultKind = (tc.timesheet_period_kind as TimesheetPeriodKind) ?? "weekly";
  const defaultConfig = normalizePeriodConfig(
    tc.timesheet_period_config as unknown,
    defaultKind,
  );

  // Region payroll defaults — Settings tab only (avoid an extra server round-trip on Today/Timesheets).
  let chainPayrollDefaults: ChainPayrollDefault[] = [];
  if (wantsSettings) {
    const chainPayrollDefaultsRes = await getChainPayrollDefaults();
    chainPayrollDefaults = chainPayrollDefaultsRes.ok ? chainPayrollDefaultsRes.defaults : [];
  }

  const locationTrackingMode =
    (tc.location_tracking_mode as string | null | undefined) ?? "off";
  const requireLocationForPunch = Boolean(
    tc.require_location_for_punch as boolean | null | undefined,
  );
  const categorizationMode =
    (tc.categorization_mode as string | null | undefined) ?? "none";
  const requireCategorization = Boolean(
    tc.require_categorization as boolean | null | undefined,
  );

  const initialLocationTrackingMode =
    locationTrackingMode === "off" ||
    locationTrackingMode === "clock_in_out" ||
    locationTrackingMode === "breadcrumbs"
      ? locationTrackingMode
      : "off";
  const initialCategorizationMode =
    categorizationMode === "none" || categorizationMode === "job" || categorizationMode === "location"
      ? categorizationMode
      : "none";
  const breaksEnabled = Boolean((tc.breaks_enabled as boolean | null | undefined) ?? true);
  const allowPaidBreaks = Boolean((tc.allow_paid_breaks as boolean | null | undefined) ?? true);
  const breaksModeRaw = String((tc.breaks_mode as unknown) ?? "manual");
  const breaksMode =
    breaksModeRaw === "disabled" || breaksModeRaw === "manual" || breaksModeRaw === "automatic"
      ? breaksModeRaw
      : "manual";
  const breaksManualRules = (tc.breaks_manual_rules as unknown) ?? [];
  const breaksAutoRules = (tc.breaks_auto_rules as unknown) ?? [];

  const workDays = (tc.work_days as number[] | null | undefined)?.filter(
    (d) => Number.isInteger(d) && d >= 0 && d <= 6,
  ) ?? [1, 2, 3, 4, 5];
  const workHoursStart = String((tc.work_hours_start as unknown) ?? "09:00");
  const workHoursEnd = String((tc.work_hours_end as unknown) ?? "17:00");
  const dailyLimitEnabled = Boolean((tc.daily_limit_enabled as boolean | null | undefined) ?? false);
  const dailyLimitHours = Number((tc.daily_limit_hours as unknown) ?? 12);
  const autoClockOutEnabled = Boolean(
    (tc.auto_clock_out_enabled as boolean | null | undefined) ?? false,
  );
  const autoClockOutAfterHours = Number((tc.auto_clock_out_after_hours as unknown) ?? 16);
  const allowManagerEdits = Boolean((tc.allow_manager_edits as boolean | null | undefined) ?? true);

  // Code lists (Option A: shared company-wide). Needed for Today (self-serve) + Settings.
  let jobCodes: { id: string; label: string; colorToken?: string }[] = [];
  let locationCodes: { id: string; label: string; colorToken?: string }[] = [];
  if (wantsToday || wantsSettings) {
    const [{ data: jobCodesRaw }, { data: locationCodesRaw }] = await Promise.all([
      supabase
        .from("job_codes")
        .select("id, label, color_token, sort_order")
        .eq("active", true)
        .order("sort_order", { ascending: true })
        .order("label", { ascending: true }),
      supabase
        .from("location_codes")
        .select("id, label, color_token, sort_order")
        .eq("active", true)
        .order("sort_order", { ascending: true })
        .order("label", { ascending: true }),
    ]);

    jobCodes = (jobCodesRaw ?? []).map((r) => ({
      id: (r as { id: string }).id,
      label: (r as { label: string }).label,
      colorToken: (r as { color_token?: string | null }).color_token ?? "slate",
    }));
    locationCodes = (locationCodesRaw ?? []).map((r) => ({
      id: (r as { id: string }).id,
      label: (r as { label: string }).label,
      colorToken: (r as { color_token?: string | null }).color_token ?? "slate",
    }));
  }

  // Smart group assignments were removed from the Time Clock Settings page.
  // (Keeps the settings screen focused and reduces heavy queries on page load.)

  // Bulk apply targets only matter in Settings → Payroll.
  let clocksForBulkApply: { id: string; label: string }[] = [];
  if (wantsSettings) {
    try {
      const { data: clockRows } = await supabase
        .from("time_clocks")
        .select("id, name, location_id, locations(name)")
        .eq("status", "active")
        .order("sort_order", { ascending: true });
      clocksForBulkApply = (clockRows ?? [])
        .map((r) => {
          const locNested =
            (r as { locations?: { name?: string } | { name?: string }[] | null }).locations ?? null;
          const storeName = Array.isArray(locNested) ? locNested[0]?.name : locNested?.name;
          const clockName = (r as { name?: string }).name ?? "Clock";
          const label = storeName ? `${storeName} — ${clockName}` : clockName;
          return { id: (r as { id: string }).id, label };
        })
        .filter((c) => c.id !== clockId);
    } catch {
      clocksForBulkApply = [];
    }
  }

  const periodParam = typeof sp.period === "string" ? sp.period : undefined;
  const anchorParam = typeof sp.anchor === "string" ? sp.anchor : undefined;
  const rangeFromParam = typeof sp.range_from === "string" ? sp.range_from : undefined;
  const rangeToParam = typeof sp.range_to === "string" ? sp.range_to : undefined;
  const effectiveKind = parsePeriodKind(periodParam) ?? defaultKind;
  const effectiveConfig = normalizePeriodConfig(tc.timesheet_period_config as unknown, effectiveKind);

  // Only needed for Timesheets view.
  const customBoundsFromUrl =
    wantsTimesheets && rangeFromParam && rangeToParam
      ? periodBoundsFromDateStrings(rangeFromParam, rangeToParam)
      : null;

  let anchor = new Date();
  if (wantsTimesheets && anchorParam && !customBoundsFromUrl) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(anchorParam)) {
      const [y, mo, d] = anchorParam.split("-").map(Number);
      anchor = new Date(y, mo - 1, d, 12, 0, 0, 0);
    } else {
      const t = Date.parse(anchorParam);
      if (!Number.isNaN(t)) anchor = new Date(t);
    }
  }

  const periodBounds = wantsTimesheets
    ? customBoundsFromUrl ?? getPeriodBounds(anchor, effectiveKind, effectiveConfig)
    : null;
  const periodQuery = periodBounds ? periodBoundsToQueryIso(periodBounds) : null;
  const periodGte = periodQuery?.gte ?? "";
  const periodLt = periodQuery?.lt ?? "";

  const ymd = (d: Date) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  };

  let holidays: { holiday_date: string; name: string; is_paid?: boolean | null; paid_hours?: number | null }[] =
    [];
  /** Track B: lock state for the visible pay period (null when no row exists, or feature off pre-migration). */
  let visiblePayPeriodLock: {
    id: string;
    status: "open" | "locked";
    startDateYmd: string;
    endDateYmd: string;
    lockedAt: string | null;
    lockedByName: string | null;
  } | null = null;

  let empRows: {
    id: string;
    full_name: string | null;
    role: string | null;
    hourly_rate: number | string | null;
  }[] = [];
  let empErr: { message: string } | null = null;
  let payrollPolicy = DEFAULT_PAYROLL_POLICY;
  let shiftsList: { employee_id: string; shift_start: string; shift_end: string; notes: string | null }[] =
    [];
  let employeeTimecardPool: EnrichedPunchRow[] = [];
  let timesheetRows: EnrichedPunchRow[] = [];

  const since90 = new Date();
  since90.setDate(since90.getDate() - 90);
  const { start: dayStart, end: dayEnd } = getLocalDayBounds();

  if (wantsTimesheets && periodBounds) {
    const timesheetPoolSince = new Date();
    timesheetPoolSince.setDate(timesheetPoolSince.getDate() - 90);
    const visiblePeriodEndInclusive = new Date(periodBounds.endExclusive);
    visiblePeriodEndInclusive.setDate(visiblePeriodEndInclusive.getDate() - 1);
    const visibleStartYmd = ymd(periodBounds.start);
    const visibleEndYmd = ymd(visiblePeriodEndInclusive);

    try {
      const [
        empResult,
        shiftsResult,
        policyResult,
        holidayResult,
        lockResult,
        poolResult,
        tsResult,
      ] = await Promise.all([
        supabase
          .from("employees")
          .select("id, full_name, role, hourly_rate")
          .eq("location_id", effectiveLocationId)
          .eq("status", "active")
          .order("full_name", { ascending: true }),
        supabase
          .from("shifts")
          .select("employee_id, shift_start, shift_end, notes")
          .eq("location_id", effectiveLocationId)
          .gte("shift_start", since90.toISOString()),
        getActivePayrollPolicy(supabase, effectiveLocationId),
        supabase
          .from("company_holidays")
          .select("holiday_date, name, is_paid, paid_hours")
          .gte("holiday_date", ymd(periodBounds.start))
          .lt("holiday_date", ymd(periodBounds.endExclusive)),
        supabase
          .from("pay_periods")
          .select("id, status, locked_at, locked_by, employees:locked_by(full_name, first_name, last_name)")
          .eq("time_clock_id", clockId)
          .eq("start_date", visibleStartYmd)
          .eq("end_date", visibleEndYmd)
          .maybeSingle(),
        supabase
          .from("time_entries")
          .select(TIME_ENTRY_SELECT)
          .eq("time_clock_id", clockId)
          .is("archived_at", null)
          .gte("clock_in_at", timesheetPoolSince.toISOString())
          .order("clock_in_at", { ascending: false })
          .limit(1200),
        supabase
          .from("time_entries")
          .select(TIME_ENTRY_SELECT)
          .eq("time_clock_id", clockId)
          .is("archived_at", null)
          .gte("clock_in_at", periodGte)
          .lt("clock_in_at", periodLt)
          .order("clock_in_at", { ascending: false })
          .limit(2500),
      ]);

      empRows = (empResult.data ?? []) as typeof empRows;
      empErr = empResult.error ? { message: empResult.error.message } : null;
      shiftsList = (shiftsResult.data ?? []) as typeof shiftsList;
      payrollPolicy = policyResult.policy;
      holidays = (holidayResult.data ?? []) as typeof holidays;

      const lockRow = lockResult.data;
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
        const lockedByName = combined || (emp?.full_name?.trim() ?? null);
        visiblePayPeriodLock = {
          id: r.id,
          status: r.status === "locked" ? "locked" : "open",
          startDateYmd: visibleStartYmd,
          endDateYmd: visibleEndYmd,
          lockedAt: r.locked_at ?? null,
          lockedByName,
        };
      } else {
        visiblePayPeriodLock = {
          id: "",
          status: "open",
          startDateYmd: visibleStartYmd,
          endDateYmd: visibleEndYmd,
          lockedAt: null,
          lockedByName: null,
        };
      }

      const nameByIdEarly = new Map(
        empRows.map((e) => [e.id, e.full_name ?? "Employee"] as const),
      );
      const roleByIdEarly = new Map(empRows.map((e) => [e.id, e.role ?? ""] as const));
      const poolRaw = poolResult.data;
      const tsRaw = tsResult.data;
      employeeTimecardPool =
        poolRaw && poolRaw.length > 0
          ? enrichPunchRows(poolRaw, nameByIdEarly, roleByIdEarly, shiftsList)
          : [];
      timesheetRows =
        tsRaw && tsRaw.length > 0
          ? enrichPunchRows(tsRaw, nameByIdEarly, roleByIdEarly, shiftsList)
          : [];
    } catch {
      payrollPolicy = DEFAULT_PAYROLL_POLICY;
      holidays = [];
      visiblePayPeriodLock = null;
    }
  } else if (wantsToday) {
    const [empResult, shiftsResult] = await Promise.all([
      supabase
        .from("employees")
        .select("id, full_name, role, hourly_rate")
        .eq("location_id", effectiveLocationId)
        .eq("status", "active")
        .order("full_name", { ascending: true }),
      supabase
        .from("shifts")
        .select("employee_id, shift_start, shift_end, notes")
        .eq("location_id", effectiveLocationId)
        .gte("shift_start", dayStart.toISOString())
        .lt("shift_start", dayEnd.toISOString()),
    ]);
    empRows = (empResult.data ?? []) as typeof empRows;
    empErr = empResult.error ? { message: empResult.error.message } : null;
    shiftsList = (shiftsResult.data ?? []) as typeof shiftsList;
  }

  const nameById = new Map(empRows.map((e) => [e.id, e.full_name ?? "Employee"] as const));
  const roleById = new Map(empRows.map((e) => [e.id, e.role ?? ""] as const));
  /** `numeric` columns come back as strings from PostgREST — coerce once. */
  const hourlyRatesByEmployee: Record<string, number | null> = {};
  for (const e of empRows) {
    const raw = e.hourly_rate;
    const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;
    hourlyRatesByEmployee[e.id] = Number.isFinite(n) && n >= 0 ? n : null;
  }
  const storeEmployees = empRows.map((e) => ({
    id: e.id,
    fullName: e.full_name?.trim() || "Employee",
    role: e.role ?? "",
  }));

  let entries: EnrichedPunchRow[] = [];
  let clockedInNowRows: EnrichedPunchRow[] = [];
  let entriesError: string | null = empErr?.message ?? null;
  let todayMetrics: TimeClockTodayMetrics | null = null;

  if (wantsToday) {
    try {
      const res = await loadTimeClockTodayData(supabase, {
        timeClockId: clockId,
        locationId: effectiveLocationId,
        nameById,
        roleById,
        storeEmployees: storeEmployees.map((e) => ({
          id: e.id,
          fullName: e.fullName,
          role: e.role ?? "",
        })),
        shiftsList,
      });
      entries = res.latestPerEmployeeRows;
      clockedInNowRows = res.clockedInNowRows;
      todayMetrics = res.todayMetrics;
    } catch (e) {
      entriesError =
        e instanceof Error
          ? e.message
          : "Could not load time entries. If this persists, ask your admin to confirm the database is set up.";
    }
  }

  const breakScopeIds = new Set<string>();
  for (const r of entries) breakScopeIds.add(r.id);
  for (const r of clockedInNowRows) breakScopeIds.add(r.id);
  for (const r of employeeTimecardPool) breakScopeIds.add(r.id);
  for (const r of timesheetRows) breakScopeIds.add(r.id);

  /**
   * Load approved time off that could affect any punch we show.
   * Do NOT bound the upper range with "now" or the current pay period only: `start_at < winEnd`
   * would drop all future-dated PTO (e.g. next week), so the query returned [] and PTO never appeared.
   */
  const fetchRangeStart = new Date(
    Math.min(since90.getTime(), (periodBounds?.start.getTime() ?? dayStart.getTime())) - 30 * 86400000,
  );
  const fetchRangeEnd = new Date(
    Math.max((periodBounds?.endExclusive.getTime() ?? dayEnd.getTime()), Date.now()) + 800 * 86400000,
  );

  const userEmail = user?.email?.trim();
  const needsViewerProfile = Boolean(userEmail) && (wantsToday || !canArchiveTimeEntries);

  const tailDataPromise = Promise.all([
    supabase
      .from("time_off_records")
      .select("id, employee_id, time_off_type, start_at, end_at")
      .eq("location_id", effectiveLocationId)
      .eq("status", "approved")
      .lt("start_at", fetchRangeEnd.toISOString())
      .gt("end_at", fetchRangeStart.toISOString()),
    canArchiveTimeEntries
      ? supabase
          .from("time_off_records")
          .select("id, employee_id, time_off_type, start_at, end_at, created_at, employee_notes")
          .eq("location_id", effectiveLocationId)
          .eq("status", "pending")
          .order("created_at", { ascending: false })
          .limit(40)
      : Promise.resolve({ data: [] as unknown[], error: null }),
    wantsToday
      ? supabase
          .from("locations")
          .select("geofence_center_lat, geofence_center_lng, geofence_radius_meters")
          .eq("id", effectiveLocationId)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    needsViewerProfile
      ? supabase
          .from("employees")
          .select("id, location_id, full_name")
          .ilike("email", userEmail!)
          .eq("status", "active")
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);

  let breaksByEntryId = new Map<string, TimeEntryBreakRow[]>();
  try {
    breaksByEntryId = await loadBreaksByEntryIds(supabase, [...breakScopeIds]);
  } catch {
    breaksByEntryId = new Map();
  }

  const [torResult, pendingResult, geoResult, viewerResult] = await tailDataPromise;

  let timeOffRecords: TimeOffRecordForUi[] = [];
  if (torResult.error) {
    console.error("[time_off_records]", torResult.error.message);
  } else if (torResult.data && Array.isArray(torResult.data)) {
    timeOffRecords = torResult.data as TimeOffRecordForUi[];
  }

  const asOf = new Date();
  entries = attachBreakRollups(entries, breaksByEntryId, asOf);
  clockedInNowRows = attachBreakRollups(clockedInNowRows, breaksByEntryId, asOf);
  employeeTimecardPool =
    employeeTimecardPool.length > 0
      ? attachBreakRollups(employeeTimecardPool, breaksByEntryId, asOf)
      : [];
  timesheetRows =
    timesheetRows.length > 0 ? attachBreakRollups(timesheetRows, breaksByEntryId, asOf) : [];

  if (timeOffRecords.length > 0) {
    // Today tab: one row per employee — show PTO in the same Mon–Sun week as the punch (not only that calendar day).
    entries = attachPtoLabels(entries, timeOffRecords, "week");
    clockedInNowRows = attachPtoLabels(clockedInNowRows, timeOffRecords, "week");
    employeeTimecardPool = attachPtoLabels(employeeTimecardPool, timeOffRecords, "day");
    timesheetRows = attachPtoLabels(timesheetRows, timeOffRecords, "day");
  }

  let pendingTimeOffRequests: PendingTimeOffRequestRow[] = [];
  if (pendingResult.error) {
    console.error("[time_off_records pending]", pendingResult.error.message);
  } else if (pendingResult.data) {
    pendingTimeOffRequests = pendingResult.data.map((row) => {
        const pr = row as {
          id: string;
          employee_id: string;
          time_off_type: string;
          start_at: string;
          end_at: string;
          created_at: string;
          employee_notes: string | null;
        };
        return {
          id: pr.id,
          employeeId: pr.employee_id,
          employeeName: nameById.get(pr.employee_id) ?? "Employee",
          timeOffType: pr.time_off_type,
          startAt: pr.start_at,
          endAt: pr.end_at,
          createdAt: pr.created_at,
          employeeNotes: pr.employee_notes,
        };
      });
  }

  /** Phase 1: self-serve punch + geofence hint (Today tab only for open-punch chain). */
  let viewerEmployeeId: string | null = null;
  let viewerEmployeeName: string | null = null;
  let viewerAtLocation = false;
  let viewerOpenEntryId: string | null = null;
  let viewerOpenEntryClockInAt: string | null = null;
  let viewerOpenBreakId: string | null = null;
  let viewerOpenEntryForeignLocationName: string | null = null;
  let viewerHomeLocationId: string | null = null;
  let viewerHomeLocationName: string | null = null;
  let viewerHomeClockId: string | null = null;
  let geofenceActive = false;

  const viewerEmp = viewerResult.data as {
    id: string;
    location_id: string | null;
    full_name?: string | null;
  } | null;
  if (viewerEmp) {
    viewerEmployeeId = viewerEmp.id;
    viewerEmployeeName = (viewerEmp.full_name && String(viewerEmp.full_name).trim()) || null;
    viewerHomeLocationId = viewerEmp.location_id ?? null;
    viewerHomeLocationName = viewerHomeLocationId
      ? (locNameById.get(viewerHomeLocationId) ?? null)
      : null;
    viewerAtLocation = viewerEmp.location_id === effectiveLocationId;
  }

  if (wantsToday && viewerEmp) {
    const ve = viewerEmp;
    if (viewerHomeLocationId) {
      const { data: homeClock } = await supabase
        .from("time_clocks")
        .select("id")
        .eq("location_id", viewerHomeLocationId)
        .eq("status", "active")
        .order("sort_order", { ascending: true })
        .limit(1)
        .maybeSingle();
      viewerHomeClockId = (homeClock as { id?: string } | null)?.id ?? null;
    }
    if (viewerAtLocation) {
      const { data: openRow } = await supabase
        .from("time_entries")
        .select("id, clock_in_at, time_clock_id, location_id")
        .eq("employee_id", ve.id)
        .is("clock_out_at", null)
        .is("archived_at", null)
        .maybeSingle();
      viewerOpenEntryId = (openRow as { id: string } | null)?.id ?? null;
      viewerOpenEntryClockInAt =
        (openRow as { clock_in_at?: string } | null)?.clock_in_at ?? null;
      const openEntryLocationId =
        (openRow as { location_id?: string | null } | null)?.location_id ?? null;
      const openEntryTimeClockId =
        (openRow as { time_clock_id?: string | null } | null)?.time_clock_id ?? null;
      if (viewerOpenEntryId) {
        const isForeign =
          (openEntryLocationId && openEntryLocationId !== effectiveLocationId) ||
          (openEntryTimeClockId && openEntryTimeClockId !== clockId);
        const [{ data: openBreak, error: openBreakErr }, foreignLocRes] = await Promise.all([
          supabase
            .from("time_entry_breaks")
            .select("id")
            .eq("time_entry_id", viewerOpenEntryId)
            .is("ended_at", null)
            .maybeSingle(),
          isForeign && openEntryLocationId
            ? supabase.from("locations").select("name").eq("id", openEntryLocationId).maybeSingle()
            : Promise.resolve({ data: null, error: null }),
        ]);
        if (!openBreakErr && openBreak) {
          viewerOpenBreakId = (openBreak as { id: string }).id;
        }
        if (foreignLocRes.data) {
          viewerOpenEntryForeignLocationName =
            (foreignLocRes.data as { name?: string | null }).name ?? "another store";
        }
      }
    }

    const geoRow = geoResult.data as {
      geofence_center_lat: number | null;
      geofence_center_lng: number | null;
      geofence_radius_meters: number | null;
    } | null;
    geofenceActive =
      Boolean(geoRow) &&
      geoRow!.geofence_center_lat != null &&
      geoRow!.geofence_center_lng != null &&
      geoRow!.geofence_radius_meters != null &&
      (geoRow!.geofence_radius_meters ?? 0) > 0;
  }

  // Self-serve scope: when the viewer can't manage time entries, narrow the
  // Today team list AND the Timesheets grid to their own rows. Managers (Owner
  // / Store Manager with time_clock.manage) keep the full team view. This
  // protects coworker punch data and answers "where's *my* timesheet?".
  if (!canArchiveTimeEntries && viewerEmployeeId) {
    entries = entries.filter((r) => r.employeeId === viewerEmployeeId);
    clockedInNowRows = clockedInNowRows.filter((r) => r.employeeId === viewerEmployeeId);
    timesheetRows = timesheetRows.filter((r) => r.employeeId === viewerEmployeeId);
  }

  return (
    <Suspense
      fallback={
        <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-500">
          Loading…
        </div>
      }
    >
      <TimeClockDetailShell
        clockId={clockId}
        clockName={String(tc.name ?? "Time clock")}
        locationName={locationName}
        todayContent={
          <div className="space-y-4">
            {isArchived ? (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
                This Time Clock is <strong>archived</strong>. New clock-ins are disabled. You can still open
                Timesheets to review past hours. Ask your admin to restore the clock if it should be active
                again.
              </div>
            ) : null}
            {entriesError ? (
              <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
                {entriesError}
              </p>
            ) : null}
            <TimeClockTodayShell
              timeClockId={clockId}
              locationId={effectiveLocationId}
              clockName={String(tc.name ?? "Time clock")}
              geofenceActive={geofenceActive}
              locationTrackingMode={locationTrackingMode}
              requireLocationForPunch={requireLocationForPunch}
              categorizationMode={categorizationMode}
              requireCategorization={requireCategorization}
              jobCodes={jobCodes}
              locationCodes={locationCodes}
              breaksEnabled={breaksEnabled && breaksMode !== "disabled"}
              allowPaidBreaks={allowPaidBreaks}
              clockSelfServeDisabled={isArchived}
              viewerEmployeeId={viewerEmployeeId}
              viewerEmployeeName={viewerEmployeeName}
              viewerAtLocation={viewerAtLocation}
              viewerHomeLocationId={viewerHomeLocationId}
              viewerHomeLocationName={viewerHomeLocationName}
              viewerHomeClockId={viewerHomeClockId}
              viewerOpenEntryId={viewerOpenEntryId}
              viewerOpenEntryClockInAt={viewerOpenEntryClockInAt ?? null}
              viewerOpenBreakId={viewerOpenBreakId ?? null}
              viewerOpenEntryForeignLocationName={viewerOpenEntryForeignLocationName}
              todayMetrics={todayMetrics}
              latestRows={entries}
              employeeTimecardPool={employeeTimecardPool}
              timeOffRecords={timeOffRecords}
              pendingTimeOffRequests={pendingTimeOffRequests}
              canManage={canArchiveTimeEntries}
              storeEmployees={storeEmployees}
            />
          </div>
        }
        timesheetsContent={
          <TimeSheetsPanel
            rows={timesheetRows}
            modalPoolRows={employeeTimecardPool}
            timeOffRecords={timeOffRecords}
            locationId={effectiveLocationId}
            timeClockId={clockId}
            canArchive={canArchiveTimeEntries}
            periodKind={effectiveKind}
            periodConfig={effectiveConfig}
            periodStartIso={(periodBounds?.start ?? new Date()).toISOString()}
            periodEndExclusiveIso={(periodBounds?.endExclusive ?? new Date()).toISOString()}
            rangeFromYmd={customBoundsFromUrl ? rangeFromParam : null}
            rangeToYmd={customBoundsFromUrl ? rangeToParam : null}
            clockDefaultKind={defaultKind}
            storeEmployees={storeEmployees}
            holidays={holidays}
            hourlyRatesByEmployee={hourlyRatesByEmployee}
            canLockPayPeriods={canLockPayPeriods}
            payPeriodLock={visiblePayPeriodLock}
            payrollPolicy={payrollPolicy}
          />
        }
        settingsContent={
          <TimeClockSettingsForm
            key={`${clockId}-${defaultKind}-${JSON.stringify(defaultConfig)}`}
            timeClockId={clockId}
            initialKind={defaultKind}
            initialConfig={defaultConfig}
            canEdit={canArchiveTimeEntries}
            storeLocationId={String(tc.location_id ?? "")}
            clocksForBulkApply={clocksForBulkApply}
            initialLocationTrackingMode={initialLocationTrackingMode}
            initialRequireLocationForPunch={requireLocationForPunch}
            initialCategorizationMode={initialCategorizationMode}
            initialRequireCategorization={requireCategorization}
            jobCodes={jobCodes}
            locationCodes={locationCodes}
            initialBreaksEnabled={breaksEnabled}
            initialAllowPaidBreaks={allowPaidBreaks}
            initialBreaksMode={breaksMode}
            initialBreaksManualRules={breaksManualRules}
            initialBreaksAutoRules={breaksAutoRules}
            initialWorkDays={workDays}
            initialWorkHoursStart={workHoursStart}
            initialWorkHoursEnd={workHoursEnd}
            initialDailyLimitEnabled={dailyLimitEnabled}
            initialDailyLimitHours={Number.isFinite(dailyLimitHours) ? dailyLimitHours : 12}
            initialAutoClockOutEnabled={autoClockOutEnabled}
            initialAutoClockOutAfterHours={
              Number.isFinite(autoClockOutAfterHours) ? autoClockOutAfterHours : 16
            }
            initialAllowManagerEdits={allowManagerEdits}
            chainPayrollDefaults={chainPayrollDefaults}
            canEditChainPayrollDefaults={canEditChainPayrollDefaults}
          />
        }
        canManage={canArchiveTimeEntries}
      />
    </Suspense>
  );
}
