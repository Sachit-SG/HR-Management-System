"use client";

import { ChevronDown, Download, MoreHorizontal, Search, SlidersHorizontal } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { AddUsersBulkModal } from "@/components/users/add-users-bulk-modal";
import { AdminPermissionsPopover } from "@/components/users/admin-permissions-popover";
import { JobTitlesPopover } from "@/components/users/job-titles-popover";
import {
  PromoteAdminModal,
  usersTabPromoteCandidates,
} from "@/components/users/promote-admin-modal";
import { PRIMARY_ORANGE_CTA } from "@/lib/ui/primary-orange-cta";
import {
  type DirectoryEmployee,
  type DirectoryTab,
  bucketForEmployee,
  displayFirst,
  displayLast,
  initialsFor,
} from "@/lib/users/directory-buckets";
import { formatAdminAccessSummary } from "@/lib/users/admin-access";
import { EllipsisTd } from "@/components/ui/ellipsis-td";
import { normalizeRoleLabel } from "@/lib/rbac/matrix";
import { promoteEmployeeToAdmin } from "@/app/actions/users-directory";
import { setEmployeeOrgOwner } from "@/app/actions/org-owner-role";
import {
  buildUsersDirectoryCsv,
  downloadUsersDirectoryCsv,
  usersDirectoryCsvFilename,
} from "@/lib/csv/users-directory-csv";

function fmtDate(s: string | null | undefined): string {
  if (!s) return "—";
  try {
    return new Date(s).toLocaleDateString(undefined, {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
  } catch {
    return "—";
  }
}

function fmtDateAdded(s: string): string {
  try {
    return new Date(s).toLocaleDateString(undefined, {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
  } catch {
    return "—";
  }
}

function fmtPhone(s: string | null | undefined): string {
  if (!s?.trim()) return "—";
  return s.trim();
}

function fmtLogin(s: string | null | undefined): string {
  if (!s) return "Never logged in";
  try {
    return new Date(s).toLocaleString(undefined, {
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

function Avatar({ e }: { e: DirectoryEmployee }) {
  return (
    <span
      className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-orange-100 text-xs font-semibold text-orange-950 ring-1 ring-orange-200/80"
      title={e.full_name}
    >
      {initialsFor(e)}
    </span>
  );
}

function AdminToggle({ enabled }: { enabled: boolean }) {
  return (
    <button
      type="button"
      disabled
      className="relative h-6 w-11 shrink-0 cursor-not-allowed rounded-full opacity-80"
      aria-label={enabled ? "Admin tab on" : "Admin tab off"}
    >
      <span
        className={`block h-full w-full rounded-full transition-colors ${
          enabled ? "bg-orange-500" : "bg-slate-200"
        }`}
      />
      <span
        className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
          enabled ? "left-5" : "left-0.5"
        }`}
      />
    </button>
  );
}

/** Checkbox column — stays fixed while the grid scrolls horizontally. */
const stickyHeadCb =
  "sticky left-0 z-30 w-12 min-w-12 border-r border-slate-200 bg-slate-50 px-3 py-3.5 shadow-[4px_0_12px_-6px_rgba(15,23,42,0.12)]";
const stickyBodyCb =
  "sticky left-0 z-20 w-12 min-w-12 border-r border-slate-200 bg-inherit px-3 py-3 align-middle shadow-[4px_0_12px_-6px_rgba(15,23,42,0.08)]";

/** First name (+ avatar) — second sticky band; `left-12` matches checkbox column width. */
const stickyHeadName =
  "sticky left-12 z-30 min-w-[15rem] border-r border-slate-200 bg-slate-50 px-3 py-3.5 shadow-[4px_0_12px_-6px_rgba(15,23,42,0.12)]";
const stickyBodyName =
  "sticky left-12 z-20 min-w-[15rem] max-w-[15rem] overflow-hidden border-r border-slate-200 bg-inherit px-3 py-3 align-middle shadow-[4px_0_12px_-6px_rgba(15,23,42,0.08)]";

const cell = "px-4 py-3 align-middle";
const cellNowrap = "whitespace-nowrap px-4 py-3 align-middle";

type Props = {
  employees: DirectoryEmployee[];
  locationLabel: string;
  /** When not all-locations: new users’ store = this location; direct manager list = its Store Managers. */
  assignmentLocationId: string | null;
  scopeAll: boolean;
  /** Organization owners: edit Store Manager module access presets. */
  canEditAdminAccess: boolean;
  /** Organization owners: promote users to Store Manager. */
  canPromoteToAdmin: boolean;
  /** Store Managers (and owners): bulk-add employees from Admins tab shortcut. */
  canBulkAddFromAdminsTab: boolean;
  /** Store Managers and owners: bulk-add on the Users tab. */
  canManageUsers: boolean;
  /** Admins + owners: edit job title assignments and create job titles. */
  canEditJobTitles: boolean;
  /** Owners only: grant/revoke organization owner access. */
  canSetOrgOwner: boolean;
  /** Prefill search from `?q=` (e.g. Activity → Users). */
  initialSearchQuery?: string;
};

export function UsersDirectory({
  employees,
  locationLabel,
  assignmentLocationId,
  scopeAll,
  canEditAdminAccess,
  canPromoteToAdmin,
  canBulkAddFromAdminsTab,
  canManageUsers,
  canEditJobTitles,
  canSetOrgOwner,
  initialSearchQuery = "",
}: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [query, setQuery] = useState(() => initialSearchQuery);
  const [addUsersOpen, setAddUsersOpen] = useState(false);
  const [addUsersModalKey, setAddUsersModalKey] = useState(0);
  const [addUsersBulkMode, setAddUsersBulkMode] = useState<"default" | "admin_create">("default");
  const [adminAddMenuOpen, setAdminAddMenuOpen] = useState(false);
  const [promoteAdminOpen, setPromoteAdminOpen] = useState(false);
  const adminAddMenuRef = useRef<HTMLDivElement>(null);
  const [rowMenuOpenId, setRowMenuOpenId] = useState<string | null>(null);
  const rowMenuRef = useRef<HTMLDivElement>(null);
  const [rowActionError, setRowActionError] = useState<string | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filterRole, setFilterRole] = useState("");
  const [filterDepartment, setFilterDepartment] = useState("");
  const [filterTeam, setFilterTeam] = useState("");
  const [filterStore, setFilterStore] = useState("");
  const filterPanelRef = useRef<HTMLDivElement>(null);

  const activeFilterCount = [
    filterRole,
    filterDepartment,
    filterTeam,
    scopeAll ? filterStore : "",
  ].filter(Boolean).length;

  useEffect(() => {
    if (!scopeAll && filterStore) setFilterStore("");
  }, [scopeAll, filterStore]);

  const promoteCandidates = useMemo(() => usersTabPromoteCandidates(employees), [employees]);

  useEffect(() => {
    if (!adminAddMenuOpen) return;
    const onPointer = (e: MouseEvent) => {
      if (adminAddMenuRef.current && !adminAddMenuRef.current.contains(e.target as Node)) {
        setAdminAddMenuOpen(false);
      }
    };
    window.addEventListener("mousedown", onPointer);
    return () => window.removeEventListener("mousedown", onPointer);
  }, [adminAddMenuOpen]);

  useEffect(() => {
    if (!rowMenuOpenId) return;
    const onPointer = (e: MouseEvent) => {
      if (rowMenuRef.current && !rowMenuRef.current.contains(e.target as Node)) {
        setRowMenuOpenId(null);
      }
    };
    window.addEventListener("mousedown", onPointer);
    return () => window.removeEventListener("mousedown", onPointer);
  }, [rowMenuOpenId]);

  useEffect(() => {
    if (!filtersOpen) return;
    const onPointer = (e: MouseEvent) => {
      if (filterPanelRef.current && !filterPanelRef.current.contains(e.target as Node)) {
        setFiltersOpen(false);
      }
    };
    window.addEventListener("mousedown", onPointer);
    return () => window.removeEventListener("mousedown", onPointer);
  }, [filtersOpen]);

  const tabParam = searchParams.get("tab");
  const tab: DirectoryTab =
    tabParam === "admins" ? "admins" : tabParam === "archived" ? "archived" : "users";

  const counts = useMemo(() => {
    let users = 0;
    let admins = 0;
    let archived = 0;
    for (const e of employees) {
      const b = bucketForEmployee(e);
      if (b === "users") users += 1;
      else if (b === "admins") admins += 1;
      else archived += 1;
    }
    return { users, admins, archived };
  }, [employees]);

  const rowsForTab = useMemo(
    () => employees.filter((e) => bucketForEmployee(e) === tab),
    [employees, tab],
  );

  const filterOptions = useMemo(() => {
    const roles = new Set<string>();
    const departments = new Set<string>();
    const teams = new Set<string>();
    const stores = new Set<string>();
    for (const e of rowsForTab) {
      if (e.role?.trim()) roles.add(e.role.trim());
      if (e.department?.trim()) departments.add(e.department.trim());
      if (e.team?.trim()) teams.add(e.team.trim());
      if (e.locationName?.trim()) stores.add(e.locationName.trim());
    }
    const sort = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: "base" });
    return {
      roles: [...roles].sort(sort),
      departments: [...departments].sort(sort),
      teams: [...teams].sort(sort),
      stores: [...stores].sort(sort),
    };
  }, [rowsForTab]);

  useEffect(() => {
    if (filterRole && !filterOptions.roles.includes(filterRole)) setFilterRole("");
    if (filterDepartment && !filterOptions.departments.includes(filterDepartment)) {
      setFilterDepartment("");
    }
    if (filterTeam && !filterOptions.teams.includes(filterTeam)) setFilterTeam("");
    if (filterStore && !filterOptions.stores.includes(filterStore)) setFilterStore("");
  }, [filterOptions, filterRole, filterDepartment, filterTeam, filterStore]);

  const filtered = useMemo(() => {
    let list = rowsForTab;
    const q = query.trim().toLowerCase();
    if (q) {
      list = list.filter((e) => {
        const hay = [
          displayFirst(e),
          displayLast(e),
          e.email,
          e.role,
          e.team,
          e.department,
          e.kiosk_code,
          e.added_by,
          e.access_level,
          e.managed_groups,
          e.permissions_label,
          e.locationName,
          e.primaryJobTitle?.name,
          e.secondaryJobTitle?.name,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return hay.includes(q);
      });
    }
    if (filterRole) {
      list = list.filter((e) => (e.role ?? "").trim() === filterRole);
    }
    if (filterDepartment) {
      list = list.filter((e) => (e.department ?? "").trim() === filterDepartment);
    }
    if (filterTeam) {
      list = list.filter((e) => (e.team ?? "").trim() === filterTeam);
    }
    if (filterStore) {
      list = list.filter((e) => (e.locationName ?? "").trim() === filterStore);
    }
    return list;
  }, [rowsForTab, query, filterRole, filterDepartment, filterTeam, filterStore]);

  const clearFilters = useCallback(() => {
    setFilterRole("");
    setFilterDepartment("");
    setFilterTeam("");
    setFilterStore("");
  }, []);

  const setTab = useCallback(
    (next: DirectoryTab) => {
      startTransition(() => {
        const q = new URLSearchParams(searchParams.toString());
        if (next === "users") q.delete("tab");
        else q.set("tab", next);
        const s = q.toString();
        router.push(s ? `/users?${s}` : "/users");
      });
    },
    [router, searchParams],
  );

  const theadUsers = (
    <tr className="border-b border-slate-200 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
      <th className={stickyHeadCb}>
        <input type="checkbox" disabled className="rounded border-slate-300" aria-label="Select all" />
      </th>
      <th className={`${stickyHeadName} whitespace-nowrap`}>First name</th>
      <th className={`${cell} whitespace-nowrap min-w-[7.5rem]`}>Last name</th>
      <th className={`${cell} whitespace-nowrap min-w-[14rem]`}>Email</th>
      <th className={`${cell} whitespace-nowrap min-w-[11rem]`}>Mobile phone</th>
      <th className={`${cell} whitespace-nowrap min-w-[10rem]`}>Store assigned</th>
      <th className={`${cell} whitespace-nowrap min-w-[10rem]`}>Position</th>
      <th className={`${cell} whitespace-nowrap min-w-[10rem]`}>Title</th>
      <th className={`${cellNowrap} min-w-[11rem]`}>Employment start date</th>
      <th className={`${cell} whitespace-nowrap min-w-[8rem]`}>Team</th>
      <th className={`${cell} whitespace-nowrap min-w-[9rem]`}>Department</th>
      <th className={`${cell} whitespace-nowrap min-w-[6.5rem]`}>Kiosk code</th>
      <th className={`${cellNowrap} min-w-[9rem]`}>Date added</th>
      <th className={`${cellNowrap} min-w-[11rem]`}>Last login</th>
      <th className={`${cell} whitespace-nowrap min-w-[8rem]`}>Added by</th>
      <th className={`w-12 min-w-12 px-3 py-3.5 text-right`} aria-label="Actions">
        <span className="text-slate-400">⋯</span>
      </th>
    </tr>
  );

  const theadAdmins = (
    <tr className="border-b border-slate-200 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
      <th className={stickyHeadCb}>
        <input type="checkbox" disabled className="rounded border-slate-300" aria-label="Select all" />
      </th>
      <th className={`${stickyHeadName} whitespace-nowrap`}>First name</th>
      <th className={`${cell} whitespace-nowrap min-w-[7.5rem]`}>Last name</th>
      <th className={`${cell} whitespace-nowrap min-w-[10rem]`}>Access level</th>
      <th className={`${cell} whitespace-nowrap min-w-[10rem]`}>Managed groups</th>
      <th className={`${cell} whitespace-nowrap min-w-[10rem]`}>Permissions</th>
      <th className={`${cell} whitespace-nowrap min-w-[7rem]`}>Admin tab</th>
      <th className={`${cellNowrap} min-w-[11rem]`}>Last login</th>
      <th className={`${cell} whitespace-nowrap min-w-[8rem]`}>Added by</th>
      <th className={`w-12 min-w-12 px-3 py-3.5 text-right`} aria-label="Column settings">
        <span className="text-slate-400">▤</span>
      </th>
    </tr>
  );

  const theadArchived = (
    <tr className="border-b border-slate-200 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
      <th className={stickyHeadCb}>
        <input type="checkbox" disabled className="rounded border-slate-300" aria-label="Select all" />
      </th>
      <th className={`${stickyHeadName} whitespace-nowrap`}>First name</th>
      <th className={`${cell} whitespace-nowrap min-w-[7.5rem]`}>Last name</th>
      <th className={`${cell} whitespace-nowrap min-w-[10rem]`}>Position</th>
      <th className={`${cellNowrap} min-w-[11rem]`}>Employment start date</th>
      <th className={`${cell} whitespace-nowrap min-w-[8rem]`}>Team</th>
      <th className={`${cell} whitespace-nowrap min-w-[9rem]`}>Department</th>
      <th className={`${cell} whitespace-nowrap min-w-[6.5rem]`}>Kiosk code</th>
      <th className={`${cellNowrap} min-w-[9rem]`}>Date added</th>
      <th className={`${cellNowrap} min-w-[11rem]`}>Last login</th>
      <th className={`${cell} whitespace-nowrap min-w-[8rem]`}>Added by</th>
      <th className={`${cellNowrap} min-w-[9rem]`}>Archived at</th>
      <th className={`${cell} whitespace-nowrap min-w-[8rem]`}>Archived by</th>
      <th className={`w-12 min-w-12 px-3 py-3.5 text-right`} aria-label="Column settings">
        <span className="text-slate-400">▤</span>
      </th>
    </tr>
  );

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">Users</h1>
        <p className="mt-1 text-sm text-slate-500">
          Directory scoped to <span className="font-medium text-slate-700">{locationLabel}</span>.
          Tabs, toolbar, and column sets are tailored to each audience.
        </p>
      </div>

      <div className="rounded-2xl border border-slate-200/80 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-4 pt-4">
          <nav className="flex gap-8" aria-label="User categories">
            <button
              type="button"
              disabled={pending}
              onClick={() => setTab("users")}
              className={`border-b-2 pb-3 text-sm font-semibold transition-colors disabled:opacity-50 ${
                tab === "users"
                  ? "border-orange-500 text-orange-900"
                  : "border-transparent text-slate-500 hover:text-slate-800"
              }`}
            >
              Users ({counts.users})
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => setTab("admins")}
              className={`border-b-2 pb-3 text-sm font-semibold transition-colors disabled:opacity-50 ${
                tab === "admins"
                  ? "border-orange-500 text-orange-900"
                  : "border-transparent text-slate-500 hover:text-slate-800"
              }`}
            >
              Admins ({counts.admins})
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => setTab("archived")}
              className={`border-b-2 pb-3 text-sm font-semibold transition-colors disabled:opacity-50 ${
                tab === "archived"
                  ? "border-orange-500 text-orange-900"
                  : "border-transparent text-slate-500 hover:text-slate-800"
              }`}
            >
              Archived ({counts.archived})
            </button>
          </nav>
        </div>

        {rowActionError ? (
          <p className="mx-4 mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            {rowActionError}
          </p>
        ) : null}

        <div className="flex flex-col gap-3 border-b border-slate-100 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative flex flex-1 flex-wrap items-center gap-2" ref={filterPanelRef}>
            <div className="relative min-w-[200px] max-w-md flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                type="search"
                placeholder="Search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-white py-2 pl-10 pr-3 text-sm text-slate-800 placeholder:text-slate-400 focus:border-orange-400 focus:outline-none focus:ring-2 focus:ring-orange-500/20"
              />
            </div>
            <button
              type="button"
              className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition ${
                filtersOpen || activeFilterCount > 0
                  ? "border-orange-300 bg-orange-50 text-orange-900"
                  : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
              }`}
              aria-expanded={filtersOpen}
              onClick={() => setFiltersOpen((o) => !o)}
            >
              <SlidersHorizontal className="h-4 w-4" aria-hidden />
              Filter
              {activeFilterCount > 0 ? (
                <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-orange-600 px-1.5 text-[10px] font-bold text-white">
                  {activeFilterCount}
                </span>
              ) : null}
            </button>
            {filtersOpen ? (
              <div className="absolute left-0 top-full z-40 mt-2 w-full min-w-[min(100%,20rem)] max-w-xl rounded-xl border border-slate-200 bg-white p-4 shadow-lg sm:min-w-[28rem]">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-slate-900">Filter directory</p>
                  {activeFilterCount > 0 ? (
                    <button
                      type="button"
                      className="text-xs font-semibold text-orange-700 hover:underline"
                      onClick={clearFilters}
                    >
                      Clear all
                    </button>
                  ) : null}
                </div>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <label className="block text-xs font-medium text-slate-600">
                    Position
                    <select
                      value={filterRole}
                      onChange={(e) => setFilterRole(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800"
                    >
                      <option value="">All positions</option>
                      {filterOptions.roles.map((role) => (
                        <option key={role} value={role}>
                          {role}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block text-xs font-medium text-slate-600">
                    Department
                    <select
                      value={filterDepartment}
                      onChange={(e) => setFilterDepartment(e.target.value)}
                      disabled={filterOptions.departments.length === 0}
                      className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400"
                    >
                      <option value="">
                        {filterOptions.departments.length === 0
                          ? "No departments on file"
                          : "All departments"}
                      </option>
                      {filterOptions.departments.map((d) => (
                        <option key={d} value={d}>
                          {d}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block text-xs font-medium text-slate-600">
                    Team
                    <select
                      value={filterTeam}
                      onChange={(e) => setFilterTeam(e.target.value)}
                      disabled={filterOptions.teams.length === 0}
                      className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400"
                    >
                      <option value="">
                        {filterOptions.teams.length === 0 ? "No teams on file" : "All teams"}
                      </option>
                      {filterOptions.teams.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                  </label>
                  {scopeAll ? (
                    <label className="block text-xs font-medium text-slate-600">
                      Store
                      <select
                        value={filterStore}
                        onChange={(e) => setFilterStore(e.target.value)}
                        className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800"
                      >
                        <option value="">All stores</option>
                        {filterOptions.stores.map((s) => (
                          <option key={s} value={s}>
                            {s}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : null}
                </div>
                <p className="mt-3 text-xs text-slate-500">
                  Showing {filtered.length} of {rowsForTab.length} in this tab
                  {locationLabel ? ` · scoped to ${locationLabel}` : ""}.
                </p>
              </div>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={filtered.length === 0}
              title={
                filtered.length === 0
                  ? "Nothing to export — no users match the current filters."
                  : `Export ${filtered.length} ${filtered.length === 1 ? "user" : "users"} to CSV`
              }
              aria-label="Export users to CSV"
              onClick={() => {
                const csv = buildUsersDirectoryCsv(filtered);
                const filename = usersDirectoryCsvFilename(tab);
                downloadUsersDirectoryCsv(csv, filename);
              }}
            >
              <Download className="h-4 w-4" aria-hidden />
              Export CSV
            </button>
            {tab === "admins" && (canPromoteToAdmin || canBulkAddFromAdminsTab) ? (
              <div className="relative" ref={adminAddMenuRef}>
                <button
                  type="button"
                  className={`${PRIMARY_ORANGE_CTA} inline-flex items-center gap-1.5 px-4 py-2.5 text-sm`}
                  aria-expanded={adminAddMenuOpen}
                  aria-haspopup="menu"
                  onClick={() => setAdminAddMenuOpen((v) => !v)}
                  title="Add admins"
                >
                  Add admins
                  <ChevronDown className="h-4 w-4 opacity-90" />
                </button>
                {adminAddMenuOpen ? (
                  <div
                    role="menu"
                    className="absolute right-0 top-full z-50 mt-1.5 min-w-[14rem] rounded-md border border-slate-200 bg-white py-1 shadow-lg"
                  >
                    {canPromoteToAdmin ? (
                      <button
                        role="menuitem"
                        type="button"
                        className="block w-full px-4 py-2.5 text-left text-sm text-slate-800 hover:bg-slate-50"
                        onClick={() => {
                          setAdminAddMenuOpen(false);
                          setPromoteAdminOpen(true);
                        }}
                      >
                        Promote existing user
                      </button>
                    ) : null}
                    {canBulkAddFromAdminsTab ? (
                      <button
                        role="menuitem"
                        type="button"
                        className="block w-full px-4 py-2.5 text-left text-sm text-slate-800 hover:bg-slate-50"
                        onClick={() => {
                          setAdminAddMenuOpen(false);
                          setAddUsersBulkMode("admin_create");
                          setAddUsersModalKey((k) => k + 1);
                          setAddUsersOpen(true);
                        }}
                      >
                        Create new user
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : tab === "admins" ? null : canManageUsers ? (
              <button
                type="button"
                className={`${PRIMARY_ORANGE_CTA} inline-flex px-4 py-2.5 text-sm`}
                onClick={() => {
                  setAddUsersBulkMode("default");
                  setAddUsersModalKey((k) => k + 1);
                  setAddUsersOpen(true);
                }}
                title="Add multiple users in bulk."
              >
                Add users
              </button>
            ) : null}
          </div>
        </div>

        <div
          className="overflow-x-auto overscroll-x-contain scroll-smooth"
          role="region"
          aria-label="User directory table"
        >
          {tab === "users" && (
            <table className="min-w-[2040px] w-full table-auto text-left text-sm">
              <thead>{theadUsers}</thead>
              <tbody className="text-slate-800">
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={16} className="px-4 py-12 text-center text-slate-500">
                      No users in this tab. Run migration{" "}
                      <code className="rounded bg-slate-100 px-1">009_employees_directory_connecteam.sql</code>{" "}
                      for full columns.
                    </td>
                  </tr>
                ) : (
                  filtered.map((e, i) => (
                    <tr
                      key={e.id}
                      className={`border-b border-slate-100 ${
                        i % 2 === 1 ? "bg-slate-50/80" : "bg-white"
                      }`}
                    >
                      <td className={stickyBodyCb}>
                        <input type="checkbox" disabled className="rounded border-slate-300" />
                      </td>
                      <td className={stickyBodyName}>
                        <div className="flex min-w-0 items-center gap-2">
                          <Avatar e={e} />
                          <Link
                            href={`/users/${e.id}`}
                            className="min-w-0 truncate font-medium text-orange-900 hover:text-orange-950 hover:underline"
                            title={displayFirst(e)}
                          >
                            {displayFirst(e)}
                          </Link>
                        </div>
                      </td>
                      <EllipsisTd maxClass="max-w-[7.5rem]" title={displayLast(e) || undefined}>
                        <Link
                          href={`/users/${e.id}`}
                          className="block truncate text-slate-800 hover:text-orange-900 hover:underline"
                        >
                          {displayLast(e)}
                        </Link>
                      </EllipsisTd>
                      <EllipsisTd maxClass="max-w-[14rem]" title={e.email ?? undefined}>
                        <span className="text-slate-600">{e.email ?? "—"}</span>
                      </EllipsisTd>
                      <EllipsisTd maxClass="max-w-[11rem]" title={fmtPhone(e.mobile_phone)}>
                        <span className="font-mono text-xs text-slate-600">{fmtPhone(e.mobile_phone)}</span>
                      </EllipsisTd>
                      <EllipsisTd maxClass="max-w-[10rem]" title={e.locationName ?? undefined}>
                        <span className="text-slate-600">{e.locationName ?? "—"}</span>
                      </EllipsisTd>
                      <td className={`${cell} min-w-[10rem] text-slate-600`}>
                        <JobTitlesPopover
                          employeeId={e.id}
                          primary={e.primaryJobTitle}
                          secondary={e.secondaryJobTitle}
                          canEdit={canEditJobTitles}
                          mode="primary"
                        />
                      </td>
                      <td className={`${cell} min-w-[10rem] text-slate-600`}>
                        <JobTitlesPopover
                          employeeId={e.id}
                          primary={e.primaryJobTitle}
                          secondary={e.secondaryJobTitle}
                          canEdit={canEditJobTitles}
                          mode="secondary"
                        />
                      </td>
                      <EllipsisTd maxClass="max-w-[11rem]" title={fmtDate(e.employment_start_date)}>
                        <span className="text-slate-600">{fmtDate(e.employment_start_date)}</span>
                      </EllipsisTd>
                      <EllipsisTd maxClass="max-w-[8rem]" title={e.team ?? undefined}>
                        <span className="text-slate-600">{e.team ?? "—"}</span>
                      </EllipsisTd>
                      <EllipsisTd maxClass="max-w-[9rem]" title={e.department ?? undefined}>
                        <span className="text-slate-600">{e.department ?? "—"}</span>
                      </EllipsisTd>
                      <EllipsisTd maxClass="max-w-[6.5rem]" title={e.kiosk_code ?? undefined}>
                        <span className="font-mono text-xs text-slate-600">{e.kiosk_code ?? "—"}</span>
                      </EllipsisTd>
                      <EllipsisTd maxClass="max-w-[9rem]" title={fmtDateAdded(e.created_at)}>
                        <span className="text-slate-600">{fmtDateAdded(e.created_at)}</span>
                      </EllipsisTd>
                      <EllipsisTd maxClass="max-w-[11rem]" title={fmtLogin(e.last_login)}>
                        <span className="text-slate-600">{fmtLogin(e.last_login)}</span>
                      </EllipsisTd>
                      <EllipsisTd maxClass="max-w-[8rem]" title={e.added_by ?? undefined}>
                        <span className="text-slate-600">{e.added_by ?? "—"}</span>
                      </EllipsisTd>
                      <td className={`${cell} w-12 min-w-12 text-right`}>
                        {(canPromoteToAdmin || canSetOrgOwner) ? (
                          <div className="relative inline-flex justify-end" ref={rowMenuRef}>
                            <button
                              type="button"
                              className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
                              aria-label="Row actions"
                              aria-expanded={rowMenuOpenId === e.id}
                              onClick={() => {
                                setRowActionError(null);
                                setRowMenuOpenId((cur) => (cur === e.id ? null : e.id));
                              }}
                            >
                              <MoreHorizontal className="h-4 w-4" />
                            </button>
                            {rowMenuOpenId === e.id ? (
                              <div className="absolute right-0 top-full z-50 mt-1 w-48 rounded-md border border-slate-200 bg-white py-1 shadow-lg">
                                {canPromoteToAdmin ? (
                                  <button
                                    type="button"
                                    className="block w-full px-3 py-2 text-left text-sm text-slate-800 hover:bg-slate-50"
                                    onClick={() => {
                                      setRowMenuOpenId(null);
                                      setRowActionError(null);
                                      startTransition(async () => {
                                        const r = await promoteEmployeeToAdmin(e.id);
                                        if (!r.ok) setRowActionError(r.error);
                                        else router.refresh();
                                      });
                                    }}
                                  >
                                    Promote to Admin
                                  </button>
                                ) : null}
                                {canSetOrgOwner ? (
                                  <button
                                    type="button"
                                    className="block w-full px-3 py-2 text-left text-sm text-slate-800 hover:bg-slate-50"
                                    onClick={() => {
                                      const isOwner = normalizeRoleLabel(e.role) === "owner";
                                      setRowMenuOpenId(null);
                                      setRowActionError(null);
                                      startTransition(async () => {
                                        const r = await setEmployeeOrgOwner(e.id, !isOwner);
                                        if (!r.ok) setRowActionError(r.error);
                                        else router.refresh();
                                      });
                                    }}
                                  >
                                    Toggle Owner
                                  </button>
                                ) : null}
                              </div>
                            ) : null}
                          </div>
                        ) : null}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          )}

          {tab === "admins" && (
            <table className="min-w-[1280px] w-full table-auto text-left text-sm">
              <thead>{theadAdmins}</thead>
              <tbody className="text-slate-800">
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={11} className="px-4 py-12 text-center text-slate-500">
                      No admins in this scope. Store Manager roles appear here.
                    </td>
                  </tr>
                ) : (
                  filtered.map((e, i) => (
                    <tr
                      key={e.id}
                      className={`border-b border-slate-100 ${
                        i % 2 === 1 ? "bg-slate-50/80" : "bg-white"
                      }`}
                    >
                      <td className={stickyBodyCb}>
                        <input type="checkbox" disabled className="rounded border-slate-300" />
                      </td>
                      <td className={stickyBodyName}>
                        <div className="flex min-w-0 items-center gap-2">
                          <Avatar e={e} />
                          <Link
                            href={`/users/${e.id}`}
                            className="min-w-0 truncate font-medium text-orange-900 hover:text-orange-950 hover:underline"
                            title={displayFirst(e)}
                          >
                            {displayFirst(e)}
                          </Link>
                        </div>
                      </td>
                      <EllipsisTd maxClass="max-w-[7.5rem]" title={displayLast(e) || undefined}>
                        <Link
                          href={`/users/${e.id}`}
                          className="block truncate text-slate-800 hover:text-orange-900 hover:underline"
                        >
                          {displayLast(e)}
                        </Link>
                      </EllipsisTd>
                      <td className={`${cell} max-w-[10rem] min-w-0 overflow-hidden`}>
                        <button
                          type="button"
                          disabled
                          className="inline-flex max-w-full items-center gap-1 truncate rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-800 shadow-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-70"
                          title="Access level — editable when backend is connected."
                        >
                          <span className="truncate">{e.access_level ?? "Store admin"}</span>
                          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-slate-500" />
                        </button>
                      </td>
                      <EllipsisTd maxClass="max-w-[10rem]" title={e.managed_groups ?? undefined}>
                        <span className="text-slate-600">{e.managed_groups ?? "—"}</span>
                      </EllipsisTd>
                      <td className={`${cell} max-w-[10rem] min-w-0 overflow-hidden text-slate-600`}>
                        <AdminPermissionsPopover
                          employeeId={e.id}
                          access={e.admin_access}
                          displayLabel={
                            e.permissions_label?.trim() ||
                            formatAdminAccessSummary(e.admin_access)
                          }
                          canEdit={
                            canEditAdminAccess &&
                            normalizeRoleLabel(e.role) === "store_manager"
                          }
                        />
                      </td>
                      <td className={cell}>
                        <AdminToggle enabled={Boolean(e.admin_tab_enabled)} />
                      </td>
                      <EllipsisTd maxClass="max-w-[11rem]" title={fmtLogin(e.last_login)}>
                        <span className="text-slate-600">{fmtLogin(e.last_login)}</span>
                      </EllipsisTd>
                      <EllipsisTd maxClass="max-w-[8rem]" title={e.added_by ?? undefined}>
                        <span className="text-slate-600">{e.added_by ?? "—"}</span>
                      </EllipsisTd>
                      <td className={`${cell} w-12 min-w-12`} />
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          )}

          {tab === "archived" && (
            <table className="min-w-[1780px] w-full table-auto text-left text-sm">
              <thead>{theadArchived}</thead>
              <tbody className="text-slate-800">
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={14} className="px-4 py-12 text-center text-slate-500">
                      No archived people. Mark rows as archived in the database (
                      <code className="rounded bg-slate-100 px-1">status = archived</code>
                      ) or move inactive profiles here.
                    </td>
                  </tr>
                ) : (
                  filtered.map((e, i) => (
                    <tr
                      key={e.id}
                      className={`border-b border-slate-100 ${
                        i % 2 === 1 ? "bg-slate-50/80" : "bg-white"
                      }`}
                    >
                      <td className={stickyBodyCb}>
                        <input type="checkbox" disabled className="rounded border-slate-300" />
                      </td>
                      <td className={stickyBodyName}>
                        <div className="flex min-w-0 items-center gap-2">
                          <Avatar e={e} />
                          <Link
                            href={`/users/${e.id}`}
                            className="min-w-0 truncate font-medium text-orange-900 hover:text-orange-950 hover:underline"
                            title={displayFirst(e)}
                          >
                            {displayFirst(e)}
                          </Link>
                        </div>
                      </td>
                      <EllipsisTd maxClass="max-w-[7.5rem]" title={displayLast(e) || undefined}>
                        <Link
                          href={`/users/${e.id}`}
                          className="block truncate text-slate-800 hover:text-orange-900 hover:underline"
                        >
                          {displayLast(e)}
                        </Link>
                      </EllipsisTd>
                      <EllipsisTd maxClass="max-w-[10rem]" title={e.role || undefined}>
                        {e.role || "—"}
                      </EllipsisTd>
                      <EllipsisTd maxClass="max-w-[11rem]" title={fmtDate(e.employment_start_date)}>
                        <span className="text-slate-600">{fmtDate(e.employment_start_date)}</span>
                      </EllipsisTd>
                      <EllipsisTd maxClass="max-w-[8rem]" title={e.team ?? undefined}>
                        <span className="text-slate-600">{e.team ?? "—"}</span>
                      </EllipsisTd>
                      <EllipsisTd maxClass="max-w-[9rem]" title={e.department ?? undefined}>
                        <span className="text-slate-600">{e.department ?? "—"}</span>
                      </EllipsisTd>
                      <EllipsisTd maxClass="max-w-[6.5rem]" title={e.kiosk_code ?? undefined}>
                        <span className="font-mono text-xs text-slate-600">{e.kiosk_code ?? "—"}</span>
                      </EllipsisTd>
                      <EllipsisTd maxClass="max-w-[9rem]" title={fmtDateAdded(e.created_at)}>
                        <span className="text-slate-600">{fmtDateAdded(e.created_at)}</span>
                      </EllipsisTd>
                      <EllipsisTd maxClass="max-w-[11rem]" title={fmtLogin(e.last_login)}>
                        <span className="text-slate-600">{fmtLogin(e.last_login)}</span>
                      </EllipsisTd>
                      <EllipsisTd maxClass="max-w-[8rem]" title={e.added_by ?? undefined}>
                        <span className="text-slate-600">{e.added_by ?? "—"}</span>
                      </EllipsisTd>
                      <EllipsisTd maxClass="max-w-[9rem]" title={fmtDate(e.archived_at)}>
                        <span className="text-slate-600">{fmtDate(e.archived_at)}</span>
                      </EllipsisTd>
                      <EllipsisTd maxClass="max-w-[8rem]" title={e.archived_by ?? undefined}>
                        <span className="text-slate-600">{e.archived_by ?? "—"}</span>
                      </EllipsisTd>
                      <td className={`${cell} w-12 min-w-12`} />
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <p className="text-xs text-slate-500">
        <strong className="font-semibold text-slate-600">Company owners</strong> can promote store managers
        and update admin access. Store managers keep day-to-day user management where permitted.{" "}
        <strong className="font-semibold text-slate-600">Users and time entries aren’t deleted</strong> —
        archive from the profile (users) or from Timesheets (time entry). Store leads are managed on{" "}
        <strong className="font-semibold text-slate-600">Stores</strong>.
      </p>

      <AddUsersBulkModal
        key={addUsersModalKey}
        open={addUsersOpen}
        onOpenChange={(open) => {
          setAddUsersOpen(open);
          if (!open) setAddUsersBulkMode("default");
        }}
        employees={employees}
        mode={addUsersBulkMode}
        assignmentLocationId={assignmentLocationId}
        scopeAll={scopeAll}
      />

      <PromoteAdminModal
        open={promoteAdminOpen}
        onOpenChange={setPromoteAdminOpen}
        candidates={promoteCandidates}
      />
    </div>
  );
}
