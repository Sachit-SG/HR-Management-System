"use client";

import { useRouter, useSearchParams } from "next/navigation";
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Download,
  Filter,
  Lock,
  LockOpen,
  Search,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { fetchTimesheetPeriod } from "@/app/actions/fetch-timesheet-period";
import { fetchTimecardModalPool } from "@/app/actions/fetch-timecard-modal-pool";
import { approveTimeEntry, unapproveTimeEntry } from "@/app/actions/time-entry-approval";
import { lockPayPeriod, unlockPayPeriod } from "@/app/actions/pay-period-lock";
import { seedSampleTimesheetPunches } from "@/app/actions/seed-time-entries";
import { EmployeeTimecardModal } from "@/components/time-clock/employee-timecard-modal";
import type { StoreEmployeeOption } from "@/components/time-clock/time-off-request-sidebar";
import { formatHoursMinutes, punchMinutes } from "@/lib/time-clock/timecard-rollup";
import {
  buildTimesheetPunchesCsv,
  downloadTimesheetCsv,
} from "@/lib/time-clock/export-timesheet-csv";
import {
  calculatePayableHours,
  DEFAULT_PAYROLL_POLICY,
  formatGrossPayLabel,
  summarizePayableHours,
  type PayableHoursResult,
  type PayrollPolicy,
} from "@/lib/payroll/payable-hours";
import { downloadUnifiedPayrollCsv } from "@/lib/csv/unified-payroll-csv";
import { generateUnifiedPayrollCsv } from "@/app/actions/payroll-export";
import { TimesheetRangePicker } from "@/components/time-clock/timesheet-range-picker";
import {
  enumerateDaysInPeriod,
  formatPeriodRangeLabel,
  shiftCustomRangeYmd,
  shiftPeriodAnchor,
  type TimesheetPeriodConfig,
  type TimesheetPeriodKind,
} from "@/lib/time-clock/timesheet-period";
import {
  rollupTimeOffForEmployeeInRange,
  type TimeOffRecordForUi,
} from "@/lib/time-clock/time-off-display";
import type { EnrichedPunchRow } from "@/lib/time-clock/types";

type Props = {
  /** Rows for the active period (grid). */
  rows: EnrichedPunchRow[];
  /** Wider pool for employee timecard modal (loaded on first open, not initial page paint). */
  modalPoolRows?: EnrichedPunchRow[];
  timeOffRecords?: TimeOffRecordForUi[];
  locationId: string;
  timeClockId: string;
  canArchive: boolean;
  periodKind: TimesheetPeriodKind;
  periodConfig: TimesheetPeriodConfig;
  periodStartIso: string;
  periodEndExclusiveIso: string;
  /** When set, period comes from custom URL range (not Week/Month math). */
  rangeFromYmd?: string | null;
  rangeToYmd?: string | null;
  clockDefaultKind: TimesheetPeriodKind;
  storeEmployees: StoreEmployeeOption[];
  holidays?: { holiday_date: string; name: string; is_paid?: boolean | null; paid_hours?: number | null }[];
  /**
   * Track A — Payable hours rollup. Map of `employee_id -> hourly_rate`. `null`
   * means no wage on file → calculator returns null pay (we no longer
   * substitute a $15 demo rate) and the UI shows an "Hourly rate missing"
   * banner so the manager fills it in on the export.
   */
  hourlyRatesByEmployee?: Record<string, number | null>;
  /** Track B — only Owners see the lock/unlock control. */
  canLockPayPeriods?: boolean;
  /**
   * Track B — current lock row for the visible period, or a synthetic open row
   * when no `pay_periods` row exists yet. `null` when the lookup failed (e.g.
   * pre-migration); the lock control is hidden in that case.
   */
  payPeriodLock?: {
    id: string;
    status: "open" | "locked";
    startDateYmd: string;
    endDateYmd: string;
    lockedAt: string | null;
    lockedByName: string | null;
  } | null;
  /**
   * Track C — active OT policy for this clock's location (resolved server-side
   * via `payroll_policies`: store override → global default). When omitted,
   * the calculator uses the FLSA fallback (40h/wk @ 1.5x).
   */
  payrollPolicy?: PayrollPolicy;
};

function dayKeyLocal(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function periodKindLabel(k: TimesheetPeriodKind): string {
  switch (k) {
    case "weekly":
      return "Week";
    case "bi_weekly":
      return "Bi-week";
    case "monthly":
      return "Month";
    case "semi_monthly":
      return "Semi-month";
    case "custom":
      return "Custom";
    default:
      return k;
  }
}

type EmployeeTimesheetRow = {
  employeeId: string;
  name: string;
  role: string;
  rows: EnrichedPunchRow[];
};

type ActivePeriodState = {
  rows: EnrichedPunchRow[];
  holidays: NonNullable<Props["holidays"]>;
  payPeriodLock: Props["payPeriodLock"];
  periodKind: TimesheetPeriodKind;
  periodStartIso: string;
  periodEndExclusiveIso: string;
  rangeFromYmd: string | null;
  rangeToYmd: string | null;
};

export function TimeSheetsPanel({
  rows: initialRows,
  modalPoolRows: initialModalPoolRows = [],
  timeOffRecords = [],
  locationId,
  timeClockId,
  canArchive,
  periodKind: initialPeriodKind,
  periodConfig,
  periodStartIso: initialPeriodStartIso,
  periodEndExclusiveIso: initialPeriodEndExclusiveIso,
  rangeFromYmd: initialRangeFromYmd = null,
  rangeToYmd: initialRangeToYmd = null,
  clockDefaultKind,
  storeEmployees,
  holidays: initialHolidays = [],
  hourlyRatesByEmployee = {},
  canLockPayPeriods = false,
  payPeriodLock: initialPayPeriodLock = null,
  payrollPolicy = DEFAULT_PAYROLL_POLICY,
}: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [actionPending, startTransition] = useTransition();
  const [periodNavPending, startPeriodNav] = useTransition();
  const periodFetchGen = useRef(0);
  const [periodNavErr, setPeriodNavErr] = useState<string | null>(null);
  const [activePeriod, setActivePeriod] = useState<ActivePeriodState>(() => ({
    rows: initialRows,
    holidays: initialHolidays,
    payPeriodLock: initialPayPeriodLock,
    periodKind: initialPeriodKind,
    periodStartIso: initialPeriodStartIso,
    periodEndExclusiveIso: initialPeriodEndExclusiveIso,
    rangeFromYmd: initialRangeFromYmd,
    rangeToYmd: initialRangeToYmd,
  }));

  const {
    rows,
    holidays,
    payPeriodLock,
    periodKind,
    periodStartIso,
    periodEndExclusiveIso,
    rangeFromYmd,
    rangeToYmd,
  } = activePeriod;

  const serverPeriodKey = `${initialPeriodStartIso}|${initialPeriodEndExclusiveIso}|${initialPeriodKind}|${initialRangeFromYmd ?? ""}|${initialRangeToYmd ?? ""}`;

  useEffect(() => {
    setActivePeriod({
      rows: initialRows,
      holidays: initialHolidays,
      payPeriodLock: initialPayPeriodLock,
      periodKind: initialPeriodKind,
      periodStartIso: initialPeriodStartIso,
      periodEndExclusiveIso: initialPeriodEndExclusiveIso,
      rangeFromYmd: initialRangeFromYmd,
      rangeToYmd: initialRangeToYmd,
    });
    setPeriodNavErr(null);
  }, [serverPeriodKey, initialRows, initialHolidays, initialPayPeriodLock]);

  const [err, setErr] = useState<string | null>(null);
  const [seedPending, setSeedPending] = useState(false);
  const [query, setQuery] = useState("");
  /** Collapsed by default — expanded panel holds position / roster filters. */
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [filterRole, setFilterRole] = useState("");
  const [filterRoster, setFilterRoster] = useState<"all" | "with_hours" | "no_hours">("all");
  const [timecardAnchorRow, setTimecardAnchorRow] = useState<EnrichedPunchRow | null>(null);
  const [timecardEmployeeId, setTimecardEmployeeId] = useState<string | null>(null);
  const [modalPoolRows, setModalPoolRows] = useState<EnrichedPunchRow[]>(initialModalPoolRows);
  const modalPoolLoadedRef = useRef(false);
  const modalPoolFetchGen = useRef(0);
  const [modalPoolLoading, setModalPoolLoading] = useState(false);
  const [modalPoolErr, setModalPoolErr] = useState<string | null>(null);
  /** When an employee closes the auto-opened timecard, don't reopen until the pay period changes. */
  const [dismissedTimecardPeriodKey, setDismissedTimecardPeriodKey] = useState<string | null>(
    null,
  );
  const [approvalErr, setApprovalErr] = useState<string | null>(null);
  const [lockPending, startLockTransition] = useTransition();
  const [lockErr, setLockErr] = useState<string | null>(null);
  const [payrollCsvPending, startPayrollCsvTransition] = useTransition();
  const [payrollCsvErr, setPayrollCsvErr] = useState<string | null>(null);
  const exportMenuRef = useRef<HTMLDetailsElement>(null);

  const isPeriodLocked = payPeriodLock?.status === "locked";

  function closeExportMenu() {
    const el = exportMenuRef.current;
    if (el) el.open = false;
  }

  function onToggleLock() {
    if (!payPeriodLock) return;
    setLockErr(null);
    startLockTransition(async () => {
      const args = {
        timeClockId,
        startDateYmd: payPeriodLock.startDateYmd,
        endDateYmd: payPeriodLock.endDateYmd,
      };
      const r = isPeriodLocked ? await unlockPayPeriod(args) : await lockPayPeriod(args);
      if (!r.ok) {
        setLockErr(r.error);
        return;
      }
      router.refresh();
    });
  }

  /**
   * Track C: download the Gusto-ready unified payroll CSV for the visible
   * period. We POST through a Server Action so RLS, RBAC, and the policy
   * lookup all stay server-side; the client just saves the returned text.
   */
  function onDownloadPayrollCsv() {
    setPayrollCsvErr(null);
    startPayrollCsvTransition(async () => {
      // Use the same local-day YMD as the Track B pay-period lookup so the
      // server-side query targets the same calendar window the user sees.
      const ymdLocal = (d: Date) => {
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, "0");
        const day = String(d.getDate()).padStart(2, "0");
        return `${y}-${m}-${day}`;
      };
      const startYmd =
        payPeriodLock?.startDateYmd ?? ymdLocal(new Date(periodStartIso));
      let endYmd = payPeriodLock?.endDateYmd;
      if (!endYmd) {
        const endInclusive = new Date(periodEndExclusiveIso);
        endInclusive.setDate(endInclusive.getDate() - 1);
        endYmd = ymdLocal(endInclusive);
      }
      const r = await generateUnifiedPayrollCsv({
        timeClockId,
        startDateYmd: startYmd,
        endDateYmd: endYmd,
      });
      if (!r.ok) {
        setPayrollCsvErr(r.error);
        return;
      }
      downloadUnifiedPayrollCsv(r.csv, r.filename);
    });
  }

  const filteredRows = useMemo(() => {
    if (statusFilter === "all") return rows;
    return rows.filter((r) => {
      if (statusFilter === "approved") return r.reviewStatus === "approved";
      if (statusFilter === "pending") return r.reviewStatus === "pending";
      if (statusFilter === "open") return r.reviewStatus === "open";
      return true;
    });
  }, [rows, statusFilter]);

  const bounds = useMemo(
    () => ({
      start: new Date(periodStartIso),
      endExclusive: new Date(periodEndExclusiveIso),
    }),
    [periodStartIso, periodEndExclusiveIso],
  );

  const days = useMemo(() => enumerateDaysInPeriod(bounds), [bounds]);
  const dayKeys = useMemo(() => days.map((d) => dayKeyLocal(d)), [days]);
  const holidayByDayKey = useMemo(() => {
    const map = new Map<string, { name: string; isPaid: boolean; paidHours: number | null }>();
    for (const h of holidays) {
      const key = String(h.holiday_date ?? "").slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) continue;
      map.set(key, {
        name: h.name,
        isPaid: h.is_paid !== false,
        paidHours: typeof h.paid_hours === "number" ? h.paid_hours : null,
      });
    }
    return map;
  }, [holidays]);
  const dayIndexByKey = useMemo(() => {
    const m = new Map<string, number>();
    for (let i = 0; i < dayKeys.length; i++) {
      const k = dayKeys[i];
      if (k) m.set(k, i);
    }
    return m;
  }, [dayKeys]);
  /** Index of today within the visible day grid, or -1 if today isn't in this period. */
  const todayIndex = useMemo(() => {
    const n = new Date();
    const key = `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`;
    return dayIndexByKey.get(key) ?? -1;
  }, [dayIndexByKey]);
  const rangeLabel = useMemo(() => formatPeriodRangeLabel(bounds), [bounds]);

  const periodEndInclusive = useMemo(() => {
    const ex = new Date(periodEndExclusiveIso);
    const d = new Date(ex);
    d.setDate(d.getDate() - 1);
    return d;
  }, [periodEndExclusiveIso]);

  const hasCustomRange = Boolean(rangeFromYmd && rangeToYmd);

  function navigatePeriodPrev() {
    if (rangeFromYmd && rangeToYmd) {
      const n = shiftCustomRangeYmd(rangeFromYmd, rangeToYmd, -1);
      if (n) pushTimesheetsQuery({ rangeFrom: n.from, rangeTo: n.to });
      return;
    }
    const start = new Date(periodStartIso);
    const newStart = shiftPeriodAnchor(start, periodKind, periodConfig, -1);
    pushTimesheetsQuery({ anchor: newStart, clearCustomRange: true });
  }

  function navigatePeriodNext() {
    if (rangeFromYmd && rangeToYmd) {
      const n = shiftCustomRangeYmd(rangeFromYmd, rangeToYmd, 1);
      if (n) pushTimesheetsQuery({ rangeFrom: n.from, rangeTo: n.to });
      return;
    }
    const start = new Date(periodStartIso);
    const newStart = shiftPeriodAnchor(start, periodKind, periodConfig, 1);
    pushTimesheetsQuery({ anchor: newStart, clearCustomRange: true });
  }

  function onApproveEntry(entryId: string) {
    setApprovalErr(null);
    startTransition(async () => {
      const r = await approveTimeEntry(entryId, locationId);
      if (!r.ok) {
        setApprovalErr(r.error);
        return;
      }
      router.refresh();
    });
  }

  function onUnapproveEntry(entryId: string) {
    setApprovalErr(null);
    startTransition(async () => {
      const r = await unapproveTimeEntry(entryId, locationId);
      if (!r.ok) {
        setApprovalErr(r.error);
        return;
      }
      router.refresh();
    });
  }

  function anchorYmd(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  function syncTimesheetsUrl(q: URLSearchParams) {
    const path = `/time-clock/${timeClockId}?${q.toString()}`;
    window.history.replaceState(window.history.state, "", path);
  }

  function pushTimesheetsQuery(updates: {
    period?: TimesheetPeriodKind;
    anchor?: Date;
    rangeFrom?: string | null;
    rangeTo?: string | null;
    clearCustomRange?: boolean;
  }) {
    const gen = ++periodFetchGen.current;
    const nextKind = updates.period ?? periodKind;
    let nextRangeFrom = rangeFromYmd;
    let nextRangeTo = rangeToYmd;

    if (updates.clearCustomRange) {
      nextRangeFrom = null;
      nextRangeTo = null;
    }
    if (updates.rangeFrom !== undefined) nextRangeFrom = updates.rangeFrom;
    if (updates.rangeTo !== undefined) nextRangeTo = updates.rangeTo;

    let nextAnchorYmd: string | null = null;
    if (nextRangeFrom && nextRangeTo) {
      nextAnchorYmd = null;
    } else if (updates.anchor) {
      nextAnchorYmd = anchorYmd(updates.anchor);
    } else if (updates.clearCustomRange) {
      nextAnchorYmd = anchorYmd(updates.anchor ?? new Date());
    } else {
      nextAnchorYmd = anchorYmd(new Date(periodStartIso));
    }

    const q = new URLSearchParams(searchParams.toString());
    q.set("view", "timesheets");
    q.set("period", nextKind);
    if (updates.clearCustomRange || (!nextRangeFrom && !nextRangeTo)) {
      q.delete("range_from");
      q.delete("range_to");
    }
    if (nextRangeFrom) q.set("range_from", nextRangeFrom);
    else q.delete("range_from");
    if (nextRangeTo) q.set("range_to", nextRangeTo);
    else q.delete("range_to");
    if (nextRangeFrom && nextRangeTo) {
      q.delete("anchor");
    } else if (nextAnchorYmd) {
      q.set("anchor", nextAnchorYmd);
    }

    syncTimesheetsUrl(q);

    startPeriodNav(async () => {
      const r = await fetchTimesheetPeriod({
        timeClockId,
        locationId,
        periodKind: nextKind,
        periodConfig,
        anchorYmd: nextAnchorYmd,
        rangeFromYmd: nextRangeFrom,
        rangeToYmd: nextRangeTo,
      });
      if (gen !== periodFetchGen.current) return;
      if (!r.ok) {
        setPeriodNavErr(r.error);
        return;
      }
      setPeriodNavErr(null);
      setActivePeriod({
        rows: r.slice.rows,
        holidays: r.slice.holidays,
        payPeriodLock: r.slice.payPeriodLock,
        periodKind: r.slice.periodKind,
        periodStartIso: r.slice.periodStartIso,
        periodEndExclusiveIso: r.slice.periodEndExclusiveIso,
        rangeFromYmd: r.slice.rangeFromYmd,
        rangeToYmd: r.slice.rangeToYmd,
      });
    });
  }

  const byEmployee = useMemo(() => {
    const map = new Map<
      string,
      { employeeId: string; name: string; role: string; rows: EnrichedPunchRow[] }
    >();
    for (const r of filteredRows) {
      const key = r.employeeId;
      if (!key) continue;
      if (!map.has(key)) {
        map.set(key, {
          employeeId: key,
          name: r.employeeName ?? "Employee",
          role: r.employeeRole ?? "",
          rows: [],
        });
      }
      map.get(key)!.rows.push(r);
    }
    const list = [...map.values()].map((e) => ({
      ...e,
      rows: e.rows.slice().sort((a, b) => a.clockInAt.localeCompare(b.clockInAt)),
    }));
    list.sort((a, b) => a.name.localeCompare(b.name));
    return list;
  }, [filteredRows]);

  const byEmployeeWithAll = useMemo(() => {
    const map = new Map(byEmployee.map((e) => [e.employeeId, e] as const));
    for (const se of storeEmployees) {
      if (!se.id) continue;
      if (map.has(se.id)) continue;
      map.set(se.id, {
        employeeId: se.id,
        name: se.fullName ?? "Employee",
        role: se.role ?? "",
        rows: [],
      });
    }
    const list = [...map.values()];
    list.sort((a, b) => a.name.localeCompare(b.name));
    return list;
  }, [byEmployee, storeEmployees]);

  const roleFilterOptions = useMemo(() => {
    const roles = new Set<string>();
    for (const e of storeEmployees) {
      const role = e.role?.trim();
      if (role) roles.add(role);
    }
    for (const e of byEmployee) {
      const role = e.role?.trim();
      if (role) roles.add(role);
    }
    return [...roles].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  }, [storeEmployees, byEmployee]);

  const expandedFilterCount =
    (filterRole ? 1 : 0) + (filterRoster !== "all" ? 1 : 0);

  const rosterBase = useMemo(() => {
    if (!canArchive) return byEmployee;
    // Status / roster filters should not show the full zero-hour roster scaffold.
    if (statusFilter !== "all" || filterRoster !== "all") return byEmployee;
    return byEmployeeWithAll;
  }, [canArchive, statusFilter, filterRoster, byEmployee, byEmployeeWithAll]);

  const filteredEmployees = useMemo(() => {
    // Managers see the full store roster (including rows with no punches this period)
    // unless a status or roster filter is active.
    // Employees only see people who actually have punches in `rows`.
    let list = rosterBase;
    const q = query.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (e) => e.name.toLowerCase().includes(q) || e.role.toLowerCase().includes(q),
      );
    }
    if (filterRole) {
      list = list.filter((e) => (e.role ?? "").trim() === filterRole);
    }
    if (filterRoster === "with_hours") {
      list = list.filter((e) => e.rows.length > 0);
    } else if (filterRoster === "no_hours") {
      list = list.filter((e) => e.rows.length === 0);
    }
    return list;
  }, [rosterBase, query, filterRole, filterRoster]);

  useEffect(() => {
    if (filterRole && !roleFilterOptions.includes(filterRole)) setFilterRole("");
  }, [filterRole, roleFilterOptions]);

  const timecardPeriodKey = `${periodStartIso}|${periodEndExclusiveIso}|${periodKind}`;

  /** Employees: open the Connecteam-style detail table by default (one row in the grid). */
  const employeeAutoTimecardAnchor = useMemo(() => {
    if (canArchive) return null;
    if (dismissedTimecardPeriodKey === timecardPeriodKey) return null;
    if (filteredEmployees.length !== 1) return null;
    const only = filteredEmployees[0];
    if (only.rows.length === 0) return null;
    return only.rows[only.rows.length - 1] ?? null;
  }, [canArchive, filteredEmployees, timecardPeriodKey, dismissedTimecardPeriodKey]);

  const openEmployeeTimecard = (e: EmployeeTimesheetRow) => {
    setTimecardEmployeeId(e.employeeId);
    setTimecardAnchorRow(e.rows.length > 0 ? (e.rows[e.rows.length - 1] ?? null) : null);
  };

  const activeTimecardEmployee = useMemo((): EmployeeTimesheetRow | null => {
    if (timecardEmployeeId) {
      return filteredEmployees.find((e) => e.employeeId === timecardEmployeeId) ?? null;
    }
    if (timecardAnchorRow) {
      return filteredEmployees.find((e) => e.employeeId === timecardAnchorRow.employeeId) ?? null;
    }
    if (employeeAutoTimecardAnchor) {
      return (
        filteredEmployees.find((e) => e.employeeId === employeeAutoTimecardAnchor.employeeId) ??
        null
      );
    }
    return null;
  }, [
    timecardEmployeeId,
    timecardAnchorRow,
    employeeAutoTimecardAnchor,
    filteredEmployees,
  ]);

  const activeTimecardOpen = activeTimecardEmployee != null;

  useEffect(() => {
    setModalPoolRows(initialModalPoolRows);
    modalPoolLoadedRef.current = initialModalPoolRows.length > 0;
    setModalPoolErr(null);
  }, [serverPeriodKey, initialModalPoolRows]);

  useEffect(() => {
    if (modalPoolLoadedRef.current) return;
    const gen = ++modalPoolFetchGen.current;
    setModalPoolLoading(true);
    setModalPoolErr(null);
    void fetchTimecardModalPool({ timeClockId, locationId }).then((r) => {
      if (gen !== modalPoolFetchGen.current) return;
      setModalPoolLoading(false);
      modalPoolLoadedRef.current = true;
      if (r.ok) {
        setModalPoolRows(r.rows);
      } else {
        setModalPoolErr(r.error);
      }
    });
  }, [timeClockId, locationId, initialModalPoolRows.length, serverPeriodKey]);

  const orderedEmployeeIds = useMemo(
    () => filteredEmployees.map((e) => e.employeeId),
    [filteredEmployees],
  );

  function selectEmployeeInPool(employeeId: string | null) {
    if (!employeeId) return;
    const emp = filteredEmployees.find((e) => e.employeeId === employeeId);
    if (emp) openEmployeeTimecard(emp);
  }

  const timecardRows = useMemo(() => {
    if (!activeTimecardEmployee) return [];
    const id = activeTimecardEmployee.employeeId;
    const fromPool = modalPoolRows.filter((r) => r.employeeId === id);
    if (fromPool.length > 0) return fromPool;
    return rows.filter((r) => r.employeeId === id);
  }, [modalPoolRows, activeTimecardEmployee, rows]);

  const timecardUserNav = useMemo(() => {
    if (!activeTimecardEmployee || orderedEmployeeIds.length === 0) {
      return { idx: -1, prevId: null as string | null, nextId: null as string | null };
    }
    const idx = orderedEmployeeIds.indexOf(activeTimecardEmployee.employeeId);
    return {
      idx,
      prevId: idx > 0 ? orderedEmployeeIds[idx - 1] : null,
      nextId: idx >= 0 && idx < orderedEmployeeIds.length - 1 ? orderedEmployeeIds[idx + 1] : null,
    };
  }, [orderedEmployeeIds, activeTimecardEmployee]);

  const rowsForExport = useMemo(
    () => filteredEmployees.flatMap((e) => e.rows),
    [filteredEmployees],
  );

  function onExportCsv() {
    if (rowsForExport.length === 0) return;
    const csv = buildTimesheetPunchesCsv(rowsForExport, { periodLabel: rangeLabel });
    const safe = rangeLabel.replace(/[^\w\d\-]+/g, "_").slice(0, 48) || "period";
    downloadTimesheetCsv(csv, `timesheet-${safe}.csv`);
  }

  const minutesForEmployeeByDay = useMemo(() => {
    const map = new Map<string, number[]>();
    for (const e of filteredEmployees) {
      const mins = new Array<number>(days.length).fill(0);
      for (const r of e.rows) {
        const dk = dayKeyLocal(new Date(r.clockInAt));
        const di = dayIndexByKey.get(dk);
        if (di === -1) continue;
        if (di == null) continue;
        mins[di] += punchMinutes(r) ?? 0;
      }

      // Automatic paid holiday hours when the store is closed (no logged time).
      for (let di = 0; di < days.length; di++) {
        if (mins[di] > 0) continue;
        const key = dayKeys[di];
        if (!key) continue;
        const h = holidayByDayKey.get(key);
        if (!h || !h.isPaid) continue;
        const hours = h.paidHours ?? 8;
        if (hours > 0) mins[di] += Math.round(hours * 60);
      }

      map.set(e.employeeId, mins);
    }
    return map;
  }, [filteredEmployees, dayIndexByKey, dayKeys, days.length, holidayByDayKey]);

  /**
   * Track A rollup: actual worked minutes (net of unpaid breaks), paid PTO
   * hours overlapping the period, and paid holiday hours auto-credited on
   * "no logged time" days. Keep these three components separate so the gross-
   * pay calculation stays auditable.
   */
  const payableByEmployeeId = useMemo(() => {
    const periodStart = bounds.start;
    const periodEnd = bounds.endExclusive;
    const map = new Map<string, PayableHoursResult>();

    for (const e of filteredEmployees) {
      let workedMinutes = 0;
      for (const r of e.rows) {
        const m = punchMinutes(r);
        if (m != null && m > 0) workedMinutes += m;
      }

      // Holiday auto-credit minutes already merged into minutesForEmployeeByDay.
      // Subtract worked from that to recover the "holiday-only" portion (no double count).
      const dayMins = minutesForEmployeeByDay.get(e.employeeId) ?? [];
      const dayMinsTotal = dayMins.reduce((a, b) => a + b, 0);
      const paidHolidayMinutes = Math.max(0, dayMinsTotal - workedMinutes);
      const paidHolidayHours = paidHolidayMinutes / 60;

      const pto = rollupTimeOffForEmployeeInRange(
        e.employeeId,
        timeOffRecords,
        periodStart,
        periodEnd,
      );
      const approvedPtoHours = pto.paidMinutes / 60;

      const rate = hourlyRatesByEmployee[e.employeeId] ?? null;
      map.set(
        e.employeeId,
        calculatePayableHours({
          workedMinutes,
          approvedPtoHours,
          paidHolidayHours,
          hourlyRate: rate,
          policy: payrollPolicy,
        }),
      );
    }
    return map;
  }, [
    filteredEmployees,
    minutesForEmployeeByDay,
    timeOffRecords,
    hourlyRatesByEmployee,
    bounds,
    payrollPolicy,
  ]);

  const payableSummary = useMemo(
    () => summarizePayableHours([...payableByEmployeeId.values()]),
    [payableByEmployeeId],
  );

  /** True when the period has any worked / payable signal worth showing in the metrics row. */
  const payrollStripHasHours = useMemo(
    () =>
      payableSummary.totalPayableHours > 0.005 ||
      payableSummary.regularHours > 0.005 ||
      payableSummary.overtimeHours > 0.005 ||
      Math.abs(payableSummary.estimatedGrossPay) > 0.005,
    [payableSummary],
  );
  const payrollStripHasDemo = payableSummary.employeesOnFallbackRate > 0;
  /** One org-level demo warning — suppress noisy per-row badges that repeat the same message. */
  const suppressPerRowDemoBadge = canArchive && payrollStripHasDemo;

  const gridTemplate = `260px repeat(${days.length}, minmax(52px, 1fr))`;

  const subtitle =
    clockDefaultKind !== periodKind
      ? `Clock default: ${periodKindLabel(clockDefaultKind)} · View: ${periodKindLabel(periodKind)}`
      : `Period: ${periodKindLabel(periodKind)}`;

  /**
   * Premium header stats — three at-a-glance cards above the timesheet grid.
   * Reuses data already computed for the table; no extra fetch / RBAC surface.
   */
  const isActive = useMemo(() => rows.some((r) => !r.clockOutAt), [rows]);
  const periodTotalMinutes = useMemo(() => {
    let total = 0;
    for (const r of rows) {
      const m = punchMinutes(r);
      if (m != null && m > 0) total += m;
    }
    return total;
  }, [rows]);
  /**
   * Renders 0.0h as "—" so empty periods stay calm. We only show the bold
   * number once there's actually time logged worth displaying.
   */
  const periodTotalHoursLabel = useMemo(() => {
    const h = periodTotalMinutes / 60;
    if (!Number.isFinite(h) || h <= 0) return null;
    return h.toFixed(2);
  }, [periodTotalMinutes]);
  const paydayInfo = useMemo(() => {
    const payday = periodEndInclusive;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const target = new Date(payday);
    target.setHours(0, 0, 0, 0);
    const diffDays = Math.round((target.getTime() - today.getTime()) / 86400000);
    return {
      label: payday.toLocaleDateString(undefined, {
        weekday: "short",
        month: "short",
        day: "numeric",
      }),
      relative:
        diffDays === 0
          ? "Today"
          : diffDays === 1
            ? "Tomorrow"
            : diffDays > 1
              ? `In ${diffDays} days`
              : diffDays === -1
                ? "Yesterday"
                : `${Math.abs(diffDays)} days ago`,
    };
  }, [periodEndInclusive]);

  return (
    <div className="space-y-3">
      {err ? (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">
          {err}
        </p>
      ) : null}
      {approvalErr ? (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">
          {approvalErr}
        </p>
      ) : null}
      {periodNavErr ? (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">
          {periodNavErr}
        </p>
      ) : null}

      {lockErr ? (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">
          {lockErr}
        </p>
      ) : null}

      {payrollCsvErr ? (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">
          {payrollCsvErr}
        </p>
      ) : null}

      {/* Premium SaaS stats — three accent-bordered cards above the grid. */}
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-slate-200 border-t-4 border-t-emerald-500 bg-white p-4 shadow-sm transition-shadow hover:shadow-md">
          <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">
            Current status
          </p>
          <div className="mt-2 flex items-center gap-2.5">
            {isActive ? (
              <span className="relative flex h-2.5 w-2.5" aria-hidden>
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
              </span>
            ) : (
              <span className="h-2.5 w-2.5 rounded-full bg-slate-300" aria-hidden />
            )}
            <span className="text-2xl font-black tracking-tight text-slate-900">
              {isActive ? "Active" : "Off the clock"}
            </span>
          </div>
          <p className="mt-1.5 text-xs font-medium text-slate-500">
            {isActive
              ? canArchive
                ? "Active shifts"
                : "You're on a shift right now"
              : canArchive
                ? "No active shifts"
                : "No open shift on file"}
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 border-t-4 border-t-sky-500 bg-white p-4 shadow-sm transition-shadow hover:shadow-md">
          <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">
            {periodKindLabel(periodKind)} hours
          </p>
          <p className="mt-2 text-2xl font-black tracking-tight tabular-nums text-slate-900">
            {periodTotalHoursLabel == null ? (
              <span className="text-slate-400">—</span>
            ) : (
              <>
                {periodTotalHoursLabel}
                <span className="ml-1 text-base font-medium text-slate-500">h</span>
              </>
            )}
          </p>
          <p className="mt-1.5 text-xs font-medium text-slate-500">
            {canArchive ? "Team worked time this period" : "Your worked time this period"}
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 border-t-4 border-t-orange-500 bg-white p-4 shadow-sm transition-shadow hover:shadow-md">
          <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">
            Period end
          </p>
          <p className="mt-2 text-2xl font-black tracking-tight text-slate-900">{paydayInfo.label}</p>
          <p className="mt-1.5 text-xs font-medium text-slate-500">
            {paydayInfo.relative} · pay period close
          </p>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200/80 bg-white shadow-md">
        <div className="border-b border-slate-100 px-4 py-4 sm:px-5">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 className="text-sm font-semibold text-slate-800">Timesheets</h2>
              <p className="mt-0.5 text-xs text-slate-500">
                {subtitle}. Green pill = worked time that day.{" "}
                <span className="font-medium text-slate-700">
                  Click a name or hours to open the detailed timecard
                  {periodKind === "bi_weekly" ? " (Week 1 & Week 2)" : ""}.
                </span>
              </p>
            </div>
            {isPeriodLocked && payPeriodLock ? (
              <div
                role="status"
                className="inline-flex items-start gap-2 rounded-lg border-2 border-rose-300 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-900 shadow-sm"
              >
                <Lock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                <div className="leading-snug">
                  <span className="block uppercase tracking-wide">Pay period locked</span>
                  <span className="mt-0.5 block font-medium">
                    Time logs in this period are read-only.
                    {payPeriodLock.lockedByName
                      ? ` Locked by ${payPeriodLock.lockedByName}`
                      : " Locked"}
                    {payPeriodLock.lockedAt
                      ? ` on ${new Date(payPeriodLock.lockedAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}.`
                      : "."}
                  </span>
                </div>
              </div>
            ) : null}
          </div>
        </div>

        <div className="flex flex-col gap-3 border-b border-slate-100 px-4 py-3 sm:px-5">
          <div className="flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-center">
            {/*
             * Wide search by design — managers triaging 250+ employees need
             * room to type a full name without truncating it under the icon.
             * `flex-[2_1_320px]` gives the field 2× the grow weight of the
             * sibling controls, so it always claims most of the toolbar's
             * horizontal space on LG and never collapses below 300 px.
             */}
            <div className="relative min-w-[300px] flex-[2_1_320px]">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                type="search"
                placeholder={canArchive ? "Search employees…" : "Search history"}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="w-full rounded-lg border border-slate-200 bg-white py-2.5 pl-10 pr-4 text-sm text-slate-800 placeholder:text-slate-400 focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-400/25"
                aria-label={canArchive ? "Search employees" : "Search"}
              />
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {canArchive ? (
                <button
                  type="button"
                  onClick={() => setFiltersOpen((o) => !o)}
                  className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded border transition-colors ${
                    filtersOpen || expandedFilterCount > 0
                      ? "border-sky-300 bg-sky-50 text-sky-700"
                      : "border-slate-200 bg-white text-sky-600 hover:bg-slate-50"
                  }`}
                  aria-expanded={filtersOpen}
                  aria-label="Toggle employee filters"
                >
                  <Filter className="h-4 w-4" />
                </button>
              ) : null}

              <div className="relative min-w-[10rem] shrink-0">
                <select
                  value={periodKind}
                  onChange={(e) => {
                    const next = e.target.value as TimesheetPeriodKind;
                    pushTimesheetsQuery({
                      period: next,
                      anchor: new Date(),
                      clearCustomRange: true,
                    });
                  }}
                  className="h-10 w-full cursor-pointer appearance-none rounded border border-slate-200 bg-white py-2 pl-4 pr-12 text-sm font-medium text-slate-800 shadow-sm focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-400/25"
                  aria-label="Period type"
                >
                  <option value="weekly">Week</option>
                  <option value="bi_weekly">Bi-week</option>
                  <option value="monthly">Month</option>
                  <option value="semi_monthly">Semi-month</option>
                  <option value="custom">Custom split</option>
                </select>
                <ChevronDown
                  className="pointer-events-none absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500"
                  aria-hidden
                />
              </div>

              <TimesheetRangePicker
                rangeLabel={rangeLabel}
                periodStart={new Date(periodStartIso)}
                periodEndInclusive={periodEndInclusive}
                periodKind={periodKind}
                periodConfig={periodConfig}
                navigating={periodNavPending}
                weekStartsOn={
                  ((typeof periodConfig.week_starts_on === "number"
                    ? periodConfig.week_starts_on
                    : 1) as 0 | 1 | 2 | 3 | 4 | 5 | 6)
                }
                hasCustomRange={hasCustomRange}
                onApplyCustomRange={(fromYmd, toYmd) =>
                  pushTimesheetsQuery({ rangeFrom: fromYmd, rangeTo: toYmd })
                }
                onSelectPresetPeriod={(anchor) =>
                  pushTimesheetsQuery({ anchor, clearCustomRange: true })
                }
                onClearCustomRange={() =>
                  pushTimesheetsQuery({ anchor: new Date(), clearCustomRange: true })
                }
                onNavigatePrev={navigatePeriodPrev}
                onNavigateNext={navigatePeriodNext}
                onJumpToToday={() =>
                  pushTimesheetsQuery({ anchor: new Date(), clearCustomRange: true })
                }
              />

              <div className="relative min-w-[11rem] shrink-0">
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="h-10 w-full cursor-pointer appearance-none rounded border border-slate-200 bg-white py-2 pl-4 pr-12 text-sm font-medium text-slate-700 shadow-sm focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-400/25"
                  aria-label="Status filter"
                >
                  <option value="all">All statuses</option>
                  <option value="open">Open shifts</option>
                  <option value="approved">Approved</option>
                  <option value="pending">Pending review</option>
                </select>
                <ChevronDown
                  className="pointer-events-none absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500"
                  aria-hidden
                />
              </div>

              {canArchive ? (
                <details
                  ref={exportMenuRef}
                  className="group relative shrink-0"
                  onKeyDown={(e) => {
                    if (e.key === "Escape") closeExportMenu();
                  }}
                >
                  <summary className="flex h-10 cursor-pointer list-none items-center gap-2 rounded border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-800 shadow-sm marker:content-none [&::-webkit-details-marker]:hidden hover:bg-slate-50">
                    <Download className="h-4 w-4 shrink-0 text-slate-600" aria-hidden />
                    Export
                    <ChevronDown className="h-4 w-4 shrink-0 text-slate-500 transition-transform group-open:rotate-180" aria-hidden />
                  </summary>
                  <div
                    role="menu"
                    className="absolute right-0 z-40 mt-1 min-w-[14rem] overflow-hidden rounded-lg border border-slate-200 bg-white py-1 shadow-lg"
                  >
                    <button
                      type="button"
                      role="menuitem"
                      disabled={rowsForExport.length === 0}
                      className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm text-slate-800 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                      onClick={() => {
                        closeExportMenu();
                        onExportCsv();
                      }}
                    >
                      <Download className="h-4 w-4 shrink-0 text-slate-500" aria-hidden />
                      <span>
                        <span className="font-semibold">Shift log report</span>
                        <span className="mt-0.5 block text-xs font-normal text-slate-500">
                          CSV · visible grid only
                        </span>
                      </span>
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      disabled={payrollCsvPending}
                      className="flex w-full items-center gap-2 border-t border-slate-100 px-3 py-2.5 text-left text-sm text-emerald-900 hover:bg-emerald-50/80 disabled:cursor-not-allowed disabled:opacity-50"
                      onClick={() => {
                        closeExportMenu();
                        onDownloadPayrollCsv();
                      }}
                    >
                      <Download className="h-4 w-4 shrink-0 text-emerald-600" aria-hidden />
                      <span>
                        <span className="font-semibold">Payroll CSV</span>
                        <span className="mt-0.5 block text-xs font-normal text-emerald-800/80">
                          {payrollCsvPending ? "Building…" : "Gusto-style · pay period"}
                        </span>
                      </span>
                    </button>
                  </div>
                </details>
              ) : (
                <button
                  type="button"
                  disabled={rowsForExport.length === 0}
                  onClick={onExportCsv}
                  className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded border border-slate-200 bg-white px-3 text-sm font-medium text-slate-800 shadow-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                  title="Download your hours for this period as a spreadsheet"
                >
                  <Download className="h-4 w-4 shrink-0" aria-hidden />
                  Download my hours
                </button>
              )}

              {canLockPayPeriods && payPeriodLock ? (
                <button
                  type="button"
                  onClick={onToggleLock}
                  disabled={lockPending}
                  // Ghost-style by default — looks serious, doesn't compete with
                  // Export. Solid red on hover/focus to communicate the
                  // irreversible-feeling commit. Unlock variant uses an amber
                  // ghost so a locked period reads "warning, but you can
                  // recover".
                  className={`inline-flex h-10 shrink-0 items-center gap-1.5 rounded-md border px-3 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                    isPeriodLocked
                      ? "border-amber-300 bg-transparent text-amber-700 hover:border-amber-400 hover:bg-amber-50 hover:text-amber-900"
                      : "border-rose-300 bg-transparent text-rose-700 hover:border-rose-600 hover:bg-rose-600 hover:text-white focus:border-rose-600 focus:bg-rose-600 focus:text-white focus:outline-none focus:ring-2 focus:ring-rose-500/30"
                  }`}
                  title={
                    isPeriodLocked
                      ? "Unlock this pay period — time logs inside will become editable again."
                      : "Lock this pay period — Owner only. Time logs inside become read-only at the database level."
                  }
                >
                  {isPeriodLocked ? (
                    <LockOpen className="h-4 w-4 shrink-0" aria-hidden />
                  ) : (
                    <Lock className="h-4 w-4 shrink-0" aria-hidden />
                  )}
                  {lockPending
                    ? isPeriodLocked
                      ? "Unlocking…"
                      : "Locking…"
                    : isPeriodLocked
                      ? "Unlock pay period"
                      : "Lock pay period"}
                </button>
              ) : null}

              {/*
               * "Add sample data" — seeds 24 fake clock-ins for this/last week
               * so a fresh demo has rows to look at. It's preview-only, so we
               * gate it behind dev mode AND manager permission; production /
               * QA installs never see it.
               */}
              {canArchive && process.env.NODE_ENV === "development" ? (
                <button
                  type="button"
                  disabled={seedPending}
                  className="h-10 shrink-0 rounded bg-emerald-600 px-4 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700 disabled:opacity-50"
                  title="Dev only — insert sample clock-ins for this and last week"
                  onClick={() => {
                    setErr(null);
                    setSeedPending(true);
                    startTransition(async () => {
                      const r = await seedSampleTimesheetPunches(timeClockId, locationId);
                      setSeedPending(false);
                      if (!r.ok) {
                        setErr(r.error);
                        return;
                      }
                      router.refresh();
                    });
                  }}
                >
                  {seedPending ? "…" : "Add sample data"}
                </button>
              ) : null}
            </div>
          </div>

          {canArchive && filtersOpen ? (
            <div className="flex flex-col gap-3 rounded-2xl bg-slate-100/90 px-3 py-3 sm:flex-row sm:flex-wrap sm:items-end">
              <div className="flex min-w-0 flex-1 flex-wrap items-end gap-3">
                <label className="block min-w-[9rem] text-xs font-medium text-slate-600">
                  Position
                  <select
                    value={filterRole}
                    onChange={(e) => setFilterRole(e.target.value)}
                    disabled={roleFilterOptions.length === 0}
                    className="mt-1 h-9 w-full cursor-pointer appearance-none rounded border border-slate-200/90 bg-white py-1.5 pl-3.5 pr-9 text-sm text-slate-800 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400"
                  >
                    <option value="">
                      {roleFilterOptions.length === 0 ? "No positions on file" : "All positions"}
                    </option>
                    {roleFilterOptions.map((role) => (
                      <option key={role} value={role}>
                        {role}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block min-w-[11rem] text-xs font-medium text-slate-600">
                  Time entries
                  <select
                    value={filterRoster}
                    onChange={(e) =>
                      setFilterRoster(e.target.value as typeof filterRoster)
                    }
                    className="mt-1 h-9 w-full cursor-pointer appearance-none rounded border border-slate-200/90 bg-white py-1.5 pl-3.5 pr-9 text-sm text-slate-800"
                  >
                    <option value="all">All employees</option>
                    <option value="with_hours">With time entries</option>
                    <option value="no_hours">Without time entries</option>
                  </select>
                </label>
              </div>
              <div className="flex flex-wrap items-center gap-2 sm:pb-0.5">
                {expandedFilterCount > 0 ? (
                  <button
                    type="button"
                    className="text-xs font-semibold text-sky-700 hover:underline"
                    onClick={() => {
                      setFilterRole("");
                      setFilterRoster("all");
                    }}
                  >
                    Clear filters
                  </button>
                ) : null}
                <p className="text-xs text-slate-500">
                  Showing {filteredEmployees.length} employee
                  {filteredEmployees.length === 1 ? "" : "s"}
                  {statusFilter !== "all" ? ` · status: ${statusFilter.replace("_", " ")}` : ""}
                </p>
              </div>
            </div>
          ) : null}
        </div>

        {canArchive && filteredEmployees.length > 0 && payrollStripHasHours ? (
          <div className="border-b border-slate-100 px-4 py-3 sm:px-5">
            <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-slate-50/70 p-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-wrap items-center gap-x-6 gap-y-1.5">
                <div className="min-w-0">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    Total payable hours
                  </p>
                  <p className="mt-0.5 text-lg font-bold tabular-nums text-slate-900">
                    {payableSummary.totalPayableHours.toFixed(2)} h
                  </p>
                  <p className="text-[11px] text-slate-500">
                    Worked − unpaid breaks + approved PTO + paid holidays
                  </p>
                </div>
                <div className="min-w-0">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    Reg / OT (worked only)
                  </p>
                  <p className="mt-0.5 text-lg font-bold tabular-nums text-slate-900">
                    <span>{payableSummary.regularHours.toFixed(2)}h</span>
                    <span className="text-slate-300"> · </span>
                    <span
                      className={
                        payableSummary.overtimeHours > 0 ? "text-rose-700" : "text-slate-500"
                      }
                    >
                      OT {payableSummary.overtimeHours.toFixed(2)}h
                    </span>
                  </p>
                  <p className="text-[11px] text-slate-500">
                    Over 40h/wk = 1.5× ·{" "}
                    {payableSummary.employeesWithOvertime} employee
                    {payableSummary.employeesWithOvertime === 1 ? "" : "s"} on OT
                  </p>
                </div>
                <div className="min-w-0">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    Estimated gross pay
                  </p>
                  <p className="mt-0.5 text-lg font-bold tabular-nums text-slate-900">
                    {formatGrossPayLabel(payableSummary.estimatedGrossPay)}
                  </p>
                  <p className="text-[11px] text-slate-500">
                    Reg {formatGrossPayLabel(payableSummary.estimatedRegularPay)} · OT{" "}
                    {formatGrossPayLabel(payableSummary.estimatedOvertimePay)}
                  </p>
                </div>
              </div>
              {payrollStripHasDemo ? (
                <div
                  role="alert"
                  className="flex items-start gap-2 rounded-lg border-2 border-amber-400 bg-amber-100 px-3 py-2 text-xs font-bold text-amber-900 shadow-sm"
                >
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                  <div className="leading-snug">
                    <span className="block uppercase tracking-wide">⚠️ Hourly rate missing</span>
                    <span className="mt-0.5 block font-semibold">
                      {payableSummary.employeesOnFallbackRate} of {payableSummary.employeeCount}{" "}
                      employees have no wage on file. Their pay stays blank until you fill
                      Profile → Hourly rate or enter it manually on the export.
                    </span>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        ) : null}

        {canArchive && filteredEmployees.length > 0 && !payrollStripHasHours && payrollStripHasDemo ? (
          <div className="border-b border-slate-100 px-4 py-3 sm:px-5">
            <div
              role="alert"
              className="flex items-start gap-2 rounded-xl border-2 border-amber-400 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-950 shadow-sm"
            >
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
              <div className="leading-snug">
                <span className="block text-xs font-bold uppercase tracking-wide text-amber-900">
                  Hourly rate missing
                </span>
                <span className="mt-1 block font-medium text-amber-950">
                  {payableSummary.employeesOnFallbackRate} of {payableSummary.employeeCount} employees
                  have no hourly rate on file, so their pay column is blank. Set wages under{" "}
                  <span className="font-semibold">Users → profile → Hourly rate</span>, or enter the
                  rate manually on the payroll export.
                </span>
              </div>
            </div>
          </div>
        ) : null}

        {filteredEmployees.length === 0 ? (
          <div className="px-5 py-10 text-center text-sm text-slate-500">
            {canArchive
              ? "No team members match this period or search. Try a different date range or clear the search."
              : "No time logs for you in this period. Try a different week or use Today to clock in."}
          </div>
        ) : (
          <div
            className={`overflow-x-auto transition-opacity duration-150 ${periodNavPending ? "pointer-events-none opacity-50" : ""}`}
            aria-busy={periodNavPending}
          >
            <div style={{ minWidth: Math.max(400, 260 + days.length * 52) }}>
              <div
                className="grid border-b border-slate-200 bg-slate-100"
                style={{ gridTemplateColumns: gridTemplate }}
              >
                <div className="sticky left-0 z-[1] border-r border-slate-200 bg-slate-100 p-2 backdrop-blur-sm sm:p-3">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    {canArchive ? "Employee" : "You"}
                  </div>
                </div>
                {days.map((d, di) => {
                  const isWeekend = d.getDay() === 0 || d.getDay() === 6;
                  const hk = dayKeys[di];
                  const holiday = hk ? holidayByDayKey.get(hk) ?? null : null;
                  const isToday = di === todayIndex;
                  // "today" wins visually over weekend / holiday tints so the
                  // user can spot the live column immediately. The blue rail
                  // continues into the body rows below.
                  const colBg = isToday
                    ? "bg-blue-50/70 border-l-2 border-l-blue-500"
                    : holiday
                      ? "bg-amber-50/70"
                      : isWeekend
                        ? "bg-slate-100/80"
                        : "";
                  return (
                    <div
                      key={di}
                      className={`border-r border-slate-200 p-1.5 text-center last:border-r-0 sm:p-2 ${colBg}`}
                      title={
                        isToday
                          ? "Today"
                          : holiday
                            ? `${holiday.name}${holiday.isPaid ? ` (paid${holiday.paidHours ? ` ${holiday.paidHours}h` : ""})` : ""}`
                            : undefined
                      }
                    >
                      <div
                        className={`text-[10px] font-semibold leading-tight sm:text-[11px] ${
                          isToday ? "text-blue-700" : "text-slate-600"
                        }`}
                      >
                        {isToday
                          ? "Today"
                          : d.toLocaleDateString(undefined, { weekday: "short" })}
                      </div>
                      <div
                        className={`mt-0.5 text-[10px] font-semibold tabular-nums sm:text-xs ${
                          isToday ? "text-blue-900" : "text-slate-900"
                        }`}
                      >
                        {d.getDate()}
                      </div>
                      {!isToday && holiday ? (
                        <div className="mt-0.5 truncate text-[9px] font-semibold text-amber-700 sm:text-[10px]">
                          {holiday.name}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>

              {filteredEmployees.map((e) => {
                const mins = minutesForEmployeeByDay.get(e.employeeId) ?? new Array(days.length).fill(0);
                const totalPeriod = mins.reduce((a, b) => a + b, 0);
                const canOpenTimecard = canArchive || e.rows.length > 0;
                const canOpenAnyTimecard = canOpenTimecard;
                const payable = payableByEmployeeId.get(e.employeeId) ?? null;
                /** Currently clocked in — the row has at least one punch with no clock-out yet. */
                const isCurrentlyClockedIn = e.rows.some((r) => !r.clockOutAt);
                /** Hide the Reg/OT/Payable/$ chip row when there's nothing yet — the
                 *  empty row stays calm and the org-level demo banner already covers
                 *  "wages missing" up top. We bring chips back the moment a row has
                 *  real worked time, OT, or wage data we'd want to preview. */
                const rowHasPayrollSignal = Boolean(
                  payable &&
                    (payable.totalPayableHours > 0.005 ||
                      payable.regularHours > 0.005 ||
                      payable.overtimeHours > 0.005 ||
                      // estimatedGrossPay is now nullable (no rate ⇒ null);
                      // treat null as "no $ signal" instead of throwing.
                      (payable.estimatedGrossPay !== null &&
                        Math.abs(payable.estimatedGrossPay) > 0.005)),
                );
                return (
                  <div
                    key={e.employeeId}
                    className="grid border-b border-slate-100 bg-white"
                    style={{ gridTemplateColumns: gridTemplate }}
                  >
                    <button
                      type="button"
                      className="sticky left-0 z-[1] border-r border-slate-200 bg-white px-3 py-2.5 text-left hover:bg-slate-50/80 sm:px-4 sm:py-3"
                      onClick={() => {
                        if (!canOpenTimecard) return;
                        openEmployeeTimecard(e);
                      }}
                      disabled={!canOpenTimecard}
                      title={
                        !canOpenTimecard
                          ? "No logged time for this team member in this period."
                          : "Open timecard"
                      }
                    >
                      <div className="flex items-center gap-2">
                        {isCurrentlyClockedIn ? (
                          <span
                            className="relative flex h-2 w-2 shrink-0"
                            aria-label="Currently clocked in"
                            title="Clocked in now"
                          >
                            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
                          </span>
                        ) : null}
                        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-900">
                          {e.name}
                        </span>
                        {canOpenAnyTimecard ? (
                          <span className="hidden shrink-0 items-center gap-0.5 text-[11px] font-semibold text-sky-700 sm:inline-flex">
                            View timecard
                            <ChevronRight className="h-3.5 w-3.5" aria-hidden />
                          </span>
                        ) : null}
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                        <span className="rounded-md bg-slate-50 px-2 py-0.5 font-medium text-slate-700">
                          {e.role || "—"}
                        </span>
                        <span className="text-slate-300">·</span>
                        <span className="tabular-nums">
                          {totalPeriod ? `${formatHoursMinutes(totalPeriod)} this period` : "—"}
                        </span>
                      </div>
                      {canArchive && payable && rowHasPayrollSignal ? (
                        <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px]">
                          <span className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-1.5 py-0.5 font-semibold tabular-nums text-slate-700">
                            <span className="text-slate-500">Reg</span>
                            {payable.regularHours.toFixed(2)}h
                          </span>
                          <span
                            className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 font-semibold tabular-nums ${
                              payable.overtimeHours > 0
                                ? "border-rose-300 bg-rose-50 text-rose-800"
                                : "border-slate-200 bg-white text-slate-500"
                            }`}
                            title={`Over ${payable.weeklyOtThreshold}h/wk → 1.5× rate`}
                          >
                            <span className={payable.overtimeHours > 0 ? "text-rose-600" : "text-slate-400"}>
                              OT
                            </span>
                            {payable.overtimeHours.toFixed(2)}h
                          </span>
                          <span className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-1.5 py-0.5 font-semibold tabular-nums text-slate-700">
                            <span className="text-slate-500">Payable</span>
                            {payable.totalPayableHours.toFixed(2)}h
                          </span>
                          <span
                            className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-bold tabular-nums shadow-sm ${
                              payable.isUsingFallbackRate
                                ? "bg-amber-100 text-amber-900 ring-1 ring-amber-400"
                                : "bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200"
                            }`}
                            // No rate on file → render "—" with a nudge,
                            // not a fake dollar amount. The amber chip color
                            // + the demo banner above already signal the gap.
                            title={
                              payable.hourlyRate === null
                                ? "No hourly rate set — fill it in on the export or update the employee profile."
                                : payable.overtimeHours > 0
                                  ? `Reg ${formatGrossPayLabel(payable.estimatedRegularPay)} · OT ${formatGrossPayLabel(payable.estimatedOvertimePay)} (1.5× of ${formatGrossPayLabel(payable.hourlyRate)}/hr)`
                                  : `@ ${formatGrossPayLabel(payable.hourlyRate)}/hr × ${payable.totalPayableHours.toFixed(2)}h`
                            }
                          >
                            {formatGrossPayLabel(payable.estimatedGrossPay)}
                          </span>
                          {payable.isUsingFallbackRate && !suppressPerRowDemoBadge ? (
                            <span
                              className="inline-flex items-center gap-1 rounded-md bg-amber-400 px-1.5 py-0.5 text-[10px] font-extrabold uppercase tracking-wide text-amber-950 shadow-sm"
                              role="alert"
                              aria-label="No hourly rate on file — update employee profile"
                            >
                              <AlertTriangle className="h-3 w-3" aria-hidden />
                              No rate — set in profile
                            </span>
                          ) : null}
                        </div>
                      ) : null}
                    </button>

                    {mins.map((m, di) => {
                      const has = m > 0;
                      const anchor =
                        e.rows.find((r) => dayKeyLocal(new Date(r.clockInAt)) === dayKeys[di]) ?? null;
                      const dk = dayKeys[di];
                      const holiday = dk ? holidayByDayKey.get(dk) ?? null : null;
                      const isHolidayPayCell = has && !anchor && Boolean(holiday?.isPaid);
                      const canOpenCell = canArchive || Boolean(anchor) || e.rows.length > 0;
                      // Heatmap tint — soft emerald wash on worked cells,
                      // soft amber on auto-credited holiday cells. Empty
                      // cells stay neutral so the eye glides past them.
                      const isTodayCol = di === todayIndex;
                      // The "today" rail wins so the column stays visible
                      // even on rows that are currently empty.
                      const cellBg = isTodayCol
                        ? has
                          ? isHolidayPayCell
                            ? "bg-blue-50/60 border-l-2 border-l-blue-500"
                            : "bg-blue-50/60 border-l-2 border-l-blue-500"
                          : "bg-blue-50/40 border-l-2 border-l-blue-500"
                        : has
                          ? isHolidayPayCell
                            ? "bg-amber-50/60"
                            : "bg-emerald-50/60"
                          : "";
                      return (
                        <div
                          key={di}
                          className={`flex min-h-[52px] items-center justify-center border-r border-slate-100 p-1 last:border-r-0 sm:min-h-[56px] ${cellBg}`}
                        >
                          {has ? (
                            canOpenCell ? (
                              <button
                                type="button"
                                onClick={() => openEmployeeTimecard(e)}
                                className={`inline-flex max-w-full items-center justify-center rounded-md px-1.5 py-1 text-[11px] font-semibold tabular-nums text-white shadow-sm sm:px-2 sm:text-sm ${
                                  isHolidayPayCell
                                    ? "bg-amber-600 hover:bg-amber-700"
                                    : "bg-emerald-600 hover:bg-emerald-700"
                                }`}
                                title={
                                  isHolidayPayCell
                                    ? `${holiday?.name ?? "Holiday"} (paid)`
                                    : "Open timecard"
                                }
                              >
                                {isHolidayPayCell ? `Holiday ${formatHoursMinutes(m)}` : formatHoursMinutes(m)}
                              </button>
                            ) : (
                              <span
                                className={`inline-flex max-w-full items-center justify-center rounded-md px-2 py-1 text-[11px] font-semibold tabular-nums text-white shadow-sm ${
                                  isHolidayPayCell ? "bg-amber-600" : "bg-emerald-600"
                                }`}
                                title={
                                  isHolidayPayCell
                                    ? `${holiday?.name ?? "Holiday"} (paid) — nothing to open`
                                    : "Nothing to open"
                                }
                              >
                                {isHolidayPayCell ? `Holiday ${formatHoursMinutes(m)}` : formatHoursMinutes(m)}
                              </span>
                            )
                          ) : canArchive ? (
                            <button
                              type="button"
                              onClick={() => openEmployeeTimecard(e)}
                              className="rounded px-2 py-1 text-[10px] font-semibold text-sky-700 hover:bg-sky-50 sm:text-xs"
                              title="Open timecard"
                            >
                              Open
                            </button>
                          ) : (
                            <span className="text-[10px] text-slate-300 sm:text-xs">—</span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {!canArchive ? (
        <p className="text-xs text-slate-500">
          Pay estimates and payroll export are only visible to managers. You can download your own hours with
          &quot;Download my hours&quot; above.
        </p>
      ) : null}

      <EmployeeTimecardModal
        key={activeTimecardEmployee?.employeeId ?? "closed"}
        open={activeTimecardOpen}
        onClose={() => {
          if (!canArchive && employeeAutoTimecardAnchor) {
            setDismissedTimecardPeriodKey(timecardPeriodKey);
          }
          setTimecardAnchorRow(null);
          setTimecardEmployeeId(null);
        }}
        rows={timecardRows}
        employeeId={activeTimecardEmployee?.employeeId}
        employeeName={activeTimecardEmployee?.name}
        employeeRole={activeTimecardEmployee?.role}
        timeClockId={timeClockId}
        canEditJob={canArchive}
        canApprovePunches={canArchive}
        onApproveEntry={canArchive ? onApproveEntry : undefined}
        onUnapproveEntry={canArchive ? onUnapproveEntry : undefined}
        approvalPending={actionPending}
        canManageTimeEntries={canArchive}
        storeEmployees={storeEmployees}
        locationId={locationId}
        timeOffRecords={timeOffRecords}
        onPunchAdjusted={() => router.refresh()}
        onPrevPeriod={navigatePeriodPrev}
        onNextPeriod={navigatePeriodNext}
        onPickPeriodRange={(from, to) => {
          const ymd = (d: Date) =>
            `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
              d.getDate(),
            ).padStart(2, "0")}`;
          pushTimesheetsQuery({ rangeFrom: ymd(from), rangeTo: ymd(to) });
        }}
        canNavigatePeriod
        periodLabelOverride={rangeLabel}
        onPrevUser={() => selectEmployeeInPool(timecardUserNav.prevId)}
        onNextUser={() => selectEmployeeInPool(timecardUserNav.nextId)}
        hasPrevUser={timecardUserNav.prevId != null}
        hasNextUser={timecardUserNav.nextId != null}
        periodKind={periodKind}
        periodStartIso={periodStartIso}
        periodEndExclusiveIso={periodEndExclusiveIso}
        weekStartsOn={
          typeof periodConfig.week_starts_on === "number" ? periodConfig.week_starts_on : 1
        }
      />
    </div>
  );
}
