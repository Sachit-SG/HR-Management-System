/**
 * Timesheet / pay-period windows per clock (weekly, bi-weekly, monthly, semi-monthly, custom split).
 * Boundaries use the viewer's local timezone when computed on the client; server uses the same
 * calendar-day logic with JS Date in UTC for query bounds (see `periodBoundsToQueryIso`).
 */

export type TimesheetPeriodKind = "weekly" | "bi_weekly" | "monthly" | "semi_monthly" | "custom";

/** Stored in `time_clocks.timesheet_period_config`. */
export type TimesheetPeriodConfig = {
  /**
   * 0=Sunday … 6=Saturday. Used by weekly + bi-weekly navigation and calendar rendering.
   * Default 1 (Monday) to match the app’s historical Mon–Sun week grid.
   */
  week_starts_on?: number;
  /**
   * Bi-weekly epoch anchor start (YYYY-MM-DD, local calendar date).
   * When present, bi-weekly periods are aligned to this exact start date
   * (so schedules match legacy payroll calendars).
   *
   * Example:
   * - West: 2025-12-15 (Mon start)
   * - East: 2025-12-25 (Thu start)
   */
  biweekly_anchor_start?: string;
  /**
   * Monthly pay-period cutoff day (calendar day). Mirrors Connecteam’s “Pay period ends”.
   * When set, the “monthly” period becomes (cutoff+1 of prior month) … (cutoff of current month).
   * Allowed: 26–30, or "last_day" (default when omitted).
   */
  monthly_ends_on?: 26 | 27 | 28 | 29 | 30 | "last_day";
  /**
   * Last day of the "first half" of the month (1-based). Second half is split_after_day+1 … last day.
   * Default 15. Valid range 1–27 for semi_monthly and custom.
   */
  split_after_day?: number;
  /**
   * Optional reminders (do not affect calculations).
   */
  payroll_software?: string;
  payroll_handled?: string;
  payroll_owner?: string;
};

export const DEFAULT_PERIOD_KIND: TimesheetPeriodKind = "weekly";

export function normalizePeriodConfig(
  raw: unknown,
  kind: TimesheetPeriodKind,
): TimesheetPeriodConfig {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { week_starts_on: 1 };
  }
  const o = raw as Record<string, unknown>;
  const wso = o.week_starts_on;
  const weekStartsOn =
    typeof wso === "number" && Number.isInteger(wso) && wso >= 0 && wso <= 6 ? wso : 1;

  const meo = o.monthly_ends_on;
  const monthlyEndsOn =
    meo === "last_day" ||
    meo === 26 ||
    meo === 27 ||
    meo === 28 ||
    meo === 29 ||
    meo === 30
      ? (meo as TimesheetPeriodConfig["monthly_ends_on"])
      : undefined;

  const split = o.split_after_day;
  const splitNum =
    typeof split === "number" && Number.isInteger(split) && split >= 1 && split <= 27
      ? split
      : undefined;
  const payroll_software = typeof o.payroll_software === "string" ? o.payroll_software : undefined;
  const payroll_handled = typeof o.payroll_handled === "string" ? o.payroll_handled : undefined;
  const payroll_owner = typeof o.payroll_owner === "string" ? o.payroll_owner : undefined;
  const bas = typeof o.biweekly_anchor_start === "string" ? o.biweekly_anchor_start : undefined;
  const biweekly_anchor_start = bas && YMD_RE.test(bas) ? bas : undefined;

  const base: TimesheetPeriodConfig = {
    week_starts_on: weekStartsOn,
    monthly_ends_on: monthlyEndsOn,
    biweekly_anchor_start,
    payroll_software,
    payroll_handled,
    payroll_owner,
  };
  if (kind === "semi_monthly" || kind === "custom") {
    return { ...base, split_after_day: splitNum ?? 15 };
  }
  return splitNum != null ? { ...base, split_after_day: splitNum } : base;
}

function splitDay(config: TimesheetPeriodConfig, kind: TimesheetPeriodKind): number {
  if (kind !== "semi_monthly" && kind !== "custom") return 15;
  const d = config.split_after_day;
  if (typeof d === "number" && d >= 1 && d <= 27) return d;
  return 15;
}

function startOfDayLocal(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

/** Week start 00:00 local containing `d` (0=Sun…6=Sat). */
export function startOfWeek(d: Date, weekStartsOn: number): Date {
  const wso = Number.isInteger(weekStartsOn) && weekStartsOn >= 0 && weekStartsOn <= 6 ? weekStartsOn : 1;
  const day = d.getDay();
  const offset = ((day - wso + 7) % 7) * -1;
  const m = new Date(d);
  m.setDate(d.getDate() + offset);
  m.setHours(0, 0, 0, 0);
  return m;
}

function startOfMonth(d: Date): Date {
  const x = new Date(d);
  x.setDate(1);
  x.setHours(0, 0, 0, 0);
  return x;
}

function addMonths(d: Date, n: number): Date {
  const x = new Date(d);
  x.setMonth(x.getMonth() + n);
  return x;
}

export type PeriodBounds = {
  /** Inclusive start (midnight local). */
  start: Date;
  /** Exclusive end (midnight local of day after last day in range). */
  endExclusive: Date;
};

/**
 * Period containing `anchor` (any instant) for the given kind.
 */
export function getPeriodBounds(
  anchor: Date,
  kind: TimesheetPeriodKind,
  config: TimesheetPeriodConfig,
): PeriodBounds {
  const split = splitDay(config, kind);
  const weekStartsOn =
    typeof config.week_starts_on === "number" && config.week_starts_on >= 0 && config.week_starts_on <= 6
      ? config.week_starts_on
      : 1;

  if (kind === "weekly") {
    const start = startOfWeek(anchor, weekStartsOn);
    const endExclusive = new Date(start);
    endExclusive.setDate(endExclusive.getDate() + 7);
    return { start, endExclusive };
  }

  if (kind === "bi_weekly") {
    const start = startOfBiWeekContaining(anchor, weekStartsOn, config.biweekly_anchor_start);
    const endExclusive = new Date(start);
    endExclusive.setDate(endExclusive.getDate() + 14);
    return { start, endExclusive };
  }

  if (kind === "monthly") {
    const monthlyEndsOn = config.monthly_ends_on ?? "last_day";
    if (monthlyEndsOn === "last_day" || monthlyEndsOn == null) {
      const start = startOfMonth(anchor);
      const endExclusive = addMonths(start, 1);
      return { start, endExclusive };
    }

    const cutoff = monthlyEndsOn;
    const y = anchor.getFullYear();
    const m = anchor.getMonth();
    const day = anchor.getDate();

    const lastDay = (yy: number, mm: number) => new Date(yy, mm + 1, 0).getDate();
    const clampCutoff = (yy: number, mm: number) => Math.min(cutoff, lastDay(yy, mm));

    const endDayThisMonth = clampCutoff(y, m);
    // period ends on endDayThisMonth, starting day is (endDayPrevMonth+1)
    const endExclusive = new Date(y, m, endDayThisMonth + 1, 0, 0, 0, 0);
    // If anchor is after the cutoff day in this month, the “current” period ends next month.
    if (day > endDayThisMonth) {
      const ny = m === 11 ? y + 1 : y;
      const nm = (m + 1) % 12;
      const endDayNextMonth = clampCutoff(ny, nm);
      const nextEndEx = new Date(ny, nm, endDayNextMonth + 1, 0, 0, 0, 0);
      const start = new Date(y, m, endDayThisMonth + 1, 0, 0, 0, 0);
      return { start, endExclusive: nextEndEx };
    }
    // anchor is on/before cutoff => start is after prev month cutoff
    const pyDate = addMonths(new Date(y, m, 1), -1);
    const py = pyDate.getFullYear();
    const pm = pyDate.getMonth();
    const endDayPrevMonth = clampCutoff(py, pm);
    const start = new Date(py, pm, endDayPrevMonth + 1, 0, 0, 0, 0);
    return { start, endExclusive };
  }

  // semi_monthly + custom: two segments per month
  const y = anchor.getFullYear();
  const m = anchor.getMonth();
  const day = anchor.getDate();

  if (day <= split) {
    const start = new Date(y, m, 1, 0, 0, 0, 0);
    const endExclusive = new Date(y, m, split + 1, 0, 0, 0, 0);
    return { start, endExclusive };
  }

  const start = new Date(y, m, split + 1, 0, 0, 0, 0);
  const endExclusive = addMonths(new Date(y, m, 1), 1);
  return { start, endExclusive };
}

/** Canonical period start (first instant of the period) for navigation labels. */
export function getPeriodStart(anchor: Date, kind: TimesheetPeriodKind, config: TimesheetPeriodConfig): Date {
  return getPeriodBounds(anchor, kind, config).start;
}

/**
 * Move to previous/next period's start (for prev/next chevrons).
 */
export function shiftPeriodAnchor(
  currentStart: Date,
  kind: TimesheetPeriodKind,
  config: TimesheetPeriodConfig,
  direction: -1 | 1,
): Date {
  const split = splitDay(config, kind);
  const weekStartsOn =
    typeof config.week_starts_on === "number" && config.week_starts_on >= 0 && config.week_starts_on <= 6
      ? config.week_starts_on
      : 1;

  if (kind === "weekly") {
    const d = new Date(currentStart);
    d.setDate(d.getDate() + direction * 7);
    return d;
  }

  if (kind === "bi_weekly") {
    const d = new Date(currentStart);
    d.setDate(d.getDate() + direction * 14);
    return d;
  }

  if (kind === "monthly") {
    const endsOn = config.monthly_ends_on ?? "last_day";
    if (endsOn === "last_day" || endsOn == null) {
      return addMonths(currentStart, direction);
    }
    // Move by one cutoff period (variable month lengths handled by `getPeriodBounds` on the target anchor).
    const probe = new Date(currentStart);
    probe.setDate(probe.getDate() + direction * 32);
    // Align probe to the same week start rules for stability when UI jumps through weeks.
    const aligned = startOfDayLocal(probe);
    return getPeriodBounds(aligned, kind, { ...config, week_starts_on: weekStartsOn }).start;
  }

  // semi / custom: alternate between 1st and (split+1) within / across months
  const y = currentStart.getFullYear();
  const m = currentStart.getMonth();
  const cd = currentStart.getDate();

  if (direction === 1) {
    if (cd === 1) {
      // first half → second half same month
      return new Date(y, m, split + 1, 0, 0, 0, 0);
    }
    // second half → first half next month
    return new Date(y, m + 1, 1, 0, 0, 0, 0);
  }

  // direction -1
  if (cd === 1) {
    // at first of month → go to second half of *previous* month
    const prevMonth = addMonths(new Date(y, m, 1), -1);
    const py = prevMonth.getFullYear();
    const pm = prevMonth.getMonth();
    return new Date(py, pm, split + 1, 0, 0, 0, 0);
  }
  // at split+1 → first half same month
  return new Date(y, m, 1, 0, 0, 0, 0);
}

/** List each calendar day in [start, endExclusive). */
export function enumerateDaysInPeriod(bounds: PeriodBounds): Date[] {
  const out: Date[] = [];
  const cur = startOfDayLocal(bounds.start);
  const end = bounds.endExclusive.getTime();
  while (cur.getTime() < end) {
    out.push(new Date(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}

/**
 * Recent pay periods for the range-picker sidebar (current + prior windows).
 * Order: newest first (index 0 = period containing `anchor`).
 */
export function listRecentPeriodPresets(
  anchor: Date,
  kind: TimesheetPeriodKind,
  config: TimesheetPeriodConfig,
  count = 12,
): PeriodBounds[] {
  const n = Math.max(1, Math.min(24, count));
  const out: PeriodBounds[] = [];
  let bounds = getPeriodBounds(anchor, kind, config);
  out.push(bounds);
  for (let i = 1; i < n; i++) {
    const prevStart = shiftPeriodAnchor(bounds.start, kind, config, -1);
    bounds = getPeriodBounds(prevStart, kind, config);
    out.push(bounds);
  }
  return out;
}

export function periodKindPresetLabel(kind: TimesheetPeriodKind): string {
  switch (kind) {
    case "weekly":
      return "Weekly periods";
    case "bi_weekly":
      return "Bi-weekly periods";
    case "monthly":
      return "Monthly periods";
    case "semi_monthly":
      return "Semi-monthly periods";
    case "custom":
      return "Custom split periods";
    default:
      return "Pay periods";
  }
}

/** Format range label like 01/04 – 30/04 (DD/MM). */
export function formatPeriodRangeLabel(bounds: PeriodBounds): string {
  const lastInclusive = new Date(bounds.endExclusive);
  lastInclusive.setDate(lastInclusive.getDate() - 1);
  const dd = (n: number) => String(n).padStart(2, "0");
  const a = bounds.start;
  const b = lastInclusive;
  return `${dd(a.getDate())}/${dd(a.getMonth() + 1)} – ${dd(b.getDate())}/${dd(b.getMonth() + 1)}`;
}

/** ISO strings for Supabase `clock_in_at` filter: [start, endExclusive). */
export function periodBoundsToQueryIso(bounds: PeriodBounds): { gte: string; lt: string } {
  return {
    gte: bounds.start.toISOString(),
    lt: bounds.endExclusive.toISOString(),
  };
}

export function parsePeriodKind(raw: string | undefined | null): TimesheetPeriodKind | null {
  if (!raw) return null;
  if (
    raw === "weekly" ||
    raw === "bi_weekly" ||
    raw === "monthly" ||
    raw === "semi_monthly" ||
    raw === "custom"
  ) {
    return raw;
  }
  return null;
}

/**
 * Fixed Monday anchor so every calendar has the same 14-day blocks (Mon–Sun × 2).
 * 2020-01-06 is a Monday in the Gregorian calendar used by `Date` in all locales.
 */
function biweekEpoch(weekStartsOn: number): Date {
  // 2020-01-05 is a Sunday; using it as the base and normalizing to week start gives a stable epoch for any start day.
  return startOfWeek(new Date(2020, 0, 5), weekStartsOn);
}

function parseYmdLocal(ymd: string): Date | null {
  if (!YMD_RE.test(ymd)) return null;
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(y, m - 1, d, 0, 0, 0, 0);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

function startOfBiWeekContaining(anchor: Date, weekStartsOn: number, anchorYmd?: string): Date {
  const customEpoch =
    anchorYmd && YMD_RE.test(anchorYmd) ? parseYmdLocal(anchorYmd) : null;
  const epoch = customEpoch ? startOfWeek(customEpoch, weekStartsOn) : biweekEpoch(weekStartsOn);
  const weekStart = startOfWeek(anchor, weekStartsOn);
  const msPerDay = 86400000;
  const diffDays = Math.round((weekStart.getTime() - epoch.getTime()) / msPerDay);
  const block = Math.floor(diffDays / 14);
  const start = new Date(epoch);
  start.setDate(start.getDate() + block * 14);
  start.setHours(0, 0, 0, 0);
  return start;
}

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Build period bounds from URL `range_from` / `range_to` (YYYY-MM-DD, local calendar dates).
 * `dateTo` is inclusive (last day shown); storage uses exclusive end at midnight after last day.
 */
export function periodBoundsFromDateStrings(dateFrom: string, dateTo: string): PeriodBounds | null {
  if (!YMD_RE.test(dateFrom) || !YMD_RE.test(dateTo)) return null;
  const [y1, m1, d1] = dateFrom.split("-").map(Number);
  const [y2, m2, d2] = dateTo.split("-").map(Number);
  const start = new Date(y1, m1 - 1, d1, 0, 0, 0, 0);
  const lastInclusive = new Date(y2, m2 - 1, d2, 0, 0, 0, 0);
  if (Number.isNaN(start.getTime()) || Number.isNaN(lastInclusive.getTime())) return null;
  if (lastInclusive < start) return null;
  const endExclusive = new Date(lastInclusive);
  endExclusive.setDate(endExclusive.getDate() + 1);
  return { start, endExclusive };
}

/** Shift a custom day range by the same length (prev/next). */
export function shiftCustomRangeYmd(
  fromYmd: string,
  toYmd: string,
  direction: -1 | 1,
): { from: string; to: string } | null {
  const b = periodBoundsFromDateStrings(fromYmd, toYmd);
  if (!b) return null;
  const nDays = Math.round((b.endExclusive.getTime() - b.start.getTime()) / 86400000);
  const newStart = new Date(b.start);
  newStart.setDate(newStart.getDate() + direction * nDays);
  const newEndEx = new Date(b.endExclusive);
  newEndEx.setDate(newEndEx.getDate() + direction * nDays);
  const lastIn = new Date(newEndEx);
  lastIn.setDate(lastIn.getDate() - 1);
  const y = newStart.getFullYear();
  const m = String(newStart.getMonth() + 1).padStart(2, "0");
  const d = String(newStart.getDate()).padStart(2, "0");
  const y2 = lastIn.getFullYear();
  const m2 = String(lastIn.getMonth() + 1).padStart(2, "0");
  const d2 = String(lastIn.getDate()).padStart(2, "0");
  return { from: `${y}-${m}-${d}`, to: `${y2}-${m2}-${d2}` };
}
