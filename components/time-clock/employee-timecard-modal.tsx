"use client";

/**
 * Employee timecard overlay — layout aligned with legacy LaMa / familiar ops UI:
 * top Close, identity + period strip, summary metrics, Add / export / Approve,
 * dense grid with checkbox, job picker styling, scheduled vs difference (red when under),
 * weekly column, vertical “Shift attachments” rail, notes columns.
 */

import {
  ArrowDown01,
  ArrowLeft,
  ArrowRight,
  ArrowUp01,
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Download,
  Filter,
} from "lucide-react";
import Link from "next/link";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { DayPicker } from "react-day-picker";
import "react-day-picker/style.css";
import { adjustTimeEntry } from "@/app/actions/time-entry-adjust";
import { createManagerShiftEntry } from "@/app/actions/time-entry-manual";
import { approveTimeOffRequest, denyTimeOffRequest, requestEmployeeTimeOff } from "@/app/actions/time-off-record";
import { TimeOffRequestSidebar, type StoreEmployeeOption } from "@/components/time-clock/time-off-request-sidebar";
import { POSITION_ROLE_OPTIONS, type PositionRoleValue } from "@/lib/users/position-options";
import type { PendingTimeOffRequestRow } from "@/lib/time-clock/pending-time-off";
import type { EnrichedPunchRow } from "@/lib/time-clock/types";
import {
  datetimeLocalValueToIso,
  dateYmdToLocalDayStartIso,
  isoToDatetimeLocalValue,
} from "@/lib/time-clock/datetime-local";
import {
  rollupTimeOffForEmployeeInRange,
  type TimeOffRecordForUi,
} from "@/lib/time-clock/time-off-display";
import type { TimesheetPeriodKind } from "@/lib/time-clock/timesheet-period";
import { PunchTimeDisplay } from "@/components/time-clock/punch-time-display";
import {
  dailyMinutesMap,
  formatHoursMinutes,
  formatSignedVarianceMinutes,
  groupRowsIntoTimecardBlocks,
  localDayKey,
  punchMinutes,
  shortDateRangeLabel,
  type TimecardPeriodBlock,
} from "@/lib/time-clock/timecard-rollup";

function reviewBadgeClass(status: EnrichedPunchRow["reviewStatus"]): string {
  switch (status) {
    case "open":
      return "bg-amber-50 text-amber-900 ring-amber-200/80";
    case "pending":
      return "bg-sky-50 text-sky-900 ring-sky-200/80";
    case "approved":
      return "bg-emerald-50 text-emerald-900 ring-emerald-200/80";
    case "archived":
      return "bg-slate-200 text-slate-800 ring-slate-300/80";
    default:
      return "bg-slate-100 text-slate-700 ring-slate-200/80";
  }
}

function jobPillClass(tone: EnrichedPunchRow["jobTone"]): string {
  switch (tone) {
    case "manager":
      return "bg-rose-100 text-rose-900 ring-rose-200/80";
    case "lead":
      return "bg-violet-100 text-violet-900 ring-violet-200/80";
    case "staff":
      return "bg-pink-100 text-pink-900 ring-pink-200/80";
    default:
      return "bg-slate-100 text-slate-800 ring-slate-200/80";
  }
}

function formatDayHeader(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      weekday: "short",
      month: "numeric",
      day: "numeric",
    });
  } catch {
    return "—";
  }
}

function initialsFromName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] ?? ""}${parts[parts.length - 1][0] ?? ""}`.toUpperCase();
}

type Props = {
  open: boolean;
  onClose: () => void;
  rows: EnrichedPunchRow[];
  /** When the period has no punches yet, supply identity from the timesheet roster. */
  employeeId?: string | null;
  employeeName?: string | null;
  employeeRole?: string | null;
  /** Context clock id (required for "Add shift"). */
  timeClockId?: string | null;
  /** Viewer’s employee id (used for self-service leave requests). */
  viewerEmployeeId?: string | null;
  /** PTO balances computed from the ledger (optional). */
  ptoBalances?: {
    vacationHours: number;
    sickHours: number;
    standardDayHours: number;
    vacationCashoutEnabled?: boolean;
    nextVacationCashoutAt?: string | null;
    nextVacationCashoutHours?: number;
    lastVacationCashoutAt?: string | null;
    lastVacationCashoutHours?: number;
    ytdVacationUsedHours?: number;
  } | null;
  ptoBalancesLoading?: boolean;
  /** Enable editing job/position on rows (admins only). */
  canEditJob?: boolean;
  /** Show per-row approve / unapprove for closed punches (managers). */
  canApprovePunches?: boolean;
  onApproveEntry?: (entryId: string) => void;
  onUnapproveEntry?: (entryId: string) => void;
  approvalPending?: boolean;
  /** Managers: Add shift / time off + store roster for time off drawer. */
  canManageTimeEntries?: boolean;
  storeEmployees?: StoreEmployeeOption[];
  /** Store id — required for manager “Fix clock-in/out time”. */
  locationId?: string;
  /** Called after a successful time adjustment (e.g. router.refresh). */
  onPunchAdjusted?: () => void;
  /** Approved time off overlapping this timecard’s punch window. */
  timeOffRecords?: TimeOffRecordForUi[];
  /** Pending employee-submitted time off requests (manager scope; used for inline approvals). */
  pendingTimeOffRequests?: PendingTimeOffRequestRow[];
  /**
   * Optional period navigation. When all four are provided, the chevrons next
   * to the period label become active and step the parent's pay-period state.
   * Used by Timesheets (panel-level pay-period anchor).
   */
  onPrevPeriod?: () => void;
  onNextPeriod?: () => void;
  /** Defaults to true; pass false to disable both arrows even when handlers exist. */
  canNavigatePeriod?: boolean;
  /** Overrides the computed period label when the parent owns the range. */
  periodLabelOverride?: string;
  /**
   * Optional "jump to date range" handler. When provided, the period label
   * becomes a button that opens a compact calendar popover with quick presets
   * and range selection. Picking a range calls this with `[from, to]` so the
   * parent can either snap its pay period (Timesheets) or refetch rows in
   * place (Punches modal). `from` and `to` are normalized so `from <= to`.
   */
  onPickPeriodRange?: (from: Date, to: Date) => void;
  /**
   * Optional roster navigation. When `onPrevUser` / `onNextUser` are wired, the
   * top strip shows "← Previous user" / "Next user →" buttons that swap the
   * timecard's anchor employee without closing the modal.
   */
  onPrevUser?: () => void;
  onNextUser?: () => void;
  hasPrevUser?: boolean;
  hasNextUser?: boolean;
  /**
   * Optional non-blocking notice shown under the header (e.g. "Viewing
   * history for May 11, 2026" or a fetch error). Surfacing this inside the
   * modal keeps the user oriented when historical data is swapped in.
   */
  historicalNotice?: string | null;
  /** Pay-period context from Timesheets (drives Week 1 / Week 2 for bi-weekly). */
  periodKind?: TimesheetPeriodKind | null;
  periodStartIso?: string | null;
  periodEndExclusiveIso?: string | null;
  weekStartsOn?: number;
};

export function EmployeeTimecardModal({
  open,
  onClose,
  rows,
  employeeId: employeeIdProp = null,
  employeeName: employeeNameProp = null,
  employeeRole: employeeRoleProp = null,
  timeClockId = null,
  viewerEmployeeId = null,
  ptoBalances = null,
  ptoBalancesLoading = false,
  canEditJob = false,
  canApprovePunches = false,
  onApproveEntry,
  onUnapproveEntry,
  approvalPending = false,
  canManageTimeEntries = false,
  storeEmployees = [],
  locationId,
  onPunchAdjusted,
  timeOffRecords = [],
  pendingTimeOffRequests = [],
  onPrevPeriod,
  onNextPeriod,
  canNavigatePeriod = true,
  periodLabelOverride,
  onPickPeriodRange,
  onPrevUser,
  onNextUser,
  hasPrevUser = false,
  hasNextUser = false,
  historicalNotice = null,
  periodKind = null,
  periodStartIso = null,
  periodEndExclusiveIso = null,
  weekStartsOn = 1,
}: Props) {
  const [stableNowMs] = useState(() => Date.now());
  // Display filters & sort — applied to the table rows only, totals stay truthful
  // for the full pay period regardless of the filter.
  const [typeFilter, setTypeFilter] = useState<"all" | "shift" | "timeoff">("all");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [filterMenuOpen, setFilterMenuOpen] = useState(false);
  const filterMenuRef = useRef<HTMLDivElement>(null);
  const [periodPickerOpen, setPeriodPickerOpen] = useState(false);
  const periodPickerRef = useRef<HTMLDivElement>(null);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [timeOffOpen, setTimeOffOpen] = useState(false);
  const [timeOffDefaultDayYmd, setTimeOffDefaultDayYmd] = useState<string | null>(null);
  const [timeOffDefaultType, setTimeOffDefaultType] = useState<string | null>(null);
  const [addShiftOpen, setAddShiftOpen] = useState(false);
  const [addShiftDayYmd, setAddShiftDayYmd] = useState("");
  const [addShiftStartHm, setAddShiftStartHm] = useState("09:00");
  const [addShiftEndHm, setAddShiftEndHm] = useState("17:00");
  const [addShiftErr, setAddShiftErr] = useState<string | null>(null);
  const [addShiftPending, setAddShiftPending] = useState(false);
  const [leaveActionPending, setLeaveActionPending] = useState(false);
  const [leaveActionErr, setLeaveActionErr] = useState<string | null>(null);
  const [employeeNotesByEntryId, setEmployeeNotesByEntryId] = useState<Record<string, string>>(
    {},
  );
  const [managerNotesByEntryId, setManagerNotesByEntryId] = useState<Record<string, string>>({});
  const [leaveHoursByEntryId, setLeaveHoursByEntryId] = useState<Record<string, string>>({});
  const [leaveTypeByEntryId, setLeaveTypeByEntryId] = useState<
    Record<string, "Vacation" | "Sick" | "">
  >({});

  function localDayBoundsMs(ymd: string): { startMs: number; endMs: number } | null {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd.trim());
    if (!m) return null;
    const y = Number(m[1]);
    const mo = Number(m[2]);
    const d = Number(m[3]);
    const start = new Date(y, mo - 1, d, 0, 0, 0, 0).getTime();
    const end = new Date(y, mo - 1, d, 23, 59, 59, 999).getTime();
    if (Number.isNaN(start) || Number.isNaN(end)) return null;
    return { startMs: start, endMs: end };
  }

  function overlapsLocalDay(startIso: string, endIso: string, ymd: string): boolean {
    const b = localDayBoundsMs(ymd);
    if (!b) return false;
    const s = Date.parse(startIso);
    const e = Date.parse(endIso);
    if (Number.isNaN(s) || Number.isNaN(e)) return false;
    return e > b.startMs && s < b.endMs;
  }
  const addMenuRef = useRef<HTMLDivElement>(null);
  const [adjustTarget, setAdjustTarget] = useState<EnrichedPunchRow | null>(null);
  const [adjustIn, setAdjustIn] = useState("");
  const [adjustOut, setAdjustOut] = useState("");
  const [adjustReason, setAdjustReason] = useState("");
  const [adjustErr, setAdjustErr] = useState<string | null>(null);
  const [adjustPending, setAdjustPending] = useState(false);

  useEffect(() => {
    if (!addMenuOpen) return;
    function handleClick(e: MouseEvent) {
      if (addMenuRef.current && !addMenuRef.current.contains(e.target as Node)) {
        setAddMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [addMenuOpen]);

  useEffect(() => {
    if (!filterMenuOpen) return;
    function handleClick(e: MouseEvent) {
      if (filterMenuRef.current && !filterMenuRef.current.contains(e.target as Node)) {
        setFilterMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [filterMenuOpen]);

  useEffect(() => {
    if (!periodPickerOpen) return;
    function handleClick(e: MouseEvent) {
      if (periodPickerRef.current && !periodPickerRef.current.contains(e.target as Node)) {
        setPeriodPickerOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [periodPickerOpen]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      if (timeOffOpen) {
        setTimeOffOpen(false);
        return;
      }
      onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose, timeOffOpen]);

  // Note: we intentionally do not reset UI subpanels via effects to satisfy lint rules.

  const headerEmployee = useMemo(() => {
    if (rows.length > 0) {
      const sorted = [...rows].sort(
        (a, b) => new Date(a.clockInAt).getTime() - new Date(b.clockInAt).getTime(),
      );
      const first = sorted[0];
      return {
        employeeId: first.employeeId,
        employeeName: first.employeeName,
        employeeRole: first.employeeRole,
        initials: first.initials,
      };
    }
    const id = employeeIdProp?.trim();
    const name = employeeNameProp?.trim();
    if (!id || !name) return null;
    return {
      employeeId: id,
      employeeName: name,
      employeeRole: employeeRoleProp?.trim() ?? "",
      initials: initialsFromName(name),
    };
  }, [rows, employeeIdProp, employeeNameProp, employeeRoleProp]);

  const meta = useMemo(() => {
    if (!headerEmployee) return null;

    const sorted = [...rows].sort(
      (a, b) => new Date(a.clockInAt).getTime() - new Date(b.clockInAt).getTime(),
    );

    if (sorted.length === 0) {
      const periodLabel =
        periodLabelOverride ??
        (periodStartIso && periodEndExclusiveIso
          ? shortDateRangeLabel(
              new Date(periodStartIso),
              new Date(new Date(periodEndExclusiveIso).getTime() - 86_400_000),
            )
          : "Selected period");

      let timeOffPaidM = 0;
      let timeOffUnpaidM = 0;
      if (timeOffRecords.length > 0 && periodStartIso && periodEndExclusiveIso) {
        const roll = rollupTimeOffForEmployeeInRange(
          headerEmployee.employeeId,
          timeOffRecords,
          new Date(periodStartIso),
          new Date(periodEndExclusiveIso),
        );
        timeOffPaidM = roll.paidMinutes;
        timeOffUnpaidM = roll.unpaidMinutes;
      }

      return {
        first: sorted[0] ?? null,
        byDay: new Map<string, number>(),
        totalPaid: 0,
        workedDays: 0,
        weekBlocks: [] as TimecardPeriodBlock[],
        totalVariance: 0,
        varianceCount: 0,
        totalRowCount: 0,
        displayRowCount: 0,
        periodLabel,
        timeOffPaidM,
        timeOffUnpaidM,
      };
    }

    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    const byDay = dailyMinutesMap(sorted);
    const totalPaid = [...byDay.values()].reduce((a, b) => a + b, 0);
    const workedDays = byDay.size;

    let totalVariance = 0;
    let varianceCount = 0;
    for (const r of sorted) {
      if (r.scheduleVarianceMinutes != null) {
        totalVariance += r.scheduleVarianceMinutes;
        varianceCount += 1;
      }
    }

    // Filtered, sorted view of the rows used for the table render. Totals above
    // intentionally use the unfiltered set so the strip stays truthful even when
    // a manager hides "Shift" or "Time off" rows to focus on a slice.
    const isTimeOff = (r: EnrichedPunchRow) =>
      r.hasRealTimeEntry === false && r.ptoLabel !== "—";
    const displayRows = sorted.filter((r) => {
      if (typeFilter === "all") return true;
      if (typeFilter === "shift") return !isTimeOff(r);
      return isTimeOff(r);
    });

    const weekBlocks: TimecardPeriodBlock[] = groupRowsIntoTimecardBlocks(
      displayRows,
      {
        periodKind,
        periodStartIso,
        periodEndExclusiveIso,
        weekStartsOn,
      },
      sortDir,
    );

    const periodStart = new Date(first.clockInAt).toLocaleDateString(undefined, {
      month: "2-digit",
      day: "2-digit",
    });
    const periodEnd = new Date(last.clockInAt).toLocaleDateString(undefined, {
      month: "2-digit",
      day: "2-digit",
      year: "numeric",
    });

    let timeOffPaidM = 0;
    let timeOffUnpaidM = 0;
    if (timeOffRecords.length > 0) {
      const lastRow = sorted[sorted.length - 1];
      const endMs = lastRow.clockOutAt
        ? new Date(lastRow.clockOutAt).getTime()
        : stableNowMs;
      const roll = rollupTimeOffForEmployeeInRange(
        first.employeeId,
        timeOffRecords,
        new Date(sorted[0].clockInAt),
        new Date(endMs),
      );
      timeOffPaidM = roll.paidMinutes;
      timeOffUnpaidM = roll.unpaidMinutes;
    }

    return {
      first,
      last,
      byDay,
      totalPaid,
      workedDays,
      weekBlocks,
      totalVariance,
      varianceCount,
      totalRowCount: sorted.length,
      displayRowCount: displayRows.length,
      periodLabel: `${periodStart} - ${periodEnd}`,
      timeOffPaidM,
      timeOffUnpaidM,
    };
  }, [
    rows,
    headerEmployee,
    timeOffRecords,
    stableNowMs,
    typeFilter,
    sortDir,
    periodKind,
    periodStartIso,
    periodEndExclusiveIso,
    weekStartsOn,
    periodLabelOverride,
  ]);

  const [jobOverrides, setJobOverrides] = useState<Record<string, PositionRoleValue | undefined>>(
    {},
  );

  const pendingApprovalCount = useMemo(
    () => rows.filter((r) => r.reviewStatus === "pending").length,
    [rows],
  );

  /** Same-store roster for time off; falls back to the open timecard employee only. */
  const roster = useMemo(() => {
    if (storeEmployees.length > 0) return storeEmployees;
    if (!headerEmployee) return [];
    return [{ id: headerEmployee.employeeId, fullName: headerEmployee.employeeName }];
  }, [storeEmployees, headerEmployee]);

  const [draftRange, setDraftRange] = useState<{ from?: Date; to?: Date }>({});

  if (!open || !headerEmployee || !meta) return null;

  const { first, byDay, totalPaid, workedDays, weekBlocks, periodLabel, timeOffPaidM, totalRowCount, displayRowCount } =
    meta;
  const subjectEmployeeId = first?.employeeId ?? headerEmployee.employeeId;

  // Aggregate timesheet status used for the header pill. Order of precedence:
  // open shifts first (most urgent), then pending leave, then approved.
  const openShiftsCount = rows.filter((r) => !r.clockOutAt).length;
  const pendingLeaveCount = pendingTimeOffRequests.filter(
    (p) => p.employeeId === subjectEmployeeId,
  ).length;
  const closedRows = rows.filter((r) => r.clockOutAt);
  const allApproved =
    closedRows.length > 0 && closedRows.every((r) => r.reviewStatus === "approved");
  type StatusPill = { label: string; tone: "open" | "pending" | "approved" | "neutral" };
  const statusPill: StatusPill | null = (() => {
    if (openShiftsCount > 0) {
      return {
        label: `${openShiftsCount} open shift${openShiftsCount === 1 ? "" : "s"}`,
        tone: "open",
      };
    }
    if (pendingLeaveCount > 0) {
      return {
        label: `${pendingLeaveCount} pending leave`,
        tone: "pending",
      };
    }
    if (pendingApprovalCount > 0) {
      return {
        label: `${pendingApprovalCount} pending review`,
        tone: "pending",
      };
    }
    if (allApproved) {
      return { label: "Approved", tone: "approved" };
    }
    return null;
  })();
  const statusPillClass = (() => {
    switch (statusPill?.tone) {
      case "open":
        return "bg-sky-50 text-sky-900 ring-sky-200/80";
      case "pending":
        return "bg-orange-50 text-orange-900 ring-orange-200/80";
      case "approved":
        return "bg-emerald-50 text-emerald-900 ring-emerald-200/80";
      default:
        return "bg-slate-100 text-slate-700 ring-slate-200/80";
    }
  })();

  const filterActive = typeFilter !== "all";
  const visiblePeriodLabel = periodLabelOverride ?? periodLabel;
  const periodNavEnabled = canNavigatePeriod && Boolean(onPrevPeriod || onNextPeriod);
  const canPickPeriodRange = Boolean(onPickPeriodRange);
  // Default highlighted month for the calendar = the first clock-in date in
  // the period. Falls back to today if the period somehow has no rows.
  const periodAnchorDate = (() => {
    const firstIso = first?.clockInAt ?? periodStartIso;
    const d = firstIso ? new Date(firstIso) : new Date();
    return Number.isNaN(d.getTime()) ? new Date() : d;
  })();

  const startOfDay = (d: Date) => {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    return x;
  };
  const addDays = (d: Date, n: number) => {
    const x = startOfDay(d);
    x.setDate(x.getDate() + n);
    return x;
  };
  const startOfWeekMondayLocal = (d: Date) => {
    const x = startOfDay(d);
    const wd = (x.getDay() + 6) % 7;
    x.setDate(x.getDate() - wd);
    return x;
  };
  const presets: { id: string; label: string; range: () => [Date, Date] }[] = [
    {
      id: "today",
      label: "Today",
      range: () => {
        const t = startOfDay(new Date());
        return [t, t];
      },
    },
    {
      id: "yesterday",
      label: "Yesterday",
      range: () => {
        const y = addDays(new Date(), -1);
        return [y, y];
      },
    },
    {
      id: "this-week",
      label: "This week",
      range: () => {
        const s = startOfWeekMondayLocal(new Date());
        return [s, addDays(s, 6)];
      },
    },
    {
      id: "last-week",
      label: "Last week",
      range: () => {
        const s = addDays(startOfWeekMondayLocal(new Date()), -7);
        return [s, addDays(s, 6)];
      },
    },
    {
      id: "last-7",
      label: "Last 7 days",
      range: () => {
        const today = startOfDay(new Date());
        return [addDays(today, -6), today];
      },
    },
    {
      id: "last-14",
      label: "Last 14 days",
      range: () => {
        const today = startOfDay(new Date());
        return [addDays(today, -13), today];
      },
    },
    {
      id: "last-30",
      label: "Last 30 days",
      range: () => {
        const today = startOfDay(new Date());
        return [addDays(today, -29), today];
      },
    },
    {
      id: "this-month",
      label: "This month",
      range: () => {
        const now = new Date();
        const s = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
        const e = new Date(now.getFullYear(), now.getMonth() + 1, 0, 0, 0, 0, 0);
        return [s, e];
      },
    },
    {
      id: "last-month",
      label: "Last month",
      range: () => {
        const now = new Date();
        const s = new Date(now.getFullYear(), now.getMonth() - 1, 1, 0, 0, 0, 0);
        const e = new Date(now.getFullYear(), now.getMonth(), 0, 0, 0, 0, 0);
        return [s, e];
      },
    },
  ];

  function applyRange(from: Date, to: Date) {
    setPeriodPickerOpen(false);
    setDraftRange({});
    const [a, b] = from.getTime() <= to.getTime() ? [from, to] : [to, from];
    onPickPeriodRange?.(startOfDay(a), startOfDay(b));
  }

  /** Roomier cells / type — legacy LaMa-style tables used more padding than compact data grids. */
  const theadCls =
    "border-b border-slate-200 bg-slate-100/95 text-xs font-bold uppercase tracking-wide text-slate-600";
  const cellBorder = "border-b border-slate-200 border-r border-slate-200 last:border-r-0";
  const thPad = "whitespace-nowrap px-4 py-3.5 align-middle text-center";
  const tdPad = "px-4 py-4 align-middle";
  const totalWorkedM = totalPaid;
  const totalPaidM = totalWorkedM + timeOffPaidM;

  const ptoStrip = (() => {
    const day = ptoBalances?.standardDayHours ?? 8;
    const safeDay = Number.isFinite(day) && day > 0 ? day : 8;
    const vacH = ptoBalances?.vacationHours ?? 0;
    const sickH = ptoBalances?.sickHours ?? 0;
    const fmtH = (h: number) => (Number.isFinite(h) ? h : 0);
    const fmtD = (h: number) => (Number.isFinite(h) ? h / safeDay : 0);
    return {
      vacH: fmtH(vacH),
      vacD: fmtD(vacH),
      sickH: fmtH(sickH),
      sickD: fmtD(sickH),
      dayHours: safeDay,
    };
  })();

  return (
    <div
      className="fixed inset-0 z-[100] flex items-end justify-center bg-slate-900/50"
      role="dialog"
      aria-modal="true"
      aria-labelledby="timecard-title"
    >
      <button
        type="button"
        className="absolute inset-0 cursor-default"
        aria-label="Close timecard"
        onClick={onClose}
      />
      <div
        className="relative flex h-[90vh] max-h-[90vh] w-[98%] max-w-none flex-col overflow-hidden rounded-t-xl border border-slate-300 bg-white shadow-e3"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top strip: prev/next user nav flank the centered Close. */}
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-3 py-1.5">
          <button
            type="button"
            onClick={onPrevUser}
            disabled={!hasPrevUser || !onPrevUser}
            aria-label="Previous user"
            className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:text-slate-300 disabled:hover:bg-transparent"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
            <span className="hidden sm:inline">Previous user</span>
            <span className="sm:hidden">Prev</span>
          </button>
          <button
            type="button"
            onClick={onClose}
            className="text-sm font-semibold text-slate-700 hover:text-slate-900"
          >
            Close
          </button>
          <button
            type="button"
            onClick={onNextUser}
            disabled={!hasNextUser || !onNextUser}
            aria-label="Next user"
            className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:text-slate-300 disabled:hover:bg-transparent"
          >
            <span className="hidden sm:inline">Next user</span>
            <span className="sm:hidden">Next</span>
            <ArrowRight className="h-3.5 w-3.5" aria-hidden />
          </button>
        </div>

        {/* Identity + period nav + filter/sort + balance chips + actions */}
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-4 border-b border-slate-200 bg-white px-5 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <span
              className="flex h-12 w-12 shrink-0 items-center justify-center rounded border border-slate-200 bg-slate-100 text-sm font-bold text-slate-800"
              aria-hidden
            >
              {headerEmployee.initials}
            </span>
            <div className="min-w-0">
              <h2 id="timecard-title" className="truncate text-base font-bold text-slate-900">
                {headerEmployee.employeeName}
              </h2>
              <div className="mt-1 flex flex-wrap items-center gap-1.5 text-sm text-slate-600">
                <button
                  type="button"
                  onClick={onPrevPeriod}
                  disabled={!periodNavEnabled || !onPrevPeriod}
                  title={periodNavEnabled ? "Previous period" : "Period navigation unavailable here"}
                  className="rounded p-0.5 text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:text-slate-300 disabled:hover:bg-transparent"
                  aria-label="Previous period"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                {canPickPeriodRange ? (
                  <div className="relative" ref={periodPickerRef}>
                    <button
                      type="button"
                      onClick={() =>
                        setPeriodPickerOpen((o) => {
                          const next = !o;
                          if (next) setDraftRange({});
                          return next;
                        })
                      }
                      aria-expanded={periodPickerOpen}
                      aria-haspopup="dialog"
                      title="Pick a date range to view"
                      className={`inline-flex min-w-[10rem] items-center justify-center gap-1.5 rounded-md border px-2.5 py-1 tabular-nums text-center text-xs font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-400/50 ${
                        periodPickerOpen
                          ? "border-orange-300 bg-orange-50 text-orange-900 shadow-sm"
                          : "border-slate-200 bg-white text-slate-800 hover:border-slate-300 hover:bg-slate-50"
                      }`}
                    >
                      <CalendarDays
                        className={`h-3.5 w-3.5 ${
                          periodPickerOpen ? "text-orange-600" : "text-slate-500"
                        }`}
                        aria-hidden
                      />
                      {visiblePeriodLabel}
                      <ChevronDown
                        className={`h-3 w-3 transition ${
                          periodPickerOpen
                            ? "rotate-180 text-orange-600"
                            : "text-slate-500"
                        }`}
                        aria-hidden
                      />
                    </button>
                    {periodPickerOpen ? (
                      <div
                        role="dialog"
                        aria-label="Pick date range"
                        className="absolute left-1/2 top-full z-[110] mt-2 flex -translate-x-1/2 overflow-hidden rounded-xl border border-slate-200 bg-white text-xs shadow-e3"
                        style={{
                          // Tighten react-day-picker's defaults so the popover
                          // doesn't take half the screen.
                          // eslint-disable-next-line @typescript-eslint/no-explicit-any
                          ["--rdp-cell-size" as any]: "30px",
                          // eslint-disable-next-line @typescript-eslint/no-explicit-any
                          ["--rdp-accent-color" as any]: "#ea580c",
                          // eslint-disable-next-line @typescript-eslint/no-explicit-any
                          ["--rdp-accent-background-color" as any]:
                            "rgb(255 237 213 / 0.6)",
                        }}
                      >
                        {/* Left rail: quick presets */}
                        <div className="flex w-[8.5rem] flex-col gap-0.5 border-r border-slate-100 bg-slate-50/60 p-2">
                          <div className="px-1.5 pb-1 text-[10px] font-bold uppercase tracking-wide text-slate-500">
                            Quick ranges
                          </div>
                          {presets.map((p) => (
                            <button
                              key={p.id}
                              type="button"
                              onClick={() => {
                                const [a, b] = p.range();
                                applyRange(a, b);
                              }}
                              className="rounded px-2 py-1 text-left text-[11px] font-medium text-slate-700 hover:bg-white hover:shadow-sm"
                            >
                              {p.label}
                            </button>
                          ))}
                        </div>

                        {/* Right side: calendar + apply/clear */}
                        <div className="flex flex-col p-2">
                          <DayPicker
                            mode="range"
                            selected={
                              draftRange.from
                                ? { from: draftRange.from, to: draftRange.to }
                                : undefined
                            }
                            defaultMonth={periodAnchorDate}
                            onSelect={(r) => {
                              setDraftRange({ from: r?.from, to: r?.to });
                            }}
                            weekStartsOn={1}
                            showOutsideDays={false}
                            numberOfMonths={1}
                            className="text-xs"
                          />
                          <div className="mt-1 flex items-center justify-between gap-2 border-t border-slate-100 pt-2">
                            <button
                              type="button"
                              onClick={() => {
                                const t = startOfDay(new Date());
                                applyRange(t, t);
                              }}
                              className="rounded-md px-2 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-50"
                              title="Clear history view; return to live data"
                            >
                              Clear / Today
                            </button>
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => {
                                  setPeriodPickerOpen(false);
                                  setDraftRange({});
                                }}
                                className="rounded-md px-2 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-50"
                              >
                                Cancel
                              </button>
                              <button
                                type="button"
                                disabled={!draftRange.from}
                                onClick={() => {
                                  if (!draftRange.from) return;
                                  const to = draftRange.to ?? draftRange.from;
                                  applyRange(draftRange.from, to);
                                }}
                                className="rounded-md bg-orange-600 px-2.5 py-1 text-[11px] font-bold text-white shadow-sm hover:bg-orange-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400 disabled:shadow-none"
                              >
                                Apply
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <span className="min-w-[8.5rem] tabular-nums text-center font-medium text-slate-800">
                    {visiblePeriodLabel}
                  </span>
                )}
                <button
                  type="button"
                  onClick={onNextPeriod}
                  disabled={!periodNavEnabled || !onNextPeriod}
                  title={periodNavEnabled ? "Next period" : "Period navigation unavailable here"}
                  className="rounded p-0.5 text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:text-slate-300 disabled:hover:bg-transparent"
                  aria-label="Next period"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>

                {/* Type filter (funnel) */}
                <div className="relative ml-1" ref={filterMenuRef}>
                  <button
                    type="button"
                    onClick={() => setFilterMenuOpen((o) => !o)}
                    aria-expanded={filterMenuOpen}
                    aria-haspopup="menu"
                    title="Filter entries"
                    className={`inline-flex items-center gap-1 rounded border px-2 py-1 text-xs font-semibold transition ${
                      filterActive
                        ? "border-orange-200 bg-orange-50 text-orange-900"
                        : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                    }`}
                  >
                    <Filter className="h-3.5 w-3.5" aria-hidden />
                    <span>
                      {typeFilter === "all"
                        ? "All"
                        : typeFilter === "shift"
                          ? "Shifts only"
                          : "Time off only"}
                    </span>
                    <ChevronDown className="h-3 w-3 opacity-70" aria-hidden />
                  </button>
                  {filterMenuOpen ? (
                    <div
                      role="menu"
                      className="absolute left-0 z-[105] mt-1 min-w-[10rem] rounded-lg border border-slate-200 bg-white py-1 shadow-lg"
                    >
                      {[
                        { id: "all", label: "All entries" },
                        { id: "shift", label: "Shifts only" },
                        { id: "timeoff", label: "Time off only" },
                      ].map((opt) => (
                        <button
                          key={opt.id}
                          type="button"
                          role="menuitemradio"
                          aria-checked={typeFilter === opt.id}
                          className={`block w-full px-3 py-1.5 text-left text-xs font-medium ${
                            typeFilter === opt.id
                              ? "bg-orange-50 text-orange-900"
                              : "text-slate-700 hover:bg-slate-50"
                          }`}
                          onClick={() => {
                            setTypeFilter(opt.id as typeof typeFilter);
                            setFilterMenuOpen(false);
                          }}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>

                {/* Sort toggle (date asc / desc) */}
                <button
                  type="button"
                  onClick={() => setSortDir((d) => (d === "asc" ? "desc" : "asc"))}
                  title={`Sort by date — ${sortDir === "asc" ? "newest last" : "newest first"}`}
                  aria-label="Toggle sort direction"
                  className="inline-flex items-center gap-1 rounded border border-slate-200 bg-white px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                >
                  {sortDir === "asc" ? (
                    <ArrowUp01 className="h-3.5 w-3.5" aria-hidden />
                  ) : (
                    <ArrowDown01 className="h-3.5 w-3.5" aria-hidden />
                  )}
                  <span className="hidden sm:inline">
                    {sortDir === "asc" ? "Oldest first" : "Newest first"}
                  </span>
                </button>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <div
                  className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-0.5 text-[11px] font-semibold text-slate-800"
                  aria-label="Vacation balance"
                  title={`Vacation balance · ${formatHoursMinutes(Math.round(ptoStrip.vacH * 60))} (${ptoStrip.vacD.toFixed(1)} days @ ${ptoStrip.dayHours}h/day)`}
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-indigo-500" aria-hidden />
                  Vacation
                  <span className="tabular-nums text-slate-700">
                    {ptoBalancesLoading
                      ? "—"
                      : formatHoursMinutes(Math.round(ptoStrip.vacH * 60))}
                  </span>
                </div>
                <div
                  className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-0.5 text-[11px] font-semibold text-slate-800"
                  aria-label="Sick balance"
                  title={`Sick balance · ${formatHoursMinutes(Math.round(ptoStrip.sickH * 60))} (${ptoStrip.sickD.toFixed(1)} days @ ${ptoStrip.dayHours}h/day)`}
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden />
                  Sick
                  <span className="tabular-nums text-slate-700">
                    {ptoBalancesLoading
                      ? "—"
                      : formatHoursMinutes(Math.round(ptoStrip.sickH * 60))}
                  </span>
                </div>
              </div>
              <Link
                href={`/users/${subjectEmployeeId}`}
                className="mt-1 inline-block text-xs font-medium text-slate-600 underline decoration-slate-300 underline-offset-2 hover:text-slate-900"
              >
                User profile
              </Link>
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {statusPill ? (
              <span
                className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 ${statusPillClass}`}
                title="Timesheet status (aggregate across this period)"
              >
                {statusPill.label}
              </span>
            ) : null}
            {filterActive ? (
              <span
                className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-700 ring-1 ring-slate-200/80"
                title="Filter is active — totals above still reflect the full period"
              >
                {displayRowCount} of {totalRowCount}
              </span>
            ) : null}
            {canManageTimeEntries && roster.length > 0 ? (
              <div className="relative" ref={addMenuRef}>
                <button
                  type="button"
                  onClick={() => setAddMenuOpen((o) => !o)}
                  className="inline-flex items-center gap-1.5 rounded-md border border-orange-400/60 bg-gradient-to-br from-orange-500 to-red-600 px-3 py-1.5 text-xs font-bold uppercase tracking-wide text-white shadow-sm transition-shadow hover:shadow-md focus:outline-none focus:ring-2 focus:ring-orange-500/40"
                  aria-expanded={addMenuOpen}
                  aria-haspopup="menu"
                >
                  Add time entry
                  <ChevronDown className="h-3.5 w-3.5 opacity-90" aria-hidden />
                </button>
                {addMenuOpen ? (
                  <div
                    role="menu"
                    className="absolute right-0 z-[105] mt-1 min-w-[11rem] rounded-lg border border-slate-200 bg-white py-1 shadow-lg"
                  >
                    <button
                      type="button"
                      role="menuitem"
                      className="block w-full px-3 py-2 text-left text-xs font-medium text-slate-700 hover:bg-slate-50"
                      onClick={() => {
                        setAddMenuOpen(false);
                        const today = new Date();
                        const y = today.getFullYear();
                        const m = String(today.getMonth() + 1).padStart(2, "0");
                        const d = String(today.getDate()).padStart(2, "0");
                        setAddShiftDayYmd(`${y}-${m}-${d}`);
                        setAddShiftErr(null);
                        setAddShiftOpen(true);
                      }}
                      title="Add a shift entry to the timesheet"
                    >
                      Add shift
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      className="block w-full px-3 py-2 text-left text-xs font-medium text-slate-700 hover:bg-slate-50"
                      onClick={() => {
                        setAddMenuOpen(false);
                        const today = new Date();
                        const y = today.getFullYear();
                        const m = String(today.getMonth() + 1).padStart(2, "0");
                        const d = String(today.getDate()).padStart(2, "0");
                        setTimeOffDefaultDayYmd(`${y}-${m}-${d}`);
                        setTimeOffDefaultType("PTO");
                        setTimeOffOpen(true);
                      }}
                    >
                      Add time off
                    </button>
                  </div>
                ) : null}
              </div>
            ) : (
              <button
                type="button"
                disabled
                title="Requires time clock management permission"
                className="rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 opacity-60"
              >
                Add
              </button>
            )}
            <button
              type="button"
              disabled
              title="Export — coming soon"
              className="rounded border border-slate-300 bg-white p-1.5 text-slate-600 opacity-60"
              aria-label="Export"
            >
              <Download className="h-4 w-4" />
            </button>
          </div>
        </div>

        {historicalNotice ? (
          <div className="shrink-0 border-b border-amber-200 bg-amber-50 px-5 py-2 text-xs font-medium text-amber-900">
            <span className="mr-2 inline-flex items-center gap-1.5">
              <CalendarDays className="h-3.5 w-3.5" aria-hidden />
              {historicalNotice}
            </span>
            <span className="text-amber-800/80">
              Pick today in the calendar to return to the live view.
            </span>
          </div>
        ) : null}

        {/* Exact Top Header Layout (Connecteam-style math) */}
        <div className="shrink-0 border-b border-slate-200 bg-white px-5 py-4 text-sm leading-relaxed">
          <div className="flex flex-col gap-2">
            <div className="text-sm">
              <span className="font-bold tabular-nums text-slate-900">
                {formatHoursMinutes(totalWorkedM)}
              </span>{" "}
              <span className="text-slate-500">Regular</span>
              <span className="mx-2 text-slate-300">+</span>
              <span className="font-semibold tabular-nums text-slate-900">
                {formatHoursMinutes(timeOffPaidM)}
              </span>{" "}
              <span className="text-slate-500">Paid time off</span>
              <span className="mx-2 text-slate-300">=</span>
              <span className="font-extrabold tabular-nums text-slate-900">
                {formatHoursMinutes(totalPaidM)}
              </span>{" "}
              <span className="text-slate-500">Total Paid Hours</span>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
              <span>
                <span className="font-semibold tabular-nums text-slate-900">{workedDays}</span>{" "}
                <span className="text-slate-500">Worked Days</span>
              </span>
              <span className="text-slate-300">|</span>
              <span>
                <span className="font-semibold tabular-nums text-slate-900">
                  {formatHoursMinutes(meta.timeOffUnpaidM ?? 0)}
                </span>{" "}
                <span className="text-slate-500">Unpaid time off</span>
              </span>
            </div>
          </div>
        </div>

        {/* CRITICAL: Horizontal scrolling container for 13-column layout */}
        <div className="min-h-0 flex-1 overflow-auto">
          <div className="w-full overflow-x-auto">
            <table className="w-full min-w-[104rem] table-fixed border-collapse text-left text-sm text-slate-800">
              <colgroup>
                <col className="w-[8.5rem]" />
                <col className="w-[7.5rem]" />
                <col className="w-[14rem]" />
                <col className="w-[6rem]" />
                <col className="w-[6rem]" />
                <col className="w-[7.5rem]" />
                <col className="w-[7.5rem]" />
                <col className="w-[7.5rem]" />
                <col className="w-[7.5rem]" />
                <col className="w-[7.5rem]" />
                <col className="w-[14rem]" />
                <col className="w-[16rem]" />
                <col className="w-[16rem]" />
              </colgroup>
              <thead>
              <tr className={theadCls}>
                <th className={`${thPad} ${cellBorder}`}>Date</th>
                <th className={`${thPad} ${cellBorder}`}>Type</th>
                <th className={`${thPad} ${cellBorder}`}>Job role</th>
                <th className={`${thPad} ${cellBorder}`}>Start</th>
                <th className={`${thPad} ${cellBorder}`}>End</th>
                <th className={`${thPad} ${cellBorder}`}>Total hours</th>
                <th className={`${thPad} ${cellBorder}`}>Daily total</th>
                <th className={`${thPad} ${cellBorder}`}>Scheduled</th>
                <th className={`${thPad} ${cellBorder}`}>Difference</th>
                <th className={`${thPad} ${cellBorder}`}>Weekly total</th>
                <th className={`${thPad} ${cellBorder}`}>Leave Hours</th>
                <th className={`${thPad} ${cellBorder}`}>Leave Type</th>
                <th className={`${thPad} ${cellBorder}`}>Employee Notes</th>
                <th className={`${thPad} ${cellBorder}`}>Manager Notes</th>
              </tr>
              </thead>
              <tbody>
              {weekBlocks.length === 0 ? (
                <tr>
                  <td
                    colSpan={14}
                    className="px-5 py-10 text-center text-sm text-slate-500"
                  >
                    {totalRowCount === 0 ? (
                      <>
                        No time entries in this period.
                        {canManageTimeEntries ? " Use Add to log a shift or time off." : ""}
                      </>
                    ) : (
                      <>
                        No entries match the current filter.{" "}
                        <button
                          type="button"
                          onClick={() => setTypeFilter("all")}
                          className="font-semibold text-orange-700 underline-offset-2 hover:underline"
                        >
                          Clear filter
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ) : null}
              {weekBlocks.map((block) => {
                const rangeLabel = shortDateRangeLabel(block.rangeStart, block.rangeEndInclusive);
                const bandTitle = block.weekIndexLabel
                  ? `${block.weekIndexLabel} · ${rangeLabel}`
                  : rangeLabel;
                const weekMinutes = block.rows.reduce((sum, r) => sum + (punchMinutes(r) ?? 0), 0);
                return (
                  <Fragment key={block.key}>
                    <tr className="bg-slate-200/90">
                      <td
                        colSpan={14}
                        className="px-5 py-2.5 text-sm font-bold text-slate-800"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span>{bandTitle}</span>
                          <span className="font-mono tabular-nums text-slate-900">
                            {formatHoursMinutes(weekMinutes)}
                          </span>
                        </div>
                      </td>
                    </tr>
                    {block.rows.map((r, idx) => {
                      const dk = localDayKey(r.clockInAt);
                      const daySum = dk ? (byDay.get(dk) ?? 0) : 0;
                      const isLast = idx === block.rows.length - 1;
                      const isSelf = Boolean(viewerEmployeeId && viewerEmployeeId === subjectEmployeeId);
                      const approvedLeave =
                        dk && timeOffRecords.length > 0
                          ? timeOffRecords.find(
                              (rec) =>
                                rec.employee_id === subjectEmployeeId &&
                                overlapsLocalDay(rec.start_at, rec.end_at, dk),
                            ) ?? null
                          : null;
                      const pendingLeave =
                        dk && pendingTimeOffRequests.length > 0
                          ? pendingTimeOffRequests.find(
                              (pr) =>
                                pr.employeeId === subjectEmployeeId &&
                                overlapsLocalDay(pr.startAt, pr.endAt, dk),
                            ) ?? null
                          : null;
                      const typeLabel =
                        r.hasRealTimeEntry === false && r.ptoLabel !== "—"
                          ? "Time off"
                          : r.shiftTypeLabel === "—"
                            ? "—"
                            : "Shift";
                      return (
                        <tr key={r.id} className="bg-white hover:bg-slate-50/90">
                          <td className={`${cellBorder} ${tdPad} whitespace-nowrap font-semibold text-slate-900`}>
                            {formatDayHeader(r.clockInAt)}
                          </td>
                          <td className={`${cellBorder} ${tdPad}`}>
                            <span className="inline-flex items-center rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-sm font-medium text-slate-800">
                              {typeLabel}
                            </span>
                          </td>
                          <td className={`${cellBorder} ${tdPad}`}>
                            <div className="relative w-full min-w-0">
                              <div
                                className={`flex min-h-[2.75rem] w-full items-center justify-between gap-2 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm shadow-sm ${
                                  canEditJob ? "hover:border-slate-400" : "opacity-90"
                                }`}
                              >
                                <div className="flex min-h-[2.25rem] min-w-0 flex-1 items-center justify-center px-0.5">
                                  <span
                                    className={`inline-flex max-w-full items-center justify-center whitespace-nowrap rounded px-3 py-1.5 text-center text-sm font-medium leading-snug ring-1 ${jobPillClass(r.jobTone)}`}
                                  >
                                    {jobOverrides[r.id] ?? (r.employeeRole as PositionRoleValue)}
                                  </span>
                                </div>
                                <ChevronDown
                                  className={`h-4 w-4 shrink-0 self-center ${
                                    canEditJob ? "text-slate-400" : "text-slate-300"
                                  }`}
                                  aria-hidden
                                />
                              </div>
                              <select
                                aria-label="Job role"
                                disabled={!canEditJob}
                                value={jobOverrides[r.id] ?? (r.employeeRole as PositionRoleValue)}
                                onChange={(e) =>
                                  setJobOverrides((prev) => ({
                                    ...prev,
                                    [r.id]: e.target.value as PositionRoleValue,
                                  }))
                                }
                                className="absolute inset-0 h-full w-full cursor-pointer rounded-md bg-transparent opacity-0 disabled:cursor-not-allowed"
                              >
                                {POSITION_ROLE_OPTIONS.map((opt) => (
                                  <option key={opt} value={opt}>
                                    {opt}
                                  </option>
                                ))}
                              </select>
                            </div>
                          </td>
                          <td className={`${cellBorder} ${tdPad} whitespace-nowrap font-semibold text-emerald-700`}>
                            <PunchTimeDisplay iso={r.clockInAt} variant="time" />
                          </td>
                          <td className={`${cellBorder} ${tdPad} whitespace-nowrap font-semibold text-slate-500`}>
                            <PunchTimeDisplay iso={r.clockOutAt} variant="time" />
                          </td>
                          <td className={`${cellBorder} ${tdPad} font-mono text-sm tabular-nums text-slate-800`}>
                            {r.dailyTotalLabel}
                          </td>
                          <td className={`${cellBorder} ${tdPad} font-mono text-sm font-bold tabular-nums text-slate-900`}>
                            {formatHoursMinutes(daySum)}
                          </td>
                          <td
                            className={`${cellBorder} ${tdPad} whitespace-nowrap text-sm tabular-nums text-slate-700`}
                            title={r.scheduleLabel ?? undefined}
                          >
                            {r.scheduledDurationLabel ?? r.scheduleLabel ?? (
                              <span className="text-slate-400">—</span>
                            )}
                          </td>
                          <td
                            className={`${cellBorder} ${tdPad} font-mono text-sm font-bold tabular-nums ${
                              r.scheduleVarianceMinutes != null && r.scheduleVarianceMinutes < 0
                                ? "text-red-600"
                                : "text-slate-800"
                            }`}
                          >
                            {formatSignedVarianceMinutes(r.scheduleVarianceMinutes)}
                          </td>
                          <td className={`${cellBorder} ${tdPad} text-right font-mono text-sm font-bold tabular-nums text-slate-900`}>
                            {isLast ? formatHoursMinutes(weekMinutes) : ""}
                          </td>
                          <td className={`${cellBorder} ${tdPad}`}>
                            <input
                              type="text"
                              inputMode="decimal"
                              placeholder=""
                              value={leaveHoursByEntryId[r.id] ?? ""}
                              onChange={(e) =>
                                setLeaveHoursByEntryId((prev) => ({ ...prev, [r.id]: e.target.value }))
                              }
                              className="h-10 w-full rounded-md border border-slate-200 bg-white px-2 text-sm font-semibold tabular-nums text-slate-900"
                            />
                          </td>
                          <td className={`${cellBorder} ${tdPad}`}>
                            <div className="flex flex-col gap-1.5">
                              <select
                                value={leaveTypeByEntryId[r.id] ?? ""}
                                onChange={(e) =>
                                  setLeaveTypeByEntryId((prev) => ({
                                    ...prev,
                                    [r.id]: (e.target.value as "Vacation" | "Sick" | ""),
                                  }))
                                }
                                className="h-10 w-full rounded-md border border-slate-200 bg-white px-2 text-sm font-semibold text-slate-900"
                              >
                                <option value="">—</option>
                                <option value="Vacation">Vacation</option>
                                <option value="Sick">Sick</option>
                              </select>
                              {approvedLeave ? (
                                <span className="inline-flex w-fit items-center justify-center rounded-md bg-emerald-600 px-2 py-0.5 text-[11px] font-semibold text-white">
                                  Approved
                                </span>
                              ) : pendingLeave ? (
                                <div className="flex flex-col gap-1">
                                  <span className="inline-flex w-fit items-center justify-center rounded-md bg-orange-100 px-2 py-0.5 text-[11px] font-semibold text-orange-900 ring-1 ring-orange-200">
                                    Pending
                                  </span>
                                  {canManageTimeEntries && locationId ? (
                                    <div className="flex flex-wrap gap-1.5">
                                      <button
                                        type="button"
                                        disabled={leaveActionPending}
                                        className="rounded-md bg-emerald-600 px-2 py-0.5 text-[11px] font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                                        onClick={async () => {
                                          setLeaveActionErr(null);
                                          setLeaveActionPending(true);
                                          const res = await approveTimeOffRequest(pendingLeave.id, locationId);
                                          setLeaveActionPending(false);
                                          if (!res.ok) {
                                            setLeaveActionErr(res.error);
                                            return;
                                          }
                                          onPunchAdjusted?.();
                                        }}
                                      >
                                        Approve
                                      </button>
                                      <button
                                        type="button"
                                        disabled={leaveActionPending}
                                        className="rounded-md border border-slate-300 bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-50"
                                        onClick={async () => {
                                          setLeaveActionErr(null);
                                          setLeaveActionPending(true);
                                          const res = await denyTimeOffRequest(pendingLeave.id, locationId);
                                          setLeaveActionPending(false);
                                          if (!res.ok) {
                                            setLeaveActionErr(res.error);
                                            return;
                                          }
                                          onPunchAdjusted?.();
                                        }}
                                      >
                                        Deny
                                      </button>
                                    </div>
                                  ) : null}
                                </div>
                              ) : isSelf && dk ? (
                                <button
                                  type="button"
                                  disabled={leaveActionPending}
                                  className="w-fit rounded-md bg-slate-900 px-2 py-0.5 text-[11px] font-semibold text-white hover:bg-slate-950 disabled:opacity-50"
                                  onClick={async () => {
                                    setLeaveActionErr(null);
                                    const rawH = (leaveHoursByEntryId[r.id] ?? "").trim();
                                    const hours = rawH ? Number(rawH) : NaN;
                                    const lt = leaveTypeByEntryId[r.id] ?? "";
                                    if (!Number.isFinite(hours) || hours <= 0) {
                                      setLeaveActionErr("Enter leave hours.");
                                      return;
                                    }
                                    if (!lt) {
                                      setLeaveActionErr("Select leave type.");
                                      return;
                                    }
                                    if (!locationId?.trim()) {
                                      setLeaveActionErr("Missing store context.");
                                      return;
                                    }
                                    const startIso = dateYmdToLocalDayStartIso(dk);
                                    if (!startIso) {
                                      setLeaveActionErr("Invalid date.");
                                      return;
                                    }
                                    const endIso = new Date(Date.parse(startIso) + hours * 3600000).toISOString();
                                    const type = lt === "Vacation" ? "PTO" : "Sick leave";
                                    setLeaveActionPending(true);
                                    const res = await requestEmployeeTimeOff({
                                      locationId: locationId.trim(),
                                      employeeId: subjectEmployeeId,
                                      timeOffType: type,
                                      allDay: false,
                                      startAtIso: startIso,
                                      endAtIso: endIso,
                                      totalHours: String(hours),
                                      daysOfLeave: "",
                                      employeeNotes: (employeeNotesByEntryId[r.id] ?? "").trim() || null,
                                    });
                                    setLeaveActionPending(false);
                                    if (!res.ok) {
                                      setLeaveActionErr(res.error);
                                      return;
                                    }
                                    onPunchAdjusted?.();
                                  }}
                                >
                                  Request
                                </button>
                              ) : null}
                              {leaveActionErr ? (
                                <p className="text-[11px] text-red-700">{leaveActionErr}</p>
                              ) : null}
                            </div>
                          </td>
                          <td
                            className={`${cellBorder} ${tdPad} border-l-4 border-slate-300`}
                          >
                            <textarea
                              value={employeeNotesByEntryId[r.id] ?? ""}
                              onChange={(e) =>
                                setEmployeeNotesByEntryId((prev) => ({ ...prev, [r.id]: e.target.value }))
                              }
                              rows={2}
                              placeholder="—"
                              className="w-full resize-none rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-800 placeholder:text-slate-400"
                            />
                          </td>
                          <td className={`${cellBorder} ${tdPad}`}>
                            <textarea
                              value={managerNotesByEntryId[r.id] ?? ""}
                              onChange={(e) =>
                                setManagerNotesByEntryId((prev) => ({ ...prev, [r.id]: e.target.value }))
                              }
                              rows={2}
                              placeholder={canManageTimeEntries ? "Add manager note…" : "—"}
                              disabled={!canManageTimeEntries}
                              className="w-full resize-none rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-800 placeholder:text-slate-400 disabled:bg-slate-50 disabled:text-slate-500"
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </Fragment>
                );
              })}
              </tbody>
            </table>
          </div>
        </div>

        {adjustTarget && locationId ? (
          <div
            className="fixed inset-0 z-[130] flex items-center justify-center bg-slate-900/50 p-4"
            role="dialog"
            aria-modal="true"
            aria-labelledby="adjust-time-entry-title"
            onClick={() => {
              if (!adjustPending) setAdjustTarget(null);
            }}
          >
            <div
              className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-5 shadow-e3"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 id="adjust-time-entry-title" className="text-lg font-semibold text-slate-900">
                Fix clock-in/out time
              </h3>
              <p className="mt-1 text-xs text-slate-500">
                Approval is cleared until re-approved. A short reason is required for audit.
              </p>
              <div className="mt-4 space-y-3">
                <label className="block text-xs font-medium text-slate-700">
                  Clock-in time
                  <input
                    type="datetime-local"
                    value={adjustIn}
                    onChange={(e) => setAdjustIn(e.target.value)}
                    className="mt-1 w-full rounded-md border border-slate-200 px-2 py-2 text-sm text-slate-800"
                    disabled={adjustPending}
                  />
                </label>
                <label className="block text-xs font-medium text-slate-700">
                  Clock-out time{" "}
                  {!adjustTarget.clockOutAt ? (
                    <span className="font-normal text-slate-400">(leave empty if still open)</span>
                  ) : null}
                  <input
                    type="datetime-local"
                    value={adjustOut}
                    onChange={(e) => setAdjustOut(e.target.value)}
                    className="mt-1 w-full rounded-md border border-slate-200 px-2 py-2 text-sm text-slate-800"
                    disabled={adjustPending}
                  />
                </label>
                <label className="block text-xs font-medium text-slate-700">
                  Reason
                  <textarea
                    value={adjustReason}
                    onChange={(e) => setAdjustReason(e.target.value)}
                    rows={3}
                    placeholder="Why are these times changing?"
                    className="mt-1 w-full rounded-md border border-slate-200 px-2 py-2 text-sm text-slate-800 placeholder:text-slate-400"
                    disabled={adjustPending}
                  />
                </label>
              </div>
              {adjustErr ? <p className="mt-2 text-sm text-red-600">{adjustErr}</p> : null}
              <div className="mt-4 flex justify-end gap-2">
                <button
                  type="button"
                  disabled={adjustPending}
                  onClick={() => setAdjustTarget(null)}
                  className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={adjustPending}
                  onClick={() => {
                    void (async () => {
                      if (!adjustTarget || !locationId) return;
                      setAdjustErr(null);
                      const inIso = datetimeLocalValueToIso(adjustIn);
                      if (!inIso) {
                        setAdjustErr("Clock-in time is invalid.");
                        return;
                      }
                      let clockOutAt: string | undefined;
                      if (adjustOut.trim()) {
                        const o = datetimeLocalValueToIso(adjustOut);
                        if (!o) {
                          setAdjustErr("Clock-out time is invalid.");
                          return;
                        }
                        clockOutAt = o;
                      }
                      const reason = adjustReason.trim();
                      if (reason.length < 3) {
                        setAdjustErr("Reason must be at least 3 characters.");
                        return;
                      }
                      setAdjustPending(true);
                      const res = await adjustTimeEntry({
                        entryId: adjustTarget.id,
                        locationId,
                        clockInAt: inIso,
                        clockOutAt,
                        editReason: reason,
                      });
                      setAdjustPending(false);
                      if (!res.ok) {
                        setAdjustErr(res.error);
                        return;
                      }
                      setAdjustTarget(null);
                      onPunchAdjusted?.();
                    })();
                  }}
                  className="rounded-lg bg-orange-600 px-3 py-2 text-sm font-semibold text-white hover:bg-orange-700 disabled:opacity-50"
                >
                  {adjustPending ? "Saving…" : "Save"}
                </button>
              </div>
            </div>
          </div>
        ) : null}

        <TimeOffRequestSidebar
          open={timeOffOpen}
          onClose={() => setTimeOffOpen(false)}
          defaultEmployeeId={subjectEmployeeId}
          defaultEmployeeName={headerEmployee.employeeName}
          storeEmployees={roster}
          locationId={locationId}
          onSaved={onPunchAdjusted}
          defaultDayYmd={timeOffDefaultDayYmd}
          defaultTimeOffType={timeOffDefaultType}
        />

        {addShiftOpen ? (
          <div
            className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-900/50 p-4"
            role="dialog"
            aria-modal="true"
            aria-labelledby="add-shift-title"
            onClick={() => {
              if (!addShiftPending) setAddShiftOpen(false);
            }}
          >
            <div
              className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-5 shadow-e3"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 id="add-shift-title" className="text-sm font-semibold text-slate-900">
                    Add shift
                  </h3>
                  <p className="mt-1 text-xs text-slate-500">
                    Adds a closed timesheet entry (manager edit).
                  </p>
                </div>
                <button
                  type="button"
                  className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                  onClick={() => setAddShiftOpen(false)}
                  disabled={addShiftPending}
                >
                  Close
                </button>
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                <label className="sm:col-span-1">
                  <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Date
                  </span>
                  <input
                    type="date"
                    value={addShiftDayYmd}
                    onChange={(e) => setAddShiftDayYmd(e.target.value)}
                    className="mt-1 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-900"
                    disabled={addShiftPending}
                  />
                </label>
                <label className="sm:col-span-1">
                  <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Start
                  </span>
                  <input
                    type="time"
                    value={addShiftStartHm}
                    onChange={(e) => setAddShiftStartHm(e.target.value)}
                    className="mt-1 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-900"
                    disabled={addShiftPending}
                  />
                </label>
                <label className="sm:col-span-1">
                  <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    End
                  </span>
                  <input
                    type="time"
                    value={addShiftEndHm}
                    onChange={(e) => setAddShiftEndHm(e.target.value)}
                    className="mt-1 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-900"
                    disabled={addShiftPending}
                  />
                </label>
              </div>

              {addShiftErr ? (
                <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                  {addShiftErr}
                </p>
              ) : null}

              <div className="mt-4 flex justify-end gap-2">
                <button
                  type="button"
                  className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-60"
                  disabled={addShiftPending}
                  onClick={() => setAddShiftOpen(false)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-950 disabled:opacity-60"
                  disabled={addShiftPending}
                  onClick={async () => {
                    setAddShiftErr(null);
                    if (!locationId?.trim()) {
                      setAddShiftErr("Missing store context.");
                      return;
                    }
                    if (!timeClockId?.trim()) {
                      setAddShiftErr("Missing time clock context.");
                      return;
                    }
                    if (!/^\d{4}-\d{2}-\d{2}$/.test(addShiftDayYmd)) {
                      setAddShiftErr("Pick a date.");
                      return;
                    }
                    if (!/^\d{2}:\d{2}$/.test(addShiftStartHm) || !/^\d{2}:\d{2}$/.test(addShiftEndHm)) {
                      setAddShiftErr("Enter start and end times.");
                      return;
                    }

                    const startIso = new Date(`${addShiftDayYmd}T${addShiftStartHm}:00`).toISOString();
                    const endIso = new Date(`${addShiftDayYmd}T${addShiftEndHm}:00`).toISOString();

                    setAddShiftPending(true);
                    const res = await createManagerShiftEntry({
                      employeeId: first.employeeId,
                      locationId,
                      timeClockId,
                      startAtIso: startIso,
                      endAtIso: endIso,
                    });
                    setAddShiftPending(false);
                    if (!res.ok) {
                      setAddShiftErr(res.error);
                      return;
                    }
                    setAddShiftOpen(false);
                    onPunchAdjusted?.();
                  }}
                >
                  {addShiftPending ? "Adding…" : "Add"}
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
