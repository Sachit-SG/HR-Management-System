"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import dynamic from "next/dynamic";
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import type { DateRange } from "react-day-picker";
import {
  formatPeriodRangeLabel,
  listRecentPeriodPresets,
  periodKindPresetLabel,
  type TimesheetPeriodConfig,
  type TimesheetPeriodKind,
} from "@/lib/time-clock/timesheet-period";
import { TIMESHEET_RDP_PANEL_VARS } from "@/components/time-clock/timesheet-range-calendar";

const TimesheetRangeCalendar = dynamic(
  () =>
    import("@/components/time-clock/timesheet-range-calendar").then((m) => m.TimesheetRangeCalendar),
  {
    ssr: false,
    loading: () => (
      <div className="h-[11.5rem] w-full animate-pulse rounded-md bg-slate-100/90" aria-hidden />
    ),
  },
);

function toYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

type Props = {
  rangeLabel: string;
  periodStart: Date;
  periodEndInclusive: Date;
  periodKind: TimesheetPeriodKind;
  periodConfig: TimesheetPeriodConfig;
  weekStartsOn: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  hasCustomRange: boolean;
  navigating?: boolean;
  onApplyCustomRange: (fromYmd: string, toYmd: string) => void;
  onSelectPresetPeriod: (periodStart: Date) => void;
  onClearCustomRange: () => void;
  onNavigatePrev: () => void;
  onNavigateNext: () => void;
  onJumpToToday: () => void;
};

function endInclusiveFromBounds(endExclusive: Date): Date {
  const d = new Date(endExclusive);
  d.setDate(d.getDate() - 1);
  return d;
}

function rangesMatch(
  aStart: Date,
  aEndInclusive: Date,
  bStart: Date,
  bEndInclusive: Date,
): boolean {
  return toYmd(aStart) === toYmd(bStart) && toYmd(aEndInclusive) === toYmd(bEndInclusive);
}

export function TimesheetRangePicker({
  rangeLabel,
  periodStart,
  periodEndInclusive,
  periodKind,
  periodConfig,
  weekStartsOn,
  hasCustomRange,
  navigating = false,
  onApplyCustomRange,
  onSelectPresetPeriod,
  onClearCustomRange,
  onNavigatePrev,
  onNavigateNext,
  onJumpToToday,
}: Props) {
  const panelId = useId();
  const wrapRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<DateRange | undefined>(() => ({
    from: periodStart,
    to: periodEndInclusive,
  }));
  const [calendarMonth, setCalendarMonth] = useState(() =>
    new Date(periodStart.getFullYear(), periodStart.getMonth(), 1),
  );

  const periodPresets = useMemo(
    () => listRecentPeriodPresets(periodStart, periodKind, periodConfig, 8),
    [periodStart, periodKind, periodConfig],
  );

  const activePresetKey = useMemo(() => {
    const draftStart = draft?.from ?? periodStart;
    const draftEnd = draft?.to ?? periodEndInclusive;
    const match = periodPresets.find((b) => {
      const endInc = endInclusiveFromBounds(b.endExclusive);
      return rangesMatch(b.start, endInc, draftStart, draftEnd);
    });
    return match ? toYmd(match.start) : null;
  }, [periodPresets, draft, periodStart, periodEndInclusive]);

  const draftLabel = useMemo(() => {
    if (!draft?.from || !draft.to) return rangeLabel;
    const a = draft.from <= draft.to ? draft.from : draft.to;
    const b = draft.from <= draft.to ? draft.to : draft.from;
    const endEx = new Date(b);
    endEx.setDate(endEx.getDate() + 1);
    return formatPeriodRangeLabel({ start: a, endExclusive: endEx });
  }, [draft, rangeLabel]);

  function selectPreset(bounds: { start: Date; endExclusive: Date }) {
    const endInc = endInclusiveFromBounds(bounds.endExclusive);
    setDraft({ from: bounds.start, to: endInc });
    setCalendarMonth(new Date(bounds.start.getFullYear(), bounds.start.getMonth(), 1));
    setOpen(false);
    onSelectPresetPeriod(bounds.start);
  }

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  useEffect(() => {
    if (open) return;
    setDraft({ from: periodStart, to: periodEndInclusive });
  }, [open, periodStart, periodEndInclusive]);

  function apply() {
    if (!draft?.from || !draft.to) return;
    const a = draft.from <= draft.to ? draft.from : draft.to;
    const b = draft.from <= draft.to ? draft.to : draft.from;
    setOpen(false);
    onApplyCustomRange(toYmd(a), toYmd(b));
  }

  function closeAndNavigate(fn: () => void) {
    setOpen(false);
    fn();
  }

  const panelStyle = TIMESHEET_RDP_PANEL_VARS as CSSProperties;

  return (
    <div
      className="relative inline-flex min-w-0 flex-wrap items-center gap-1 rounded border border-slate-200 bg-white pl-1 pr-1 shadow-sm"
      ref={wrapRef}
    >
      <button
        type="button"
        disabled={navigating}
        onClick={() => closeAndNavigate(onNavigatePrev)}
        className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded text-slate-600 hover:bg-slate-100 disabled:opacity-50"
        aria-label="Previous period"
      >
        <ChevronLeft className="h-4 w-4" />
      </button>
      <button
        type="button"
        id={`${panelId}-trigger`}
        aria-expanded={open}
        aria-controls={panelId}
        aria-busy={navigating}
        disabled={navigating}
        onMouseEnter={() => {
          void import("@/components/time-clock/timesheet-range-calendar");
        }}
        onClick={() => {
          setDraft({ from: periodStart, to: periodEndInclusive });
          setCalendarMonth(new Date(periodStart.getFullYear(), periodStart.getMonth(), 1));
          setOpen((o) => !o);
        }}
        className="min-w-[8.5rem] cursor-pointer rounded-md px-2 py-2 text-center text-sm font-semibold tabular-nums text-slate-900 transition-colors hover:bg-slate-100 active:bg-slate-200 disabled:cursor-wait disabled:opacity-60 sm:min-w-[9.5rem]"
        title="Open calendar"
      >
        {navigating ? "Loading…" : rangeLabel}
      </button>
      <button
        type="button"
        disabled={navigating}
        onClick={() => closeAndNavigate(onNavigateNext)}
        className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded text-slate-600 hover:bg-slate-100 disabled:opacity-50"
        aria-label="Next period"
      >
        <ChevronRight className="h-4 w-4" />
      </button>

      {open ? (
        <div
          id={panelId}
          role="dialog"
          aria-label="Choose timesheet date range"
          className="absolute right-0 top-full z-50 mt-1 w-[min(calc(100vw-1rem),26.5rem)] rounded-lg border border-slate-200/90 bg-white p-2 shadow-lg shadow-slate-900/[0.06]"
          style={panelStyle}
        >
          <div className="mb-2 flex items-center justify-between gap-2 border-b border-slate-100 pb-2">
            <p className="min-w-0 truncate text-xs font-semibold tabular-nums text-slate-900">
              {draftLabel}
            </p>
            <div className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                onClick={() => {
                  onJumpToToday();
                  setOpen(false);
                }}
                className="rounded border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-medium text-slate-700 hover:bg-slate-50"
              >
                Today
              </button>
              {hasCustomRange ? (
                <button
                  type="button"
                  onClick={() => {
                    onClearCustomRange();
                    setOpen(false);
                  }}
                  className="rounded border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-medium text-slate-700 hover:bg-slate-50"
                >
                  Preset
                </button>
              ) : null}
            </div>
          </div>

          <div className="flex overflow-hidden rounded-md border border-slate-100">
            <aside
              className="flex w-[7.75rem] shrink-0 flex-col border-r border-slate-100 bg-slate-50/80"
              aria-label={periodKindPresetLabel(periodKind)}
            >
              <p className="border-b border-slate-100 px-2 py-1 text-[8px] font-semibold uppercase tracking-wide text-slate-400">
                {periodKind === "bi_weekly"
                  ? "Bi-week"
                  : periodKind === "weekly"
                    ? "Week"
                    : periodKind === "monthly"
                      ? "Month"
                      : periodKind === "semi_monthly"
                        ? "Semi-month"
                        : "Period"}
              </p>
              <ul className="max-h-[11.5rem] overflow-y-auto py-0.5" role="listbox">
                {periodPresets.map((bounds) => {
                  const key = toYmd(bounds.start);
                  const selected = activePresetKey === key;
                  return (
                    <li key={key}>
                      <button
                        type="button"
                        role="option"
                        aria-selected={selected}
                        onClick={() => selectPreset(bounds)}
                        className={`w-full px-2 py-1.5 text-left text-[10px] font-medium tabular-nums leading-tight transition ${
                          selected
                            ? "bg-orange-600 text-white"
                            : "text-slate-700 hover:bg-white"
                        }`}
                      >
                        {formatPeriodRangeLabel(bounds)}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </aside>

            <div className="min-w-0 flex-1 bg-slate-50/50 px-0.5 pb-0.5 pt-0.5">
              <TimesheetRangeCalendar
                weekStartsOn={weekStartsOn}
                month={calendarMonth}
                onMonthChange={setCalendarMonth}
                selected={draft}
                onSelect={setDraft}
              />
            </div>
          </div>

          <div className="mt-2 flex items-center justify-end gap-1.5 border-t border-slate-100 pt-2">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded px-2 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-100"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={!draft?.from || !draft?.to}
              onClick={() => void apply()}
              className="rounded bg-orange-600 px-3 py-1 text-[11px] font-semibold text-white hover:bg-orange-700 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Apply
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
