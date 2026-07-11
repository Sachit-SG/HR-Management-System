"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { DayPicker, type DateRange, useDayPicker } from "react-day-picker";
import type { MonthCaptionProps } from "react-day-picker";
import "react-day-picker/style.css";

export const TIMESHEET_RDP_PANEL_VARS: CSSProperties = {
  "--rdp-day-height": "1.65rem",
  "--rdp-day-width": "14.28%",
  "--rdp-day_button-height": "100%",
  "--rdp-day_button-width": "100%",
  "--rdp-day_button-border-radius": "0",
  "--rdp-accent-color": "#ea580c",
  "--rdp-accent-background-color": "rgb(255 237 213 / 0.45)",
  "--rdp-range_middle-background-color": "rgb(255 237 213 / 0.5)",
  "--rdp-range_middle-color": "rgb(15 23 42)",
  "--rdp-outside-opacity": "0.3",
  "--rdp-nav-height": "1.75rem",
  "--rdp-nav_button-height": "1.5rem",
  "--rdp-nav_button-width": "1.5rem",
  "--rdp-weekday-padding": "0.2rem 0.05rem",
} as CSSProperties;

function timesheetNavBounds() {
  const start = new Date();
  start.setFullYear(start.getFullYear() - 25);
  start.setMonth(0, 1);
  const end = new Date();
  end.setFullYear(end.getFullYear() + 15);
  end.setMonth(11, 31);
  return { startMonth: start, endMonth: end };
}

function monthLabel(monthIndex: number): string {
  return new Date(2024, monthIndex, 1).toLocaleDateString(undefined, { month: "short" });
}

function clampMonthToBounds(date: Date, start: Date, end: Date): Date {
  const t = new Date(date.getFullYear(), date.getMonth(), 1);
  const s = new Date(start.getFullYear(), start.getMonth(), 1);
  const e = new Date(end.getFullYear(), end.getMonth(), 1);
  if (t < s) return s;
  if (t > e) return e;
  return t;
}

const FALLBACK_START_MONTH = new Date(1900, 0, 1);
const FALLBACK_END_MONTH = new Date(2100, 11, 31);

function TimesheetMonthCaption(props: MonthCaptionProps) {
  const { calendarMonth, displayIndex, className, style, children, ...divProps } = props;
  void displayIndex;
  void children;
  const { goToMonth, previousMonth, nextMonth, classNames: cn, dayPickerProps } = useDayPicker();
  const { startMonth, endMonth } = useMemo(
    () => ({
      startMonth: dayPickerProps.startMonth ?? FALLBACK_START_MONTH,
      endMonth: dayPickerProps.endMonth ?? FALLBACK_END_MONTH,
    }),
    [dayPickerProps.startMonth, dayPickerProps.endMonth],
  );

  const d = calendarMonth.date;
  const year = d.getFullYear();
  const monthIndex = d.getMonth();
  const [openMenu, setOpenMenu] = useState<null | "month" | "year">(null);
  const captionRef = useRef<HTMLDivElement>(null);
  const monthListRef = useRef<HTMLDivElement>(null);
  const yearListRef = useRef<HTMLDivElement>(null);

  const yearOptions = useMemo(() => {
    const from = startMonth.getFullYear();
    const to = endMonth.getFullYear();
    const list: number[] = [];
    for (let y = from; y <= to; y++) list.push(y);
    return list;
  }, [startMonth, endMonth]);

  useEffect(() => {
    if (!openMenu) return;
    const onDoc = (e: MouseEvent) => {
      if (captionRef.current && !captionRef.current.contains(e.target as Node)) {
        setOpenMenu(null);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [openMenu]);

  useEffect(() => {
    if (openMenu !== "month" || !monthListRef.current) return;
    const el = monthListRef.current.querySelector<HTMLButtonElement>(`[data-month="${monthIndex}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [openMenu, monthIndex]);

  useEffect(() => {
    if (openMenu !== "year" || !yearListRef.current) return;
    const el = yearListRef.current.querySelector<HTMLButtonElement>(`[data-year="${year}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [openMenu, year]);

  const pickMonth = useCallback(
    (m: number) => {
      goToMonth(clampMonthToBounds(new Date(year, m, 1), startMonth, endMonth));
      setOpenMenu(null);
    },
    [goToMonth, year, startMonth, endMonth],
  );

  const pickYear = useCallback(
    (y: number) => {
      goToMonth(clampMonthToBounds(new Date(y, monthIndex, 1), startMonth, endMonth));
      setOpenMenu(null);
    },
    [goToMonth, monthIndex, startMonth, endMonth],
  );

  const bp = cn.button_previous ?? "";
  const bn = cn.button_next ?? "";

  return (
    <div
      ref={captionRef}
      className={`relative mb-1 flex w-full flex-col items-stretch ${className ?? ""}`}
      style={style}
      {...divProps}
    >
      <div className="flex w-full items-center justify-between gap-1">
        <button
          type="button"
          disabled={!previousMonth}
          aria-label="Previous month"
          onClick={() => previousMonth && goToMonth(previousMonth)}
          className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-0 bg-white text-slate-600 shadow-sm ring-1 ring-slate-200/80 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 ${bp}`}
        >
          <ChevronLeft className="h-3.5 w-3.5" aria-hidden />
        </button>

        <div className="relative flex min-w-0 flex-1 items-center justify-center gap-0.5 text-xs font-semibold text-slate-900">
          <button
            type="button"
            aria-expanded={openMenu === "month"}
            aria-haspopup="listbox"
            onClick={() => setOpenMenu((o) => (o === "month" ? null : "month"))}
            className="rounded px-1.5 py-0.5 transition hover:bg-slate-100"
          >
            {monthLabel(monthIndex)}
          </button>
          <button
            type="button"
            aria-expanded={openMenu === "year"}
            aria-haspopup="listbox"
            onClick={() => setOpenMenu((o) => (o === "year" ? null : "year"))}
            className="rounded px-1.5 py-0.5 tabular-nums transition hover:bg-slate-100"
          >
            {year}
          </button>
        </div>

        <button
          type="button"
          disabled={!nextMonth}
          aria-label="Next month"
          onClick={() => nextMonth && goToMonth(nextMonth)}
          className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-0 bg-white text-slate-600 shadow-sm ring-1 ring-slate-200/80 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 ${bn}`}
        >
          <ChevronRight className="h-3.5 w-3.5" aria-hidden />
        </button>
      </div>

      {openMenu === "month" ? (
        <div
          ref={monthListRef}
          role="listbox"
          aria-label="Choose month"
          className="absolute left-1/2 top-full z-50 mt-0.5 max-h-40 w-[min(100%,10rem)] -translate-x-1/2 overflow-y-auto rounded-lg border border-slate-200 bg-white py-0.5 shadow-lg"
        >
          {Array.from({ length: 12 }, (_, m) => (
            <button
              key={m}
              type="button"
              role="option"
              aria-selected={m === monthIndex}
              data-month={m}
              onClick={() => pickMonth(m)}
              className={`flex w-full items-center px-2.5 py-1.5 text-left text-xs ${
                m === monthIndex
                  ? "bg-orange-50 font-semibold text-orange-900"
                  : "text-slate-800 hover:bg-slate-50"
              }`}
            >
              {monthLabel(m)}
            </button>
          ))}
        </div>
      ) : null}

      {openMenu === "year" ? (
        <div
          ref={yearListRef}
          role="listbox"
          aria-label="Choose year"
          className="absolute left-1/2 top-full z-50 mt-0.5 max-h-40 w-[min(100%,6rem)] -translate-x-1/2 overflow-y-auto rounded-lg border border-slate-200 bg-white py-0.5 shadow-lg"
        >
          {yearOptions.map((yOpt) => (
            <button
              key={yOpt}
              type="button"
              role="option"
              aria-selected={yOpt === year}
              data-year={yOpt}
              onClick={() => pickYear(yOpt)}
              className={`flex w-full items-center justify-center px-2 py-1.5 text-xs tabular-nums ${
                yOpt === year
                  ? "bg-orange-50 font-semibold text-orange-900"
                  : "text-slate-800 hover:bg-slate-50"
              }`}
            >
              {yOpt}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export type TimesheetRangeCalendarProps = {
  weekStartsOn: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  month: Date;
  onMonthChange: (month: Date) => void;
  selected: DateRange | undefined;
  onSelect: (range: DateRange | undefined) => void;
};

export function TimesheetRangeCalendar({
  weekStartsOn,
  month,
  onMonthChange,
  selected,
  onSelect,
}: TimesheetRangeCalendarProps) {
  const { startMonth, endMonth } = useMemo(() => timesheetNavBounds(), []);

  return (
    <DayPicker
      mode="range"
      weekStartsOn={weekStartsOn}
      numberOfMonths={1}
      month={month}
      onMonthChange={onMonthChange}
      startMonth={startMonth}
      endMonth={endMonth}
      hideNavigation
      components={{ MonthCaption: TimesheetMonthCaption }}
      selected={selected}
      onSelect={onSelect}
      showOutsideDays
      formatters={{
        formatWeekdayName: (wd) => wd.toLocaleDateString(undefined, { weekday: "narrow" }),
      }}
      classNames={{
        root: "mx-auto w-full max-w-none text-slate-800",
        months: "w-full",
        month: "w-full space-y-1",
        month_grid: "w-full table-fixed border-collapse [border-spacing:0]",
        weekdays: "mb-0 table-row border-collapse",
        weekday:
          "box-border w-[14.28%] min-w-0 p-0 pb-0.5 pt-0 text-center text-[9px] font-medium text-slate-400",
        weeks: "w-full",
        week: "table-row border-collapse",
        day: "relative box-border !w-[14.28%] min-w-0 p-0 text-center align-middle",
        day_button:
          "flex !h-full min-h-[1.65rem] !w-full max-w-none items-center justify-center rounded-none border-0 text-[11px] font-medium tabular-nums text-slate-700 transition-colors hover:bg-slate-100/90 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-orange-400/40 focus-visible:ring-inset",
        range_start:
          "bg-orange-600 p-0 [&>button]:h-full [&>button]:min-h-[1.65rem] [&>button]:w-full [&>button]:rounded-none [&>button]:!bg-orange-600 [&>button]:!text-white [&>button]:hover:!bg-orange-600 [&>button]:!ring-0",
        range_end:
          "bg-orange-600 p-0 [&>button]:h-full [&>button]:min-h-[1.65rem] [&>button]:w-full [&>button]:rounded-none [&>button]:!bg-orange-600 [&>button]:!text-white [&>button]:hover:!bg-orange-600 [&>button]:!ring-0",
        range_middle:
          "bg-orange-100 p-0 text-slate-900 [&>button]:h-full [&>button]:min-h-[1.65rem] [&>button]:w-full [&>button]:rounded-none [&>button]:!bg-orange-100 [&>button]:!text-slate-900 [&>button]:text-[11px] [&>button]:hover:!bg-orange-100 [&>button]:!ring-0",
        today:
          "font-semibold text-orange-800 [&>button]:ring-1 [&>button]:ring-inset [&>button]:ring-orange-300/90",
        outside: "text-slate-300 [&>button]:font-normal [&>button]:text-slate-300",
        disabled: "opacity-35",
      }}
    />
  );
}
