"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { autoAssignJobsForWeek, copyPreviousWeekShifts, publishDraftShiftsForWeek } from "@/app/actions/schedule";
import { formatWeekQueryParam, mondayOfWeekContaining } from "@/lib/schedule/week";
import {
  AddShiftModal,
  type ScheduleEmployeeOption,
  type ScheduleLocationOption,
} from "@/components/schedule/add-shift-modal";
import { AddUnavailabilityModal } from "@/components/schedule/add-unavailability-modal";
import { ScheduleBoardCalendarPopover } from "@/components/schedule/schedule-board-calendar-popover";
import { ScheduleCellHoverActions } from "@/components/schedule/schedule-cell-hover-actions";
import { sameCalendarDay, toYmdLocal } from "@/components/schedule/schedule-board-format";
import {
  buildDayColumns,
  draftPublishCount,
  filterShiftsQuery,
  formatHoursClock,
  jobRowsForSection,
  type ShiftForBoard,
  sectionTotals,
  uniqueGroupSections,
  weekTotals,
} from "@/lib/schedule/board-model";
import {
  Bell,
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  Copy,
  Filter,
  Loader2,
  Search,
  Users,
  X,
} from "lucide-react";

const ScheduleBoardListView = dynamic(
  () =>
    import("@/components/schedule/schedule-board-list-view").then((m) => ({
      default: m.ScheduleBoardListView,
    })),
  { loading: () => null },
);

const ScheduleBoardJobGridRows = dynamic(
  () =>
    import("@/components/schedule/schedule-board-job-grid").then((m) => ({
      default: m.ScheduleBoardJobGridRows,
    })),
  { loading: () => null },
);

const ScheduleBoardUserGridRows = dynamic(
  () =>
    import("@/components/schedule/schedule-board-user-grid").then((m) => ({
      default: m.ScheduleBoardUserGridRows,
    })),
  { loading: () => null },
);

function localMidnight(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function addLocalDays(d: Date, days: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + days);
  return x;
}

type Props = {
  weekMonday: Date;
  /** `YYYY-MM-DD` for the week’s Monday — sent to publish action. */
  weekParam: string;
  rangeLabel: string;
  prevWeekHref: string;
  nextWeekHref: string;
  todayWeekHref: string;
  viewRange: "day" | "week" | "month";
  selectedDate: Date;
  locationLabel: string;
  scopeAll: boolean;
  locationNamesById: Map<string, string>;
  shifts: ShiftForBoard[];
  publishDraftCount: number;
  canEditSchedule: boolean;
  employeesForPicker: ScheduleEmployeeOption[];
  locationsForPicker: ScheduleLocationOption[];
  jobsForPicker: { id: string; location_id: string; name: string }[];
  /** Resolved store when header is not “all locations”. */
  defaultLocationId: string | null;
  /** Open add modal once (e.g. from hub `?add=1`). */
  initialAddOpen?: boolean;
  /** Shifts in this week missing `job_id` (mock backfill helper). */
  missingJobCount: number;
  unavailability: {
    id: string;
    employee_id: string;
    location_id: string;
    start_at: string;
    end_at: string;
    reason: string | null;
  }[];
};

export function ScheduleWeekBoard({
  weekMonday,
  weekParam,
  rangeLabel,
  prevWeekHref,
  nextWeekHref,
  todayWeekHref,
  viewRange,
  selectedDate,
  locationLabel,
  scopeAll,
  locationNamesById,
  shifts: shiftsProp,
  publishDraftCount: publishFromServer,
  canEditSchedule,
  employeesForPicker,
  locationsForPicker,
  jobsForPicker,
  defaultLocationId,
  initialAddOpen = false,
  missingJobCount,
  unavailability,
}: Props) {
  const unavailByEmployeeDay = useMemo(() => {
    const map = new Map<
      string,
      { id: string; reason: string | null; start_at: string; end_at: string }[]
    >();
    for (const u of unavailability) {
      const start = new Date(u.start_at);
      const end = new Date(u.end_at);
      if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) continue;
      if (end <= start) continue;

      // Attach to each local day that the block overlaps (handles multi-day unavailability).
      const cursor = localMidnight(start);
      const last = localMidnight(end);
      for (let i = 0; i < 32; i++) {
        const dayStart = addLocalDays(cursor, i);
        const dayEnd = addLocalDays(dayStart, 1);
        if (dayStart > last && dayStart > end) break;
        const overlaps = start < dayEnd && end > dayStart;
        if (!overlaps) continue;
        const key = `${u.employee_id}:${toYmdLocal(dayStart)}`;
        const prev = map.get(key) ?? [];
        prev.push({
          id: u.id,
          reason: u.reason ?? null,
          start_at: u.start_at,
          end_at: u.end_at,
        });
        map.set(key, prev);
      }
    }
    for (const [k, items] of map.entries()) {
      items.sort((a, b) => new Date(a.start_at).getTime() - new Date(b.start_at).getTime());
      map.set(k, items);
    }
    return map;
  }, [unavailability]);
  const router = useRouter();
  const [publishPending, startPublishTransition] = useTransition();
  const [deletePending, startDeleteTransition] = useTransition();
  const [fixJobsPending, startFixJobsTransition] = useTransition();
  const [copyPending, startCopyTransition] = useTransition();
  const [publishError, setPublishError] = useState<string | null>(null);
  const [copyError, setCopyError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState<boolean>(initialAddOpen && canEditSchedule);
  const [unavailOpen, setUnavailOpen] = useState(false);
  const [modalNonce, setModalNonce] = useState(0);
  const [editingShiftId, setEditingShiftId] = useState<string | null>(null);
  const [createSeed, setCreateSeed] = useState<
    | {
        locationId?: string;
        employeeIds?: string[];
        jobId?: string;
        start?: Date;
        end?: Date;
      }
    | null
  >(null);
  const [lastPickedDay, setLastPickedDay] = useState<Date | null>(null);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [sectionFilter, setSectionFilter] = useState("");
  const [sectionFilterOpen, setSectionFilterOpen] = useState(false);
  const sectionFilterRef = useRef<HTMLDivElement | null>(null);
  const [viewMode, setViewMode] = useState<"job" | "users" | "list">(() => {
    if (typeof window === "undefined") return "users";
    const mode = new URLSearchParams(window.location.search).get("mode");
    return mode === "users" || mode === "job" || mode === "list" ? mode : "users";
  });
  const [showDailyInfo, setShowDailyInfo] = useState(true);
  const [showWeeklySummary, setShowWeeklySummary] = useState(true);
  const [viewMenuOpen, setViewMenuOpen] = useState(false);
  const viewMenuRef = useRef<HTMLDivElement | null>(null);
  const [rangeMenuOpen, setRangeMenuOpen] = useState(false);
  const rangeMenuRef = useRef<HTMLDivElement | null>(null);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const calendarRef = useRef<HTMLDivElement | null>(null);
  const [calendarMonth, setCalendarMonth] = useState<Date>(
    () => new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1),
  );
  const [cellMenuKey, setCellMenuKey] = useState<string | null>(null);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!viewMenuRef.current?.contains(e.target as Node)) setViewMenuOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setViewMenuOpen(false);
    }
    if (viewMenuOpen) {
      document.addEventListener("click", onDocClick);
      document.addEventListener("keydown", onKey);
      return () => {
        document.removeEventListener("click", onDocClick);
        document.removeEventListener("keydown", onKey);
      };
    }
  }, [viewMenuOpen]);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!rangeMenuRef.current?.contains(e.target as Node)) setRangeMenuOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setRangeMenuOpen(false);
    }
    if (rangeMenuOpen) {
      document.addEventListener("click", onDocClick);
      document.addEventListener("keydown", onKey);
      return () => {
        document.removeEventListener("click", onDocClick);
        document.removeEventListener("keydown", onKey);
      };
    }
  }, [rangeMenuOpen]);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!calendarRef.current?.contains(e.target as Node)) setCalendarOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setCalendarOpen(false);
    }
    if (calendarOpen) {
      document.addEventListener("click", onDocClick);
      document.addEventListener("keydown", onKey);
      return () => {
        document.removeEventListener("click", onDocClick);
        document.removeEventListener("keydown", onKey);
      };
    }
  }, [calendarOpen]);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!sectionFilterRef.current?.contains(e.target as Node)) setSectionFilterOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setSectionFilterOpen(false);
    }
    if (sectionFilterOpen) {
      document.addEventListener("click", onDocClick);
      document.addEventListener("keydown", onKey);
      return () => {
        document.removeEventListener("click", onDocClick);
        document.removeEventListener("keydown", onKey);
      };
    }
  }, [sectionFilterOpen]);

  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput), 200);
    return () => clearTimeout(t);
  }, [searchInput]);

  const sectionFilterOptions = useMemo(
    () => uniqueGroupSections(shiftsProp).map((s) => s.name),
    [shiftsProp],
  );

  useEffect(() => {
    if (sectionFilter && !sectionFilterOptions.includes(sectionFilter)) {
      setSectionFilter("");
    }
  }, [sectionFilter, sectionFilterOptions]);

  const afterMutation = () => {
    router.replace(`/schedule/board?week=${encodeURIComponent(weekParam)}`);
    router.refresh();
  };
  const shifts = useMemo(() => {
    let list = filterShiftsQuery(shiftsProp, search);
    if (sectionFilter) list = list.filter((s) => s.groupName === sectionFilter);
    return list;
  }, [shiftsProp, search, sectionFilter]);

  const setModeInUrl = (mode: "users" | "job" | "list") => {
    const params = new URLSearchParams(window.location.search);
    params.set("mode", mode);
    router.push(`/schedule/board?${params.toString()}`);
  };
  const listRows = useMemo(() => {
    const rows = [...shifts];
    rows.sort((a, b) => {
      const t = new Date(a.shift_start).getTime() - new Date(b.shift_start).getTime();
      if (t !== 0) return t;
      return (a.jobName ?? "").localeCompare(b.jobName ?? "");
    });
    return rows;
  }, [shifts]);
  const { columns } = buildDayColumns(weekMonday, shifts);
  const displayedColumns = useMemo(() => {
    if (viewRange !== "day") return columns;
    const idx = Math.max(
      0,
      Math.min(
        6,
        Math.floor((new Date(selectedDate).getTime() - weekMonday.getTime()) / 86400000),
      ),
    );
    return [columns[idx]];
  }, [columns, viewRange, selectedDate, weekMonday]);
  const sections = uniqueGroupSections(shifts);
  const totals = weekTotals(shifts);
  const topJobs = useMemo(() => {
    const byJob = new Map<string, number>();
    for (const s of shifts) {
      const key = s.jobName ?? "No job";
      byJob.set(key, (byJob.get(key) ?? 0) + (new Date(s.shift_end).getTime() - new Date(s.shift_start).getTime()) / 3600000);
    }
    return [...byJob.entries()]
      .map(([job, hours]) => ({ job, hours: Math.round(hours * 100) / 100 }))
      .sort((a, b) => b.hours - a.hours || a.job.localeCompare(b.job))
      .slice(0, 2);
  }, [shifts]);
  const publishCount = useMemo(() => draftPublishCount(shifts), [shifts]);
  const today = new Date();
  /** Prefer server count when search cleared so Publish matches full week */
  const publishN = search.trim() ? publishCount : publishFromServer;
  const editingShift = useMemo(
    () => shiftsProp.find((s) => s.id === editingShiftId) ?? null,
    [shiftsProp, editingShiftId],
  );

  const formatYmd = (d: Date) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  };

  const navigateToViewRange = (next: "day" | "week" | "month") => {
    const params = new URLSearchParams(window.location.search);
    params.set("view", next);
    if (next === "week") {
      const monday = mondayOfWeekContaining(selectedDate);
      params.set("week", formatWeekQueryParam(monday));
      params.delete("date");
    } else {
      params.set("date", formatYmd(selectedDate));
      params.delete("week");
    }
    router.push(`/schedule/board?${params.toString()}`);
    setRangeMenuOpen(false);
    setCalendarOpen(false);
  };

  const openCreateShift = (seed: {
    locationId?: string;
    employeeIds?: string[];
    jobId?: string;
    start?: Date;
    end?: Date;
  }) => {
    if (!canEditSchedule) return;
    setCellMenuKey(null);
    setRangeMenuOpen(false);
    if (seed.start) setLastPickedDay(new Date(seed.start));
    setEditingShiftId(null);
    setCreateSeed(seed);
    setModalNonce((n) => n + 1);
    setAddOpen(true);
  };

  const [unavailSeed, setUnavailSeed] = useState<{
    employeeId: string;
    employeeName: string;
    locationId: string;
    locationName: string;
    start: Date;
    end: Date;
  } | null>(null);

  const openUnavailability = (seed: {
    employeeId: string;
    employeeName: string;
    locationId: string;
    locationName: string;
    start: Date;
    end: Date;
  }) => {
    if (!canEditSchedule) return;
    setCellMenuKey(null);
    setRangeMenuOpen(false);
    setCalendarOpen(false);
    setUnavailSeed(seed);
    setModalNonce((n) => n + 1);
    setUnavailOpen(true);
  };

  const openUnavailabilityComingSoon = () => {
    window.alert("Pick an empty cell to add unavailability for a specific employee/date.");
  };
  const goTimeClockForTimeOff = () => {
    router.push("/time-clock");
  };

  /** Default day/time when opening the add-shift panel from an employee row (name column). */
  const defaultCreateWindowFromNameRow = () => {
    const dateForCell = displayedColumns[0]?.date ?? weekMonday;
    const start = new Date(dateForCell);
    start.setHours(9, 0, 0, 0);
    const end = new Date(dateForCell);
    end.setHours(17, 0, 0, 0);
    return { start, end };
  };

  const openSchedulePanelForEmployee = (emp: ScheduleEmployeeOption) => {
    if (!canEditSchedule) return;
    const { start, end } = defaultCreateWindowFromNameRow();
    openCreateShift({
      locationId: emp.location_id,
      employeeIds: [emp.id],
      start,
      end,
    });
  };

  return (
    <div className="min-h-0 space-y-3">
        {unavailSeed ? (
          <AddUnavailabilityModal
            key={`unavail-${modalNonce}`}
            open={unavailOpen}
            onClose={() => {
              setUnavailOpen(false);
              setUnavailSeed(null);
            }}
            employeeId={unavailSeed.employeeId}
            employeeName={unavailSeed.employeeName}
            locationId={unavailSeed.locationId}
            locationName={unavailSeed.locationName}
            start={unavailSeed.start}
            end={unavailSeed.end}
            onSuccess={() => router.refresh()}
          />
        ) : null}
        <AddShiftModal
          key={modalNonce}
          open={addOpen}
          onClose={() => {
            setAddOpen(false);
            setEditingShiftId(null);
            setCreateSeed(null);
          }}
          weekMonday={weekMonday}
          scopeAll={scopeAll}
          locations={locationsForPicker}
          defaultLocationId={defaultLocationId}
          employees={employeesForPicker}
          jobs={jobsForPicker}
          onSuccess={afterMutation}
          initialShift={editingShift}
          initialCreate={createSeed}
          contextUnavailability={unavailability}
          contextShifts={shiftsProp.map((s) => ({
            id: s.id,
            employee_id: s.employee_id,
            location_id: s.location_id,
            shift_start: s.shift_start,
            shift_end: s.shift_end,
            jobName: s.jobName,
            assignedEmployeeIds: s.assignedEmployeeIds,
            assignedEmployeeNames: s.assignedEmployeeNames,
            assignedLabel: s.assignedLabel,
          }))}
          modalKey={modalNonce}
        />

        {/* Toolbar — Connecteam-style */}
        <div className="flex flex-col gap-3 border-b border-slate-200 pb-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            {canEditSchedule ? (
              <Link href="/schedule" className="text-sm font-medium text-blue-600 hover:text-blue-800">
                ← Schedule hub
              </Link>
            ) : null}
            {canEditSchedule ? <span className="text-slate-300">|</span> : null}
            <h1 className="text-lg font-bold tracking-tight text-slate-900">Schedule</h1>
            <button
              type="button"
              className="flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-700"
            >
              Main schedule
              <span className="text-slate-400">▾</span>
            </button>
            {canEditSchedule ? (
              <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-500">
                Permissions
              </span>
            ) : null}
          </div>
          {canEditSchedule ? (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600"
              disabled
            >
              Requests
            </button>
            <button
              type="button"
              className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600"
              disabled
            >
              Job list
            </button>
            <button
              type="button"
              className="rounded-md border border-slate-200 bg-white p-2 text-slate-500"
              disabled
              aria-label="Settings"
            >
              ⚙
            </button>
          </div>
          ) : null}
        </div>

        <div className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2.5 shadow-sm sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative" ref={viewMenuRef}>
              <button
                type="button"
                className="rounded-md border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
                aria-haspopup="menu"
                aria-expanded={viewMenuOpen}
                onClick={() => setViewMenuOpen((v) => !v)}
              >
                View options <span className="text-slate-400">▾</span>
              </button>
              {viewMenuOpen ? (
                <div
                  role="menu"
                  className="absolute left-0 top-[calc(100%+6px)] z-20 w-64 rounded-xl border border-slate-200 bg-white p-2 shadow-lg"
                >
                  <button
                    type="button"
                    role="menuitem"
                    className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm ${
                      viewMode === "users" ? "bg-slate-100 text-slate-900" : "hover:bg-slate-50"
                    }`}
                    onClick={() => {
                      setViewMode("users");
                      setModeInUrl("users");
                      setViewMenuOpen(false);
                    }}
                  >
                    View by users
                    {viewMode === "users" ? <span className="text-xs text-slate-500">✓</span> : null}
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm ${
                      viewMode === "job" ? "bg-slate-100 text-slate-900" : "hover:bg-slate-50"
                    }`}
                    onClick={() => {
                      setViewMode("job");
                      setModeInUrl("job");
                      setViewMenuOpen(false);
                    }}
                  >
                    View by job
                    {viewMode === "job" ? <span className="text-xs text-slate-500">✓</span> : null}
                  </button>

                  <div className="my-2 border-t border-slate-100" />

                  <button
                    type="button"
                    role="menuitem"
                    className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm hover:bg-slate-50"
                    onClick={() => {
                      setViewMode("list");
                      setModeInUrl("list");
                      setViewMenuOpen(false);
                    }}
                  >
                    List view
                    {viewMode === "list" ? (
                      <span className="text-xs text-slate-500">✓</span>
                    ) : (
                      <span className="text-xs text-slate-400">→</span>
                    )}
                  </button>

                  <div className="my-2 border-t border-slate-100" />

                  <button
                    type="button"
                    role="menuitemcheckbox"
                    aria-checked={showDailyInfo}
                    className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm hover:bg-slate-50"
                    onClick={() => setShowDailyInfo((v) => !v)}
                  >
                    Daily info
                    <span className="text-xs text-slate-500">{showDailyInfo ? "On" : "Off"}</span>
                  </button>
                  <button
                    type="button"
                    role="menuitemcheckbox"
                    aria-checked={showWeeklySummary}
                    className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm hover:bg-slate-50"
                    onClick={() => setShowWeeklySummary((v) => !v)}
                  >
                    Weekly summary
                    <span className="text-xs text-slate-500">{showWeeklySummary ? "On" : "Off"}</span>
                  </button>
                </div>
              ) : null}
            </div>
            <div className="relative" ref={sectionFilterRef}>
            <button
              type="button"
              className={`rounded-md border bg-white p-1.5 ${
                sectionFilter
                  ? "border-blue-300 text-blue-700"
                  : "border-slate-200 text-slate-500 hover:bg-slate-50"
              }`}
              aria-label="Filter by schedule section"
              aria-expanded={sectionFilterOpen}
              aria-haspopup="menu"
              title={sectionFilter ? `Section: ${sectionFilter}` : "Filter by section"}
              onClick={() => setSectionFilterOpen((v) => !v)}
            >
              <Filter className="h-4 w-4" />
            </button>
            {sectionFilterOpen ? (
              <div
                role="menu"
                className="absolute left-0 top-[calc(100%+6px)] z-30 min-w-[12rem] rounded-xl border border-slate-200 bg-white p-2 shadow-lg"
              >
                <button
                  type="button"
                  role="menuitemradio"
                  aria-checked={!sectionFilter}
                  className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm ${
                    !sectionFilter ? "bg-slate-100 text-slate-900" : "hover:bg-slate-50"
                  }`}
                  onClick={() => {
                    setSectionFilter("");
                    setSectionFilterOpen(false);
                  }}
                >
                  All sections
                  {!sectionFilter ? <span className="text-xs text-slate-500">✓</span> : null}
                </button>
                {sectionFilterOptions.map((name) => (
                  <button
                    key={name}
                    type="button"
                    role="menuitemradio"
                    aria-checked={sectionFilter === name}
                    className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm ${
                      sectionFilter === name ? "bg-slate-100 text-slate-900" : "hover:bg-slate-50"
                    }`}
                    onClick={() => {
                      setSectionFilter(name);
                      setSectionFilterOpen(false);
                    }}
                  >
                    {name}
                    {sectionFilter === name ? (
                      <span className="text-xs text-slate-500">✓</span>
                    ) : null}
                  </button>
                ))}
              </div>
            ) : null}
            </div>
            <div className="relative" ref={rangeMenuRef}>
              <button
                type="button"
                className={`inline-flex h-9 items-center gap-2 rounded-full border px-4 text-xs font-semibold shadow-sm transition focus:outline-none focus:ring-2 focus:ring-blue-500/20 ${
                  viewRange !== "week"
                    ? "border-blue-200 bg-blue-50 text-blue-950 hover:bg-blue-100/60"
                    : "border-slate-200 bg-white text-slate-900 hover:bg-slate-50"
                }`}
                aria-haspopup="menu"
                aria-expanded={rangeMenuOpen}
                onClick={() => setRangeMenuOpen((v) => !v)}
              >
                {viewRange === "day" ? "Day" : viewRange === "month" ? "Month" : "Week"}
                <ChevronDown className="h-3.5 w-3.5 opacity-60" aria-hidden />
              </button>
              {rangeMenuOpen ? (
                <div
                  role="menu"
                  className="absolute left-0 top-[calc(100%+6px)] z-20 w-40 rounded-xl border border-slate-200 bg-white p-2 shadow-lg"
                >
                  <button
                    type="button"
                    role="menuitem"
                    className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm ${
                      viewRange === "day" ? "bg-slate-100 text-slate-900" : "hover:bg-slate-50"
                    }`}
                    onClick={() => navigateToViewRange("day")}
                  >
                    Day
                    {viewRange === "day" ? <span className="text-xs text-slate-500">✓</span> : null}
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm ${
                      viewRange === "week" ? "bg-slate-100 text-slate-900" : "hover:bg-slate-50"
                    }`}
                    onClick={() => navigateToViewRange("week")}
                  >
                    Week
                    {viewRange === "week" ? <span className="text-xs text-slate-500">✓</span> : null}
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm ${
                      viewRange === "month" ? "bg-slate-100 text-slate-900" : "hover:bg-slate-50"
                    }`}
                    onClick={() => navigateToViewRange("month")}
                  >
                    Month
                    {viewRange === "month" ? <span className="text-xs text-slate-500">✓</span> : null}
                  </button>
                </div>
              ) : null}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={prevWeekHref}
              className="inline-flex items-center rounded-md border border-slate-200 bg-white p-2 text-slate-700 hover:bg-slate-50"
              aria-label="Previous week"
            >
              <ChevronLeft className="h-4 w-4" />
            </Link>
            <ScheduleBoardCalendarPopover
              calendarRef={calendarRef}
              rangeLabel={rangeLabel}
              calendarOpen={calendarOpen}
              setCalendarOpen={setCalendarOpen}
              selectedDate={selectedDate}
              calendarMonth={calendarMonth}
              setCalendarMonth={setCalendarMonth}
              viewRange={viewRange}
              router={router}
              today={today}
            />
            <Link
              href={nextWeekHref}
              className="inline-flex items-center rounded-md border border-slate-200 bg-white p-2 text-slate-700 hover:bg-slate-50"
              aria-label="Next week"
            >
              <ChevronRight className="h-4 w-4" />
            </Link>
            <Link
              href={todayWeekHref}
              className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-800 hover:bg-slate-50"
            >
              Today
            </Link>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {canEditSchedule ? (
            <button
              type="button"
              className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700"
            >
              Actions <span className="text-slate-400">▾</span>
            </button>
            ) : null}
            {missingJobCount > 0 && canEditSchedule ? (
              <button
                type="button"
                className="rounded-md border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-950 hover:bg-amber-100 disabled:opacity-50"
                disabled={fixJobsPending}
                title="Assign default jobs to shifts missing a job"
                onClick={() => {
                  startFixJobsTransition(async () => {
                    const r = await autoAssignJobsForWeek(weekParam);
                    if (!r.ok) {
                      window.alert(r.error);
                      return;
                    }
                    router.refresh();
                  });
                }}
              >
                {fixJobsPending ? "Fixing…" : `Fix jobs (${missingJobCount})`}
              </button>
            ) : null}
            {canEditSchedule ? (
            <button
              type="button"
              className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
              title="Add a shift for this week"
              onClick={() => {
                const base =
                  lastPickedDay ??
                  (viewRange === "week" ? new Date(weekMonday) : new Date(selectedDate));
                base.setHours(9, 0, 0, 0);
                const end = new Date(base);
                end.setHours(17, 0, 0, 0);
                openCreateShift({
                  locationId: (!scopeAll && defaultLocationId) || locationsForPicker[0]?.id,
                  start: base,
                  end,
                });
              }}
            >
              Add <span className="text-slate-400">▾</span>
            </button>
            ) : null}
            {canEditSchedule ? (
            <button
              type="button"
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-transparent px-3 py-1.5 text-xs font-medium text-slate-700 shadow-none hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={scopeAll || !defaultLocationId || copyPending}
              title={
                scopeAll
                  ? "Select a single store in the header to copy shifts."
                  : "Copy last week's shifts into this week as drafts"
              }
              onClick={() => {
                if (scopeAll || !defaultLocationId) return;
                setCopyError(null);
                startCopyTransition(async () => {
                  const r = await copyPreviousWeekShifts(defaultLocationId, weekParam);
                  if (!r.ok) {
                    setCopyError(r.error);
                    return;
                  }
                  router.refresh();
                });
              }}
            >
              {copyPending ? (
                <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden />
              ) : (
                <Copy className="h-3.5 w-3.5 shrink-0 text-slate-500" aria-hidden />
              )}
              Copy Last Week
            </button>
            ) : null}
            {canEditSchedule ? (
            <button
              type="button"
              className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-blue-700 disabled:opacity-50"
              disabled={publishN === 0 || publishPending}
              title={publishN === 0 ? "No draft shifts to publish" : "Publish shifts to employees"}
              onClick={() => {
                if (publishN === 0) return;
                setPublishError(null);
                startPublishTransition(async () => {
                  const r = await publishDraftShiftsForWeek(weekParam);
                  if (!r.ok) {
                    setPublishError(r.error);
                    return;
                  }
                  router.refresh();
                });
              }}
            >
              {publishPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              ) : (
                <Bell className="h-3.5 w-3.5" />
              )}
              Publish ({publishN})
            </button>
            ) : null}
          </div>
        </div>

        <div className="space-y-1">
          {copyError ? (
            <p className="text-[11px] font-medium text-red-600" role="alert">
              {copyError}
            </p>
          ) : null}
          {publishError ? (
            <p className="text-[11px] font-medium text-red-600" role="alert">
              {publishError}
            </p>
          ) : null}
          {deleteError ? (
            <p className="text-[11px] font-medium text-red-600" role="alert">
              {deleteError}
            </p>
          ) : null}
        </div>

        <div>
        {viewMode === "list" ? (
          <ScheduleBoardListView listRows={listRows} />
        ) : (
          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
            {/* Row search + toggles */}
            <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-2 py-2">
              <div className="relative min-w-[200px] flex-1 max-w-md">
                <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                <input
                  type="search"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                  placeholder="Search shifts, jobs, people…"
                className="w-full rounded-lg border border-slate-200 bg-white py-1.5 pl-8 pr-9 text-xs text-slate-900 shadow-sm transition placeholder:text-slate-400 focus:border-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                />
              {searchInput.trim().length > 0 ? (
                <button
                  type="button"
                  onClick={() => setSearchInput("")}
                  className="absolute right-1.5 top-1/2 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-700"
                  aria-label="Clear search"
                  title="Clear search"
                >
                  <X className="h-4 w-4" aria-hidden />
                </button>
              ) : null}
              </div>
            <button
              type="button"
              className="inline-flex h-8 items-center rounded-full border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            >
                Labor &amp; Sales
              </button>
            <button
              type="button"
              onClick={() => setShowDailyInfo((v) => !v)}
              className={`inline-flex h-8 items-center rounded-full border px-3 text-xs font-semibold shadow-sm transition focus:outline-none focus:ring-2 focus:ring-blue-500/20 ${
                showDailyInfo
                  ? "border-slate-300 bg-slate-50 text-slate-900 hover:bg-slate-100/60"
                  : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
              }`}
              aria-pressed={showDailyInfo}
            >
              Daily info
              </button>
            {searchInput.trim().length > 0 || sectionFilter ? (
              <button
                type="button"
                onClick={() => {
                  setSearchInput("");
                  setSectionFilter("");
                }}
                className="inline-flex h-8 items-center rounded-full border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              >
                Clear all
              </button>
            ) : null}
            </div>

            <div className="min-w-[1100px]">
              {shifts.length === 0 ? (
                <div className="border-b border-slate-200 bg-slate-50/70 px-3 py-2 text-xs text-slate-600">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span>
                      No shifts for this range{search ? " (try clearing search)" : ""}. Add a shift to start scheduling.
                    </span>
                  </div>
                </div>
              ) : null}
              <div
                className="grid border-b border-slate-200 bg-slate-50/90"
                style={{ gridTemplateColumns: `200px repeat(${displayedColumns.length}, minmax(110px, 1fr))` }}
              >
                <div className="border-r border-slate-200 p-2" />
                {displayedColumns.map((col, di) => {
                  const isToday = sameCalendarDay(col.date, today);
                  return (
                    <div
                      key={di}
                      className={`border-r border-slate-200 p-2 text-center last:border-r-0 ${
                        isToday ? "bg-sky-100/80" : ""
                      }`}
                    >
                      <div className="text-xs font-semibold text-slate-900">
                        {col.labelShort} {col.labelDayNum}
                      </div>
                      {showDailyInfo ? (
                        <div className="mt-1.5 flex items-center justify-center gap-2 text-[10px] font-medium text-slate-600">
                          <span className="inline-flex items-center gap-0.5" title="Hours">
                            <Clock className="h-3 w-3 text-slate-400" />
                            {formatHoursClock(col.totalHours)}
                          </span>
                          <span className="text-slate-300">|</span>
                          <span className="inline-flex items-center gap-0.5" title="Shifts">
                            <CalendarDays className="h-3 w-3 text-slate-400" />
                            {col.shiftCount}
                          </span>
                          <span className="text-slate-300">|</span>
                          <span className="inline-flex items-center gap-0.5" title="Users">
                            <Users className="h-3 w-3 text-slate-400" />
                            {col.uniquePeople}
                          </span>
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>

              {shifts.length === 0 ? (
                <div className="border-b border-slate-100 bg-white">
                  {employeesForPicker.map((e) => (
                    <div
                      key={e.id}
                      className="grid border-b border-slate-100 last:border-b-0"
                      style={{
                        gridTemplateColumns: `200px repeat(${displayedColumns.length}, minmax(110px, 1fr))`,
                      }}
                    >
                      <div className="border-r border-slate-200 px-2 py-2">
                        {canEditSchedule ? (
                          <button
                            type="button"
                            className="w-full rounded-md px-1 py-0.5 text-left transition hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-400"
                            onClick={() => openSchedulePanelForEmployee(e)}
                            title="Add or edit shifts for this team member"
                          >
                            <div className="truncate text-[11px] font-semibold uppercase tracking-wide text-slate-700">
                              {e.full_name}
                            </div>
                          </button>
                        ) : (
                          <Link
                            href={`/users/${e.id}`}
                            className="block w-full rounded-md px-1 py-0.5 transition hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-400"
                            title="Open employee profile"
                          >
                            <div className="truncate text-[11px] font-semibold uppercase tracking-wide text-slate-700">
                              {e.full_name}
                            </div>
                          </Link>
                        )}
                      </div>
                      {displayedColumns.map((col, di) => {
                        const isToday = sameCalendarDay(col.date, today);
                        const start = new Date(col.date);
                        start.setHours(9, 0, 0, 0);
                        const end = new Date(col.date);
                        end.setHours(17, 0, 0, 0);
                        return (
                          <div
                            key={di}
                            className={`group relative min-h-[64px] border-r border-slate-100 p-1 last:border-r-0 ${
                              isToday ? "bg-sky-50/50" : ""
                            }`}
                          >
                            {canEditSchedule ? (
                              <ScheduleCellHoverActions
                                menuKey={`empty-${e.id}-${di}`}
                                openMenuKey={cellMenuKey}
                                setOpenMenuKey={setCellMenuKey}
                                onQuickAdd={() =>
                                  openCreateShift({
                                    locationId: e.location_id,
                                    employeeIds: [e.id],
                                    start,
                                    end,
                                  })
                                }
                                onTimeOff={goTimeClockForTimeOff}
                                onUnavailability={openUnavailabilityComingSoon}
                              />
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  ))}

                  {employeesForPicker.length === 0 ? (
                    <div className="px-4 py-10 text-center text-sm text-slate-600">
                      No active employees found for this location.
                    </div>
                  ) : null}

                  {canEditSchedule && !search.trim() ? (
                    <div className="px-4 py-4">
                      <button
                        type="button"
                        className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-700"
                        onClick={() => {
                          setEditingShiftId(null);
                          setModalNonce((n) => n + 1);
                          setAddOpen(true);
                        }}
                      >
                        Add shift
                      </button>
                    </div>
                  ) : null}
                </div>
              ) : (
              sections.map(({ name: section }) => {
                const st = sectionTotals(shifts, section);
                const jobs = jobRowsForSection(shifts, section);
                const inSection = shifts.filter((s) => s.groupName === section);
                const layerKey = inSection.find((s) => s.boardSectionLayerName)?.boardSectionLayerName;
                const metaExtras = [
                  ...new Set(inSection.flatMap((s) => s.extraLayerLabels)),
                ];
                const layerHint = layerKey ? `Layer · ${layerKey}` : null;
                return (
                  <div key={section} className="border-b border-slate-100 last:border-b-0">
                    {/* Hide section header when schedule is “all day” only. */}
                    {section !== "All day" ? (
                      <div className="flex flex-wrap items-center justify-between gap-2 bg-slate-100/90 px-3 py-2">
                        <div className="min-w-0">
                          <span className="block text-sm font-semibold text-slate-900">{section}</span>
                          {layerHint ? (
                            <span className="mt-0.5 block truncate text-[10px] font-medium text-slate-500">
                              {layerHint}
                            </span>
                          ) : null}
                          {metaExtras.length ? (
                            <span className="mt-0.5 block truncate text-[10px] text-slate-500">
                              {metaExtras.join(" · ")}
                            </span>
                          ) : null}
                        </div>
                        <span className="text-xs tabular-nums text-slate-600">
                          <span className="font-medium text-slate-800">{formatHoursClock(st.hours)}</span>
                          <span className="mx-1 text-slate-300">|</span>
                          {st.shiftCount} shifts
                          <span className="mx-1 text-slate-300">|</span>
                          {st.people} users
                        </span>
                      </div>
                    ) : null}
                    {viewMode === "job" ? (
                      <ScheduleBoardJobGridRows
                        section={section}
                        jobs={jobs}
                        shifts={shifts}
                        weekMonday={weekMonday}
                        displayedColumns={displayedColumns}
                        columns={columns}
                        viewRange={viewRange}
                        today={today}
                        canEditSchedule={canEditSchedule}
                        cellMenuKey={cellMenuKey}
                        setCellMenuKey={setCellMenuKey}
                        openCreateShift={openCreateShift}
                        goTimeClockForTimeOff={goTimeClockForTimeOff}
                        openUnavailabilityComingSoon={openUnavailabilityComingSoon}
                        deletePending={deletePending}
                        startDeleteTransition={startDeleteTransition}
                        afterMutation={afterMutation}
                        setDeleteError={setDeleteError}
                        setEditingShiftId={setEditingShiftId}
                        setPublishError={setPublishError}
                        setModalNonce={setModalNonce}
                        setAddOpen={setAddOpen}
                        scopeAll={scopeAll}
                        locationNamesById={locationNamesById}
                        defaultLocationId={defaultLocationId}
                        locationsForPicker={locationsForPicker}
                      />
                    ) : (
                      <ScheduleBoardUserGridRows
                        section={section}
                        employeesForPicker={employeesForPicker}
                        shifts={shifts}
                        weekMonday={weekMonday}
                        displayedColumns={displayedColumns}
                        columns={columns}
                        viewRange={viewRange}
                        today={today}
                        canEditSchedule={canEditSchedule}
                        cellMenuKey={cellMenuKey}
                        setCellMenuKey={setCellMenuKey}
                        openCreateShift={openCreateShift}
                        openSchedulePanelForEmployee={openSchedulePanelForEmployee}
                        goTimeClockForTimeOff={goTimeClockForTimeOff}
                        openUnavailability={openUnavailability}
                        deletePending={deletePending}
                        startDeleteTransition={startDeleteTransition}
                        routerRefresh={() => router.refresh()}
                        afterMutation={afterMutation}
                        setDeleteError={setDeleteError}
                        setEditingShiftId={setEditingShiftId}
                        setPublishError={setPublishError}
                        setModalNonce={setModalNonce}
                        setAddOpen={setAddOpen}
                        scopeAll={scopeAll}
                        locationNamesById={locationNamesById}
                        locationLabel={locationLabel}
                        defaultLocationId={defaultLocationId}
                        locationsForPicker={locationsForPicker}
                        unavailByEmployeeDay={unavailByEmployeeDay}
                      />
                    )}
                  </div>
                );
              })
              )}
            </div>
          </div>
        )}
        </div>

        {showWeeklySummary ? (
        <div className="sticky bottom-0 z-10 rounded-lg border border-slate-200 bg-slate-100/95 px-4 py-2.5 shadow-sm backdrop-blur">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Weekly summary
            </span>
            <div className="flex flex-wrap items-center gap-6 text-xs text-slate-700">
              <span className="tabular-nums">
                <span className="font-semibold text-slate-900">{formatHoursClock(totals.hours)}</span>{" "}
                hours
              </span>
              <span>
                <span className="font-semibold text-slate-900">{totals.shiftCount}</span> shifts
              </span>
              <span>
                <span className="font-semibold text-slate-900">{totals.people}</span> users
              </span>
              {topJobs.length ? (
                <span className="text-slate-600">
                  Top jobs:{" "}
                  <span className="font-medium text-slate-800">
                    {topJobs.map((j) => `${j.job} ${formatHoursClock(j.hours)}`).join(" • ")}
                  </span>
                </span>
              ) : (
                <span className="text-slate-400">Top jobs —</span>
              )}
            </div>
          </div>
        </div>
        ) : null}
    </div>
  );
}
