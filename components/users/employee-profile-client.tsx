"use client";

import {
  ArrowLeft,
  Briefcase,
  Calendar,
  CalendarDays,
  Clock,
  Eye,
  EyeOff,
  Gift,
  Hash,
  IdCard,
  KeyRound,
  LogOut,
  Mail,
  MapPin,
  Palmtree,
  Phone,
  Smartphone,
  Sparkles,
  UserRound,
  Users as UsersIcon,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import {
  type EmployeeProfilePayload,
  updateEmployeeProfile,
} from "@/app/actions/employee-profile";
import { archiveEmployee, restoreEmployee } from "@/app/actions/archive-employee";
import { setEmployeeOrgOwner } from "@/app/actions/org-owner-role";
import { PRIMARY_ORANGE_CTA } from "@/lib/ui/primary-orange-cta";
import { POSITION_ROLE_OPTIONS } from "@/lib/users/position-options";
import { GENDER_OPTIONS } from "@/lib/users/gender-options";

export type ProfileLocationOption = { id: string; name: string };

export type ProfileManagerOption = {
  id: string;
  full_name: string;
  first_name: string | null;
  last_name: string | null;
  location_id: string | null;
};

export type EmployeeProfileInitial = {
  id: string;
  first_name: string;
  last_name: string;
  mobile_phone: string;
  email: string;
  employment_start_date: string;
  fte: string;
  standard_hours_per_week: string;
  role: string;
  location_id: string;
  direct_manager_id: string;
  birth_date: string;
  gender: string;
  employee_code: string;
  kiosk_code: string;
  /** Lifecycle: active / inactive / archived (from `employees.status`). */
  status?: string;
  /** Optional PTO classification override ("" = auto). */
  pto_cohort?: string;
  /** Termination reason ("" = none / still employed). */
  termination_reason?: string;
  /** Termination effective date (YYYY-MM-DD, "" = none). */
  termination_at?: string;
};

function toInputDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = iso.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : "";
}

function fmtDisplayDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return "—";
  }
}

type Props = {
  initial: EmployeeProfileInitial;
  /** Extra stores beyond `initial.location_id` (home store). */
  additionalLocationIds?: string[];
  locations: ProfileLocationOption[];
  storeManagers: ProfileManagerOption[];
  groupNames: string[];
  canEdit: boolean;
  ptoPanel?: {
    vacationHours: number;
    sickHours: number;
    standardDayHours: number;
    vacationCashoutEnabled: boolean;
    nextVacationCashoutAt: string | null;
    nextVacationCashoutHours: number;
    lastVacationCashoutAt: string | null;
    lastVacationCashoutHours: number;
    ytdVacationUsedHours: number;
    ledger: {
      id: string;
      bucket: string;
      entry_type: string;
      amount_hours: number;
      effective_at: string;
      notes: string | null;
      metadata: unknown;
    }[];
  } | null;
  /** User management: archive this profile (no hard delete). */
  canArchiveUser?: boolean;
  isArchivedProfile?: boolean;
  /** Owners can grant/remove organization owner on this profile. */
  canSetOrgOwner?: boolean;
  isOrgOwner?: boolean;
  appUserIdDisplay: string;
  daysInSystem: number | null;
  addedViaLabel: string;
  lastLogin: string | null;
  /** Set when the row is currently archived. Used by the Restore confirm copy. */
  archivedAt?: string | null;
  /**
   * Set when an employee was previously archived and later restored ("boomerang").
   * Surfaces under the employment start date so HR can tell tenure apart from
   * the latest return-to-work date. Stays null for everyone who was never archived.
   */
  rehiredAt?: string | null;
};

export function EmployeeProfileClient({
  initial,
  additionalLocationIds = [],
  locations,
  storeManagers,
  groupNames,
  canEdit,
  ptoPanel = null,
  canArchiveUser = false,
  isArchivedProfile = false,
  canSetOrgOwner = false,
  isOrgOwner = false,
  appUserIdDisplay,
  daysInSystem,
  addedViaLabel,
  lastLogin,
  archivedAt = null,
  rehiredAt = null,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const [first_name, setFirstName] = useState(initial.first_name);
  const [last_name, setLastName] = useState(initial.last_name);
  const [mobile_phone, setMobilePhone] = useState(initial.mobile_phone);
  const [email, setEmail] = useState(initial.email);
  const [employment_start_date, setEmploymentStart] = useState(
    toInputDate(initial.employment_start_date),
  );
  const [rehire_date, setRehireDate] = useState(toInputDate(rehiredAt));
  useEffect(() => {
    setRehireDate(toInputDate(rehiredAt));
  }, [rehiredAt]);
  const [fte, setFte] = useState(initial.fte ?? "1.0");
  const [standard_hours_per_week, setStandardHoursPerWeek] = useState(
    initial.standard_hours_per_week ?? "",
  );
  const [role, setRole] = useState(initial.role || "Employee");
  const [location_id, setLocationId] = useState(initial.location_id);
  const [direct_manager_id, setDirectManagerId] = useState(initial.direct_manager_id);
  const [birth_date, setBirthDate] = useState(toInputDate(initial.birth_date));
  const [gender, setGender] = useState(initial.gender ?? "");
  const [additional_location_ids, setAdditionalLocationIds] = useState<string[]>(
    additionalLocationIds,
  );
  useEffect(() => {
    setAdditionalLocationIds(additionalLocationIds);
  }, [additionalLocationIds]);
  const [employee_code, setEmployeeCode] = useState(initial.employee_code);
  // PTO policy + termination (Owner-only fields; we always carry the state
  // even for non-owners so the readout reflects the saved value).
  const [pto_cohort, setPtoCohort] = useState(initial.pto_cohort ?? "");
  const [termination_reason, setTerminationReason] = useState(
    initial.termination_reason ?? "",
  );
  const [termination_at, setTerminationAt] = useState(
    toInputDate(initial.termination_at),
  );

  const [orgOwnerLocal, setOrgOwnerLocal] = useState(isOrgOwner);
  useEffect(() => {
    setOrgOwnerLocal(isOrgOwner);
  }, [isOrgOwner]);

  const managersForStore = useMemo(
    () =>
      storeManagers.filter(
        (m) => m.location_id && m.location_id === location_id,
      ),
    [storeManagers, location_id],
  );

  const additionalStoreOptions = useMemo(
    () => locations.filter((l) => l.id !== location_id),
    [locations, location_id],
  );

  const additionalStoreNames = useMemo(
    () =>
      additional_location_ids
        .map((id) => locations.find((l) => l.id === id)?.name)
        .filter(Boolean) as string[],
    [additional_location_ids, locations],
  );

  const toggleAdditionalStore = useCallback((storeId: string) => {
    setAdditionalLocationIds((prev) =>
      prev.includes(storeId) ? prev.filter((id) => id !== storeId) : [...prev, storeId],
    );
  }, []);

  const onSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      setMessage(null);
      const payload: EmployeeProfilePayload = {
        first_name,
        last_name,
        mobile_phone,
        email,
        employment_start_date,
        rehired_at: rehire_date,
        fte,
        standard_hours_per_week,
        role,
        location_id,
        direct_manager_id,
        birth_date,
        gender: gender as EmployeeProfilePayload["gender"],
        employee_code,
        additional_location_ids,
        // Owner-only fields. Server ignores when caller lacks ORG_OWNER.
        pto_cohort: pto_cohort as EmployeeProfilePayload["pto_cohort"],
        termination_reason:
          termination_reason as EmployeeProfilePayload["termination_reason"],
        termination_at,
      };
      startTransition(async () => {
        const res = await updateEmployeeProfile(initial.id, payload);
        if (res.ok) {
          setMessage({ kind: "ok", text: "Profile saved." });
          router.refresh();
        } else {
          setMessage({ kind: "err", text: res.error });
        }
      });
    },
    [
      initial.id,
      first_name,
      last_name,
      mobile_phone,
      email,
      employment_start_date,
      rehire_date,
      fte,
      standard_hours_per_week,
      role,
      location_id,
      direct_manager_id,
      birth_date,
      gender,
      employee_code,
      additional_location_ids,
      pto_cohort,
      termination_reason,
      termination_at,
      router,
    ],
  );

  const inputCls =
    "mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-orange-400 focus:outline-none focus:ring-2 focus:ring-orange-500/20 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500";
  const labelCls =
    "flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500";

  const sectionCard =
    "rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm";

  const groupCount = groupNames.length;

  // -- Hero helpers ---------------------------------------------------------
  const fullName =
    [first_name, last_name].filter((s) => s && s.trim().length > 0).join(" ").trim() ||
    initial.email ||
    "—";
  const initials = (() => {
    const a = (first_name || "").trim();
    const b = (last_name || "").trim();
    const fa = a ? a[0] : "";
    const fb = b ? b[0] : "";
    const combined = `${fa}${fb}`.toUpperCase();
    if (combined) return combined;
    const e = (initial.email || "").trim();
    return e ? e[0].toUpperCase() : "?";
  })();
  const storeName = useMemo(() => {
    if (!location_id) return null;
    const found = locations.find((l) => l.id === location_id);
    return found ? found.name : null;
  }, [locations, location_id]);

  // [Kiosk Code] hidden by default — small lock-and-reveal so an admin
  // pairing a phone doesn't shoulder-surf a code in plain sight.
  const [showKioskCode, setShowKioskCode] = useState(false);

  const fmtShortDate = (iso: string | null | undefined) => {
    if (!iso) return "—";
    try {
      return new Date(iso).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      });
    } catch {
      return "—";
    }
  };

  const ptoTimelineLabel = (t: string) => {
    switch (t) {
      case "annual_grant":
        return "Annual grant";
      case "usage":
        return "Used (time off)";
      case "adjustment":
        return "Adjustment";
      case "forfeit":
        return "Forfeit";
      case "payout":
        return "Payout";
      case "opening_balance":
        return "Opening balance";
      case "termination_payout":
        return "Termination payout";
      case "termination_forfeit":
        return "Termination forfeit";
      default:
        return t.replace(/_/g, " ");
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Link
          href="/users"
          className="inline-flex items-center gap-2 text-sm font-medium text-orange-800 hover:text-orange-950"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Users
        </Link>
      </div>

      {/*
       * Hero strip — replaces the old plain title row. Big avatar (initials)
       * so the page reads like "this is a person" instead of a settings form.
       * Store + position chips give one-glance org context. Stays compact on
       * mobile; the chips wrap below the name.
       */}
      <div className="rounded-2xl border border-slate-200 bg-gradient-to-br from-orange-50 via-white to-amber-50 p-5 shadow-sm sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
          <div
            className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-orange-500 to-orange-700 text-2xl font-bold text-white shadow-md ring-4 ring-white sm:h-20 sm:w-20 sm:text-3xl"
            aria-hidden
          >
            {initials}
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
              {fullName}
            </h1>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {storeName ? (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1 text-xs font-semibold text-slate-800 shadow-sm ring-1 ring-slate-200">
                  <MapPin className="h-3.5 w-3.5 text-orange-600" aria-hidden />
                  Home: {storeName}
                </span>
              ) : null}
              {additionalStoreNames.map((name) => (
                <span
                  key={name}
                  className="inline-flex items-center gap-1.5 rounded-full bg-orange-50 px-3 py-1 text-xs font-semibold text-orange-950 ring-1 ring-orange-200/80"
                >
                  <MapPin className="h-3.5 w-3.5 text-orange-600" aria-hidden />
                  Also: {name}
                </span>
              ))}
              {role ? (
                /*
                 * Role badge — louder than the store chip on purpose. The role
                 * (Manager / Cashier / etc.) is the single most important
                 * signal when a manager opens this page mid-shift.
                 */
                <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-900 px-3 py-1 text-xs font-bold uppercase tracking-wide text-white shadow-sm">
                  <Briefcase className="h-3.5 w-3.5" aria-hidden />
                  {role}
                </span>
              ) : null}
              {orgOwnerLocal ? (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-900 ring-1 ring-amber-200">
                  Company owner
                </span>
              ) : null}
              {isArchivedProfile ? (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-200 px-3 py-1 text-xs font-semibold text-slate-700 ring-1 ring-slate-300">
                  Archived
                </span>
              ) : null}
            </div>
            <p className="mt-3 text-sm text-slate-600">
              {canEdit
                ? "Update contact details, employment data, and access settings."
                : "View profile details. Edits require user-management permission."}
            </p>
          </div>
        </div>
      </div>

      {isArchivedProfile ? (
        <div className="flex flex-col gap-3 rounded-lg border border-slate-300 bg-slate-100 px-4 py-3 text-sm text-slate-800 sm:flex-row sm:items-center sm:justify-between">
          <p className="min-w-0">
            This user is <strong className="font-semibold">archived</strong>
            {archivedAt ? (
              <>
                {" "}
                <span className="text-slate-600">({fmtDisplayDateTime(archivedAt)})</span>
              </>
            ) : null}
            . The record is kept for payroll and audit; it no longer appears in active lists and
            can&apos;t clock in. Edits are disabled while archived.
          </p>
          {canArchiveUser ? (
            <button
              type="button"
              disabled={pending}
              className={`${PRIMARY_ORANGE_CTA} shrink-0 px-3.5 py-2 text-xs disabled:opacity-50`}
              onClick={() => {
                if (
                  !window.confirm(
                    `Restore ${first_name} ${last_name}? They'll move back to active users and be stamped as a rehire (their original employment start date is preserved).`,
                  )
                ) {
                  return;
                }
                setMessage(null);
                startTransition(async () => {
                  const r = await restoreEmployee(initial.id);
                  if (!r.ok) {
                    setMessage({ kind: "err", text: r.error });
                    return;
                  }
                  setMessage({
                    kind: "ok",
                    text: `Welcome back — ${first_name} ${last_name} is active again.`,
                  });
                  router.refresh();
                });
              }}
            >
              {pending ? "Restoring…" : "Restore user (rehire)"}
            </button>
          ) : null}
        </div>
      ) : null}

      {message ? (
        <p
          className={`rounded-lg px-4 py-3 text-sm ${
            message.kind === "ok"
              ? "border border-emerald-200 bg-emerald-50 text-emerald-900"
              : "border border-red-200 bg-red-50 text-red-800"
          }`}
        >
          {message.text}
        </p>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,22rem)_1fr] xl:grid-cols-[minmax(0,24rem)_minmax(0,1fr)_minmax(0,18rem)]">
        <form
          onSubmit={onSubmit}
          className="space-y-6 lg:col-span-1 xl:col-span-2"
          id="employee-profile-form"
        >
          <div className={sectionCard}>
            <div className="flex items-center gap-2">
              <Phone className="h-4 w-4 text-orange-600" aria-hidden />
              <h2 className="text-sm font-semibold text-slate-900">Contact</h2>
            </div>
            <p className="mt-0.5 text-xs text-slate-500">
              How {first_name?.trim() || "this person"} is reached. Updating email here also
              updates their login.
            </p>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-1">
                <label className={labelCls} htmlFor="first_name">
                  <UserRound className="h-3.5 w-3.5" aria-hidden />
                  First name
                </label>
                <input
                  id="first_name"
                  className={inputCls}
                  value={first_name}
                  onChange={(e) => setFirstName(e.target.value)}
                  disabled={!canEdit || pending}
                  autoComplete="given-name"
                />
              </div>
              <div className="sm:col-span-1">
                <label className={labelCls} htmlFor="last_name">
                  <UserRound className="h-3.5 w-3.5" aria-hidden />
                  Last name
                </label>
                <input
                  id="last_name"
                  className={inputCls}
                  value={last_name}
                  onChange={(e) => setLastName(e.target.value)}
                  disabled={!canEdit || pending}
                  autoComplete="family-name"
                />
              </div>
              <div className="sm:col-span-2">
                <label className={labelCls} htmlFor="mobile_phone">
                  <Phone className="h-3.5 w-3.5" aria-hidden />
                  Mobile phone
                </label>
                <input
                  id="mobile_phone"
                  type="tel"
                  className={inputCls}
                  value={mobile_phone}
                  onChange={(e) => setMobilePhone(e.target.value)}
                  disabled={!canEdit || pending}
                  autoComplete="tel"
                />
              </div>
              <div className="sm:col-span-1">
                <label className={labelCls} htmlFor="gender">
                  <UserRound className="h-3.5 w-3.5" aria-hidden />
                  Gender
                </label>
                <select
                  id="gender"
                  className={inputCls}
                  value={gender}
                  onChange={(e) => setGender(e.target.value)}
                  disabled={!canEdit || pending}
                >
                  {GENDER_OPTIONS.map((opt) => (
                    <option key={opt.value || "unset"} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="sm:col-span-2">
                <label className={labelCls} htmlFor="email">
                  <Mail className="h-3.5 w-3.5" aria-hidden />
                  Email
                </label>
                <input
                  id="email"
                  type="email"
                  className={inputCls}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={!canEdit || pending}
                  autoComplete="email"
                />
              </div>
            </div>
          </div>

          <div className={sectionCard}>
            <div className="flex items-center gap-2">
              <Briefcase className="h-4 w-4 text-orange-600" aria-hidden />
              <h2 className="text-sm font-semibold text-slate-900">Work</h2>
            </div>
            <p className="mt-0.5 text-xs text-slate-500">
              Title, store, reporting line, and HR identifiers. Hire and rehire dates drive
              vacation and sick accrual tiers.
            </p>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-1">
                <label className={labelCls} htmlFor="employment_start_date">
                  <Calendar className="h-3.5 w-3.5" aria-hidden />
                  Hire date
                </label>
                <input
                  id="employment_start_date"
                  type="date"
                  className={inputCls}
                  value={employment_start_date}
                  onChange={(e) => setEmploymentStart(e.target.value)}
                  disabled={!canEdit || pending}
                />
                <p className="mt-1 text-xs text-slate-500">
                  Original start date. Used for PTO when no rehire date is set.
                </p>
              </div>
              <div className="sm:col-span-1">
                <label className={labelCls} htmlFor="rehire_date">
                  <CalendarDays className="h-3.5 w-3.5" aria-hidden />
                  Rehire date
                </label>
                <input
                  id="rehire_date"
                  type="date"
                  className={inputCls}
                  value={rehire_date}
                  onChange={(e) => setRehireDate(e.target.value)}
                  disabled={!canEdit || pending}
                />
                <p className="mt-1 text-xs text-slate-500">
                  When set, vacation and sick tiers count years of service from this date
                  instead of hire date (e.g. returning employees).
                </p>
              </div>
              <div className="sm:col-span-1">
                <label className={labelCls} htmlFor="birth_date">
                  <Gift className="h-3.5 w-3.5" aria-hidden />
                  Birthday
                </label>
                <input
                  id="birth_date"
                  type="date"
                  className={inputCls}
                  value={birth_date}
                  onChange={(e) => setBirthDate(e.target.value)}
                  disabled={!canEdit || pending}
                />
              </div>
              <div className="sm:col-span-1">
                <label className={labelCls} htmlFor="employment_type">
                  <Clock className="h-3.5 w-3.5" aria-hidden />
                  Employment type
                </label>
                <select
                  id="employment_type"
                  className={inputCls}
                  value={Number(fte) >= 0.75 ? "full" : "half"}
                  onChange={(e) => setFte(e.target.value === "full" ? "1.0" : "0.5")}
                  disabled={!canEdit || pending}
                >
                  <option value="full">Full time</option>
                  <option value="half">Half time</option>
                </select>
                <p className="mt-1 text-xs text-slate-500">
                  Full time maps to 1.0 FTE. Half time maps to 0.5 FTE.
                </p>
              </div>
              <div className="sm:col-span-1">
                <label className={labelCls} htmlFor="standard_hours_per_week">
                  <Clock className="h-3.5 w-3.5" aria-hidden />
                  Standard hours / week
                </label>
                <input
                  id="standard_hours_per_week"
                  inputMode="decimal"
                  className={inputCls}
                  value={standard_hours_per_week}
                  onChange={(e) => setStandardHoursPerWeek(e.target.value)}
                  disabled={!canEdit || pending}
                  placeholder="40"
                />
              </div>
              <div className="sm:col-span-1">
                <label className={labelCls} htmlFor="role">
                  <Briefcase className="h-3.5 w-3.5" aria-hidden />
                  Position
                </label>
                <select
                  id="role"
                  className={inputCls}
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                  disabled={!canEdit || pending}
                >
                  {role &&
                  !POSITION_ROLE_OPTIONS.includes(
                    role as (typeof POSITION_ROLE_OPTIONS)[number],
                  ) ? (
                    <option value={role}>{role}</option>
                  ) : null}
                  {POSITION_ROLE_OPTIONS.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
              </div>
              <div className="sm:col-span-1">
                <label className={labelCls} htmlFor="location_id">
                  <MapPin className="h-3.5 w-3.5" aria-hidden />
                  Home store
                </label>
                <select
                  id="location_id"
                  className={inputCls}
                  value={location_id}
                  onChange={(e) => {
                    const next = e.target.value;
                    setLocationId(next);
                    setAdditionalLocationIds((prev) => prev.filter((id) => id !== next));
                    setDirectManagerId((prev) => {
                      const keep = storeManagers.some(
                        (m) => m.id === prev && m.location_id === next,
                      );
                      return keep ? prev : "";
                    });
                  }}
                  disabled={!canEdit || pending}
                >
                  <option value="">Select home store…</option>
                  {locations.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-slate-500">
                  Primary location for scheduling defaults and reporting.
                </p>
              </div>
              <div className="sm:col-span-2">
                <span className={labelCls}>
                  <MapPin className="h-3.5 w-3.5" aria-hidden />
                  Also works at
                </span>
                {!location_id ? (
                  <p className="mt-2 text-xs text-slate-500">Choose a home store first.</p>
                ) : additionalStoreOptions.length === 0 ? (
                  <p className="mt-2 text-xs text-slate-500">No other stores available.</p>
                ) : (
                  <div
                    className="mt-2 max-h-44 overflow-y-auto rounded-lg border border-slate-200 bg-slate-50/50 p-3"
                    role="group"
                    aria-label="Additional store assignments"
                  >
                    <div className="grid gap-2 sm:grid-cols-2">
                      {additionalStoreOptions.map((l) => {
                        const checked = additional_location_ids.includes(l.id);
                        return (
                          <label
                            key={l.id}
                            className={`flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm ${
                              checked ? "bg-orange-50 text-orange-950" : "text-slate-700"
                            } ${!canEdit || pending ? "cursor-default opacity-70" : "hover:bg-white"}`}
                          >
                            <input
                              type="checkbox"
                              className="rounded border-slate-300 text-orange-600 focus:ring-orange-500"
                              checked={checked}
                              disabled={!canEdit || pending}
                              onChange={() => toggleAdditionalStore(l.id)}
                            />
                            <span className="truncate">{l.name}</span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                )}
                <p className="mt-1.5 text-xs text-slate-500">
                  Select every other store this employee can clock in or be scheduled at.
                </p>
              </div>
              <div className="sm:col-span-2">
                <label className={labelCls} htmlFor="direct_manager_id">
                  <UsersIcon className="h-3.5 w-3.5" aria-hidden />
                  Direct manager
                </label>
                <select
                  id="direct_manager_id"
                  className={inputCls}
                  value={direct_manager_id}
                  onChange={(e) => setDirectManagerId(e.target.value)}
                  disabled={!canEdit || pending || !location_id}
                >
                  <option value="">None</option>
                  {managersForStore.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.full_name?.trim() ||
                        [m.first_name, m.last_name].filter(Boolean).join(" ") ||
                        "—"}
                    </option>
                  ))}
                </select>
                {!location_id ? (
                  <p className="mt-1 text-xs text-slate-500">Choose a store first.</p>
                ) : managersForStore.length === 0 ? (
                  <p className="mt-1 text-xs text-amber-700">
                    No Store Manager assigned to this store yet.
                  </p>
                ) : null}
              </div>
              <div className="sm:col-span-2">
                <label className={labelCls} htmlFor="employee_code">
                  <IdCard className="h-3.5 w-3.5" aria-hidden />
                  Employee ID
                </label>
                <input
                  id="employee_code"
                  className={inputCls}
                  value={employee_code}
                  onChange={(e) => setEmployeeCode(e.target.value)}
                  disabled={!canEdit || pending}
                  placeholder="HR / payroll ID"
                />
              </div>
            </div>
          </div>

          {canSetOrgOwner ? (
            <PtoLifecycleSection
              canEdit={canEdit}
              pending={pending}
              ptoCohort={pto_cohort}
              onChangePtoCohort={setPtoCohort}
              terminationReason={termination_reason}
              onChangeTerminationReason={setTerminationReason}
              terminationAt={termination_at}
              onChangeTerminationAt={setTerminationAt}
              inputCls={inputCls}
              labelCls={labelCls}
              sectionCard={sectionCard}
            />
          ) : null}

          {canArchiveUser && !isArchivedProfile ? (
            <div className={sectionCard}>
              <h2 className="text-sm font-semibold text-slate-900">Archive user</h2>
              <p className="mt-0.5 text-xs text-slate-500">
                Company policy: people are not deleted from the system. Archiving moves them to the
                <strong className="font-semibold"> Archived </strong>
                tab and blocks time clock and active directory use.
              </p>
              <button
                type="button"
                disabled={pending}
                className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm font-medium text-red-900 hover:bg-red-100 disabled:opacity-50"
                onClick={() => {
                  if (
                    !window.confirm(
                      `Archive ${first_name} ${last_name}? They will be moved to Archived users and cannot clock in.`,
                    )
                  ) {
                    return;
                  }
                  setMessage(null);
                  startTransition(async () => {
                    const r = await archiveEmployee(initial.id);
                    if (!r.ok) {
                      setMessage({ kind: "err", text: r.error });
                      return;
                    }
                    setMessage({ kind: "ok", text: "User archived." });
                    router.refresh();
                    router.push("/users?tab=archived");
                  });
                }}
              >
                {pending ? "Archiving…" : "Archive this user"}
              </button>
            </div>
          ) : null}

          {canSetOrgOwner || isOrgOwner ? (
            <div className={sectionCard}>
              <h2 className="text-sm font-semibold text-slate-900">Company owner</h2>
              <p className="mt-0.5 text-xs text-slate-500">
                Company owners can promote Store Managers, edit admin access, assign store leads, and
                view the security audit log. Keep at least one company owner at all times.
              </p>
              {canSetOrgOwner ? (
                <label className="mt-4 flex cursor-pointer items-start gap-3">
                  <input
                    type="checkbox"
                    className="mt-1 h-4 w-4 rounded border-slate-300 text-orange-600 focus:ring-orange-500"
                    checked={orgOwnerLocal}
                    disabled={pending}
                    onChange={() => {
                      const next = !orgOwnerLocal;
                      setMessage(null);
                      startTransition(async () => {
                        const r = await setEmployeeOrgOwner(initial.id, next);
                        if (!r.ok) {
                          setMessage({ kind: "err", text: r.error });
                          return;
                        }
                        setOrgOwnerLocal(next);
                        setRole(next ? "Org Owner" : "Employee");
                        setMessage({
                          kind: "ok",
                          text: next
                            ? "Saved as company owner."
                            : "Company owner removed; role set to Employee.",
                        });
                        router.refresh();
                      });
                    }}
                  />
                  <span className="text-sm text-slate-800">
                    <span className="font-medium">Company owner</span>
                    <span className="mt-0.5 block text-xs font-normal text-slate-500">
                      Full company-level admin access.
                    </span>
                  </span>
                </label>
              ) : (
                <p className="mt-3 text-sm text-slate-700">
                  This person is a <strong className="font-semibold">company owner</strong>. Only
                  company owners can add or remove this access.
                </p>
              )}
            </div>
          ) : null}

          {canEdit ? (
            <div className="flex justify-end">
              <button
                type="submit"
                form="employee-profile-form"
                disabled={pending}
                className={`${PRIMARY_ORANGE_CTA} px-5 py-2.5 text-sm disabled:opacity-60`}
              >
                {pending ? "Saving…" : "Save changes"}
              </button>
            </div>
          ) : (
            <p className="text-sm text-slate-500">
              You can view this profile, but only users with user-management permission can edit
              fields.
            </p>
          )}
        </form>

        <aside className="space-y-4 lg:col-span-1 xl:col-span-1">
          {ptoPanel ? (
            <div className={sectionCard}>
              <div className="flex items-center gap-2">
                <CalendarDays className="h-4 w-4 text-orange-600" aria-hidden />
                <h2 className="text-sm font-semibold text-slate-900">PTO</h2>
              </div>
              <p className="mt-0.5 text-xs text-slate-500">
                Balances and recent PTO activity (ledger).
              </p>

              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    Vacation balance
                  </p>
                  <p className="mt-1 text-sm font-bold tabular-nums text-slate-900">
                    {ptoPanel.vacationHours.toFixed(1)}h
                  </p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    Sick balance
                  </p>
                  <p className="mt-1 text-sm font-bold tabular-nums text-slate-900">
                    {ptoPanel.sickHours.toFixed(1)}h
                  </p>
                </div>
              </div>

              <div className="mt-3 grid gap-2 sm:grid-cols-3">
                <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    Next cash-out
                  </p>
                  <p className="mt-1 text-sm font-bold tabular-nums text-slate-900">
                    {ptoPanel.vacationCashoutEnabled && ptoPanel.nextVacationCashoutAt
                      ? `${ptoPanel.nextVacationCashoutHours.toFixed(1)}h`
                      : "—"}
                  </p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {ptoPanel.vacationCashoutEnabled
                      ? fmtShortDate(ptoPanel.nextVacationCashoutAt)
                      : "Disabled"}
                  </p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    Last cash-out
                  </p>
                  <p className="mt-1 text-sm font-bold tabular-nums text-slate-900">
                    {ptoPanel.lastVacationCashoutAt
                      ? `${ptoPanel.lastVacationCashoutHours.toFixed(1)}h`
                      : "—"}
                  </p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {fmtShortDate(ptoPanel.lastVacationCashoutAt)}
                  </p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    YTD vacation used
                  </p>
                  <p className="mt-1 text-sm font-bold tabular-nums text-slate-900">
                    {ptoPanel.ytdVacationUsedHours.toFixed(1)}h
                  </p>
                </div>
              </div>

              <div className="mt-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Recent ledger entries
                </p>
                {ptoPanel.ledger.length ? (
                  <ul className="mt-2 space-y-2">
                    {ptoPanel.ledger.map((e) => {
                      const amt = Number.isFinite(e.amount_hours) ? e.amount_hours : 0;
                      const sign = amt > 0 ? "+" : "";
                      const tone =
                        amt > 0
                          ? "text-emerald-800"
                          : amt < 0
                            ? "text-red-800"
                            : "text-slate-700";
                      return (
                        <li
                          key={e.id}
                          className="flex items-start justify-between gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2"
                        >
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium text-slate-900">
                              {ptoTimelineLabel(e.entry_type)}
                            </p>
                            <p className="mt-0.5 text-xs text-slate-500">
                              {fmtShortDate(e.effective_at)}{" "}
                              <span className="text-slate-300">·</span>{" "}
                              {e.bucket}
                              {e.notes ? (
                                <>
                                  {" "}
                                  <span className="text-slate-300">·</span>{" "}
                                  {e.notes}
                                </>
                              ) : null}
                            </p>
                          </div>
                          <p className={`shrink-0 font-mono text-sm font-semibold tabular-nums ${tone}`}>
                            {sign}
                            {amt.toFixed(1)}h
                          </p>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p className="mt-2 text-sm text-slate-500">No PTO ledger entries yet.</p>
                )}
              </div>
            </div>
          ) : null}

          <div className={sectionCard}>
            <div className="flex items-center gap-2">
              <UsersIcon className="h-4 w-4 text-orange-600" aria-hidden />
              <h2 className="text-sm font-semibold text-slate-900">Groups ({groupCount})</h2>
            </div>
            {groupNames.length ? (
              <ul className="mt-3 list-inside list-disc space-y-1 text-sm text-slate-700">
                {groupNames.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-sm text-slate-500">Not assigned to smart groups yet.</p>
            )}
          </div>

          {/*
           * Security — single card for everything access-related: kiosk PIN
           * (revealable), recent login activity, and the immutable account
           * identifiers. Replaces the old "System settings / Usage info /
           * Account" trio so a manager can answer "who logs in here, when,
           * and with what code?" in one glance.
           */}
          <div className={sectionCard}>
            <div className="flex items-center gap-2">
              <KeyRound className="h-4 w-4 text-orange-600" aria-hidden />
              <h2 className="text-sm font-semibold text-slate-900">Security</h2>
            </div>
            <p className="mt-0.5 text-xs text-slate-500">
              Kiosk PIN, login activity, and account identifiers. The kiosk code is hidden by
              default — treat it like a password.
            </p>

            {/*
             * Kiosk code reveal — defaults hidden so an admin reviewing a profile
             * doesn't accidentally leak a code to whoever's looking at the screen.
             * The button toggles between dots (••••) and the literal value, and
             * we keep the field tappable on mobile.
             */}
            <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <KeyRound className="h-3.5 w-3.5" aria-hidden />
                  Kiosk code
                </span>
                {initial.kiosk_code ? (
                  <button
                    type="button"
                    onClick={() => setShowKioskCode((v) => !v)}
                    className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-orange-500/30"
                    aria-pressed={showKioskCode}
                    aria-label={showKioskCode ? "Hide kiosk code" : "Show kiosk code"}
                  >
                    {showKioskCode ? (
                      <>
                        <EyeOff className="h-3.5 w-3.5" aria-hidden /> Hide
                      </>
                    ) : (
                      <>
                        <Eye className="h-3.5 w-3.5" aria-hidden /> Show
                      </>
                    )}
                  </button>
                ) : null}
              </div>
              <p className="mt-1.5 select-all font-mono text-base font-bold tracking-widest text-slate-900">
                {initial.kiosk_code
                  ? showKioskCode
                    ? initial.kiosk_code
                    : "•".repeat(Math.max(4, initial.kiosk_code.length))
                  : "—"}
              </p>
            </div>

            <dl className="mt-4 space-y-3 text-sm">
              <div className="flex items-start justify-between gap-3">
                <dt className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-slate-500">
                  <CalendarDays className="h-3.5 w-3.5" aria-hidden />
                  Last login
                </dt>
                <dd className="text-right text-slate-800">{fmtDisplayDateTime(lastLogin)}</dd>
              </div>
              <div className="flex items-start justify-between gap-3 border-t border-slate-100 pt-3">
                <dt className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-slate-500">
                  <CalendarDays className="h-3.5 w-3.5" aria-hidden />
                  Days in system
                </dt>
                <dd className="font-mono text-slate-800">
                  {daysInSystem !== null ? String(daysInSystem) : "—"}
                </dd>
              </div>
              <div className="flex items-start justify-between gap-3 border-t border-slate-100 pt-3">
                <dt className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-slate-500">
                  <UserRound className="h-3.5 w-3.5" aria-hidden />
                  User ID
                </dt>
                <dd className="truncate font-mono text-xs text-slate-700">{appUserIdDisplay}</dd>
              </div>
              <div className="flex items-start justify-between gap-3 border-t border-slate-100 pt-3">
                <dt className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-slate-500">
                  <UserRound className="h-3.5 w-3.5" aria-hidden />
                  Added via
                </dt>
                <dd className="text-slate-800">{addedViaLabel}</dd>
              </div>
            </dl>

            {/*
             * Device telemetry — quietly tucked at the bottom in a 2×2 muted
             * grid since these are placeholders today. They cost almost no
             * vertical space but the slot is ready when the mobile app starts
             * reporting real values.
             */}
            <div className="mt-4 border-t border-slate-100 pt-3">
              <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                <Smartphone className="h-3 w-3" aria-hidden />
                Device telemetry
              </p>
              <dl className="mt-2 grid grid-cols-2 gap-2 text-xs">
                <div className="rounded-lg bg-slate-50 px-2.5 py-1.5">
                  <dt className="text-[10px] font-medium uppercase tracking-wide text-slate-500">
                    Mobile device
                  </dt>
                  <dd className="mt-0.5 truncate font-mono text-slate-600">—</dd>
                </div>
                <div className="rounded-lg bg-slate-50 px-2.5 py-1.5">
                  <dt className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-slate-500">
                    <Hash className="h-2.5 w-2.5" aria-hidden />
                    Device ID
                  </dt>
                  <dd className="mt-0.5 truncate font-mono text-slate-600">—</dd>
                </div>
                <div className="rounded-lg bg-slate-50 px-2.5 py-1.5">
                  <dt className="text-[10px] font-medium uppercase tracking-wide text-slate-500">
                    OS version
                  </dt>
                  <dd className="mt-0.5 truncate font-mono text-slate-600">—</dd>
                </div>
                <div className="rounded-lg bg-slate-50 px-2.5 py-1.5">
                  <dt className="text-[10px] font-medium uppercase tracking-wide text-slate-500">
                    App version
                  </dt>
                  <dd className="mt-0.5 truncate font-mono text-slate-600">—</dd>
                </div>
              </dl>
              <p className="mt-2 text-[11px] text-slate-400">
                Device fields are placeholders until mobile telemetry is connected.
              </p>
            </div>
          </div>

        </aside>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// PTO classification + termination workflow (Owner-only section)
// ---------------------------------------------------------------------------
// HR's PTO policy needs two extra pieces of data per employee that don't
// belong in the main "personal details" grid:
//
//   1. **PTO classification** — does this person follow the Office, Store
//      Manager, or Store Employee vacation ladder? Leave on Auto to let
//      the system infer from their job title.
//   2. **Termination reason** — when an Owner moves the employee to
//      inactive with a reason, the SQL trigger from migration 077
//      automatically writes the right `termination_payout` or
//      `termination_forfeit` ledger row.
//
// Both are sensitive enough that we hide the section from non-Owners
// (defence in depth — the server action also ignores the fields).

const PTO_COHORT_OPTIONS: Array<{
  value: string;
  label: string;
  hint: string;
}> = [
  {
    value: "",
    label: "Auto-detect from role",
    hint: "Default. The system infers Office / Store manager / Store employee from the job title.",
  },
  {
    value: "office",
    label: "Office",
    hint: "Non-linear ladder: 1y→5d, 2y→10d, 5y→15d, 10y→20d. Vacation usable after the first year.",
  },
  {
    value: "manager",
    label: "Store manager",
    hint: "5 days a year at 1y, +1 per year up to 10 days at 6y.",
  },
  {
    value: "employee",
    label: "Store employee",
    hint: "5 days a year at 2y, +1 per year up to 10 days at 7y.",
  },
];

const TERMINATION_REASON_OPTIONS: Array<{
  value: string;
  label: string;
  hint: string;
  payout: boolean;
}> = [
  {
    value: "",
    label: "Still employed",
    hint: "Leave blank while the employee is active.",
    payout: false,
  },
  {
    value: "resignation",
    label: "Resignation",
    hint: "Voluntary departure — unused vacation is paid out.",
    payout: true,
  },
  {
    value: "layoff",
    label: "Layoff",
    hint: "Position eliminated — unused vacation is paid out.",
    payout: true,
  },
  {
    value: "retirement",
    label: "Retirement",
    hint: "Voluntary — unused vacation is paid out.",
    payout: true,
  },
  {
    value: "for_cause",
    label: "Termination for cause",
    hint: "Dismissed — unused vacation is forfeited per policy.",
    payout: false,
  },
];

function PtoLifecycleSection({
  canEdit,
  pending,
  ptoCohort,
  onChangePtoCohort,
  terminationReason,
  onChangeTerminationReason,
  terminationAt,
  onChangeTerminationAt,
  inputCls,
  labelCls,
  sectionCard,
}: {
  canEdit: boolean;
  pending: boolean;
  ptoCohort: string;
  onChangePtoCohort: (v: string) => void;
  terminationReason: string;
  onChangeTerminationReason: (v: string) => void;
  terminationAt: string;
  onChangeTerminationAt: (v: string) => void;
  inputCls: string;
  labelCls: string;
  sectionCard: string;
}) {
  const selectedCohort = PTO_COHORT_OPTIONS.find((o) => o.value === ptoCohort) ?? PTO_COHORT_OPTIONS[0];
  const selectedReason =
    TERMINATION_REASON_OPTIONS.find((o) => o.value === terminationReason) ??
    TERMINATION_REASON_OPTIONS[0];
  const hasReason = Boolean(terminationReason);

  return (
    <div className={sectionCard}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2.5">
          <span className="mt-0.5 inline-flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200/70">
            <Palmtree className="h-4 w-4" aria-hidden />
          </span>
          <div>
            <h2 className="text-sm font-semibold text-slate-900">PTO &amp; lifecycle</h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Controls which vacation ladder this person earns on, and what
              happens to their unused vacation if they leave.
            </p>
          </div>
        </div>
        <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-900 ring-1 ring-amber-200/80">
          <Sparkles className="h-3 w-3" aria-hidden />
          Owners only
        </span>
      </div>

      <div className="mt-5 space-y-5">
        {/* PTO classification */}
        <div>
          <label className={labelCls} htmlFor="pto_cohort">
            <Briefcase className="h-3.5 w-3.5" aria-hidden />
            PTO classification
          </label>
          <select
            id="pto_cohort"
            className={inputCls}
            value={ptoCohort}
            onChange={(e) => onChangePtoCohort(e.target.value)}
            disabled={!canEdit || pending}
          >
            {PTO_COHORT_OPTIONS.map((o) => (
              <option key={o.value || "auto"} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <p className="mt-1.5 rounded-lg border border-slate-200 bg-slate-50/70 px-3 py-2 text-[11px] leading-relaxed text-slate-600">
            {selectedCohort.hint}
          </p>
        </div>

        <div className="border-t border-slate-100 pt-5">
          {/* Termination reason */}
          <div className="flex items-start gap-2.5">
            <span className="mt-0.5 inline-flex h-7 w-7 items-center justify-center rounded-lg bg-slate-100 text-slate-700">
              <LogOut className="h-3.5 w-3.5" aria-hidden />
            </span>
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-slate-900">
                When this person leaves
              </h3>
              <p className="mt-0.5 text-xs text-slate-500">
                Setting a reason and marking the employee inactive will
                automatically settle their unused vacation per policy.
              </p>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className={labelCls} htmlFor="termination_reason">
                Reason
              </label>
              <select
                id="termination_reason"
                className={inputCls}
                value={terminationReason}
                onChange={(e) => onChangeTerminationReason(e.target.value)}
                disabled={!canEdit || pending}
              >
                {TERMINATION_REASON_OPTIONS.map((o) => (
                  <option key={o.value || "none"} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls} htmlFor="termination_at">
                <CalendarDays className="h-3.5 w-3.5" aria-hidden />
                Effective date
              </label>
              <input
                id="termination_at"
                type="date"
                className={inputCls}
                value={terminationAt}
                onChange={(e) => onChangeTerminationAt(e.target.value)}
                disabled={!canEdit || pending || !hasReason}
                placeholder="—"
              />
              {!hasReason ? (
                <p className="mt-1 text-[11px] text-slate-400">
                  Pick a reason first.
                </p>
              ) : null}
            </div>
          </div>

          {hasReason ? (
            <div
              className={`mt-3 rounded-lg border px-3 py-2 text-[11px] leading-relaxed ${
                selectedReason.payout
                  ? "border-emerald-200 bg-emerald-50/70 text-emerald-900"
                  : "border-amber-200 bg-amber-50/70 text-amber-900"
              }`}
            >
              <span className="font-semibold">
                {selectedReason.payout ? "Pay-out: " : "Forfeit: "}
              </span>
              {selectedReason.hint}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
