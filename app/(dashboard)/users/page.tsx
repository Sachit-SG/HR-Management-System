import { cookies } from "next/headers";
import { Suspense } from "react";
import { UsersDirectory } from "@/components/users/users-directory";
import { locationsForSession } from "@/lib/dashboard/locations-for-session";
import {
  isAllLocations,
  resolveSelectedLocationId,
  type LocationRow,
} from "@/lib/dashboard/resolve-location";
import type { DirectoryEmployee } from "@/lib/users/directory-buckets";
import { getRbacContext, hasPermission } from "@/lib/rbac/context";
import { requirePermission } from "@/lib/rbac/guard";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { AdminAccess } from "@/lib/users/admin-access";
import type { EmployeeJobTitle } from "@/lib/users/directory-buckets";

const EMPLOYEE_SELECT = [
                      "id",
                      "full_name",
                      "email",
                      "role",
                      "status",
                      "created_at",
                      "location_id",
                      "direct_manager_id",
                      "mobile_phone",
                      "birth_date",
                      "first_name",
                      "last_name",
                      "title",
                      "employment_start_date",
                      "team",
                      "department",
                      "kiosk_code",
                      "employee_code",
                      "last_login",
                      "added_by",
                      "archived_at",
                      "archived_by",
                      "access_level",
                      "managed_groups",
                      "permissions_label",
                      "admin_access",
                      "admin_tab_enabled",
                    ].join(",");

type UsersPageProps = {
  searchParams: Promise<{ q?: string; tab?: string }>;
};

export default async function UsersPage({ searchParams }: UsersPageProps) {
  await requirePermission(PERMISSIONS.USERS_VIEW);

  const sp = await searchParams;
  const initialSearchQ = typeof sp.q === "string" ? sp.q : "";

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const rbac = await getRbacContext(supabase, user);
  const canEditAdminAccess =
    !rbac.enabled || hasPermission(rbac, PERMISSIONS.ORG_OWNER);
  const canPromoteToAdmin =
    !rbac.enabled ||
    hasPermission(rbac, PERMISSIONS.ORG_OWNER) ||
    hasPermission(rbac, PERMISSIONS.USERS_MANAGE);
  const canManageUsers =
    !rbac.enabled || hasPermission(rbac, PERMISSIONS.USERS_MANAGE);
  const canBulkAddFromAdminsTab = canManageUsers;
  const canEditJobTitles =
    !rbac.enabled ||
    hasPermission(rbac, PERMISSIONS.USERS_MANAGE) ||
    hasPermission(rbac, PERMISSIONS.ORG_OWNER);
  const canSetOrgOwner =
    !rbac.enabled || hasPermission(rbac, PERMISSIONS.ORG_OWNER);

  const { data: locRows } = await supabase
    .from("locations")
    .select("id, name")
    .neq("status", "archived")
    .order("sort_order", { ascending: true });

  const locations: LocationRow[] = locationsForSession(
    (locRows ?? []).map((r) => ({ id: r.id, name: r.name })),
  );
  const cookieStore = await cookies();
  const selectedLocationId = resolveSelectedLocationId(
    locations,
    cookieStore.get("hr_location_id")?.value,
  );
  const scopeAll = isAllLocations(selectedLocationId);
  const locationName =
    locations.find((l) => l.id === selectedLocationId)?.name ?? "All locations";

  const locNames = new Map((locRows ?? []).map((l) => [l.id, l.name] as const));

  let employeesQuery = supabase
    .from("employees")
    .select(EMPLOYEE_SELECT)
    .order("full_name", { ascending: true });
  if (!scopeAll) {
    employeesQuery = employeesQuery.eq("location_id", selectedLocationId);
  }
  const { data: rows, error } = await employeesQuery;

  const ids = (rows ?? []).map((r) => String((r as { id?: string }).id ?? "")).filter(Boolean);
  const titleByEmployeeRank = new Map<string, { primary: EmployeeJobTitle | null; secondary: EmployeeJobTitle | null }>();
  if (ids.length > 0) {
    const { data: ejtRows } = await supabase
      .from("employee_job_titles")
      .select("employee_id, rank, job_title:job_titles(id,name)")
      .in("employee_id", ids);
    for (const row of (ejtRows ?? []) as unknown as Array<Record<string, unknown>>) {
      const employeeId = String(row.employee_id ?? "");
      const rank = Number(row.rank ?? 0);
      const jt = row.job_title as { id?: string; name?: string } | null;
      if (!employeeId || !jt?.id) continue;
      const entry = titleByEmployeeRank.get(employeeId) ?? { primary: null, secondary: null };
      const t: EmployeeJobTitle = { id: String(jt.id), name: String(jt.name ?? "").trim() };
      if (rank === 1) entry.primary = t;
      if (rank === 2) entry.secondary = t;
      titleByEmployeeRank.set(employeeId, entry);
    }
  }

  const employees: DirectoryEmployee[] = (rows ?? []).map((r) => {
    const rec = r as unknown as Record<string, unknown>;
    const lid = rec.location_id as string | null;
    const t = titleByEmployeeRank.get(String(rec.id)) ?? { primary: null, secondary: null };
    return {
      id: String(rec.id),
      full_name: String(rec.full_name ?? ""),
      first_name: (rec.first_name as string | null) ?? null,
      last_name: (rec.last_name as string | null) ?? null,
      email: (rec.email as string | null) ?? null,
      role: String(rec.role ?? ""),
      status: String(rec.status ?? "active"),
      created_at: String(rec.created_at ?? ""),
      location_id: lid,
      direct_manager_id: (rec.direct_manager_id as string | null) ?? null,
      mobile_phone: (rec.mobile_phone as string | null) ?? null,
      birth_date: (rec.birth_date as string | null) ?? null,
      locationName: lid ? locNames.get(lid) ?? null : null,
      title: (rec.title as string | null) ?? null,
      employment_start_date: (rec.employment_start_date as string | null) ?? null,
      team: (rec.team as string | null) ?? null,
      department: (rec.department as string | null) ?? null,
      kiosk_code: (rec.kiosk_code as string | null) ?? null,
      employee_code: (rec.employee_code as string | null) ?? null,
      last_login: (rec.last_login as string | null) ?? null,
      added_by: (rec.added_by as string | null) ?? null,
      archived_at: (rec.archived_at as string | null) ?? null,
      archived_by: (rec.archived_by as string | null) ?? null,
      access_level: (rec.access_level as string | null) ?? null,
      managed_groups: (rec.managed_groups as string | null) ?? null,
      permissions_label: (rec.permissions_label as string | null) ?? null,
      admin_access: (rec.admin_access as AdminAccess | null) ?? null,
      admin_tab_enabled: Boolean(rec.admin_tab_enabled),
      primaryJobTitle: t.primary,
      secondaryJobTitle: t.secondary,
    };
  });

  const migrationHint = (
    <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
      If you see a column error, run migrations through{" "}
      <code className="rounded bg-amber-100/80 px-1">019</code>,{" "}
      <code className="rounded bg-amber-100/80 px-1">017</code>,{" "}
      <code className="rounded bg-amber-100/80 px-1">016</code>,{" "}
      <code className="rounded bg-amber-100/80 px-1">015</code>,{" "}
      <code className="rounded bg-amber-100/80 px-1">014</code>, and{" "}
      <code className="rounded bg-amber-100/80 px-1">009</code> in the Supabase
      SQL editor.
    </p>
  );

  return (
    <div className="space-y-4">
      {error ? (
        <>
          <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            {error.message}
          </p>
          {migrationHint}
        </>
      ) : (
        <Suspense
          fallback={
            <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-500">
              Loading users…
            </div>
          }
        >
          <UsersDirectory
            key={`users-q:${initialSearchQ}`}
            employees={employees}
            locationLabel={locationName}
            assignmentLocationId={scopeAll ? null : selectedLocationId}
            scopeAll={scopeAll}
            canEditAdminAccess={canEditAdminAccess}
            canPromoteToAdmin={canPromoteToAdmin}
            canBulkAddFromAdminsTab={canBulkAddFromAdminsTab}
            canManageUsers={canManageUsers}
            canEditJobTitles={canEditJobTitles}
            canSetOrgOwner={canSetOrgOwner}
            initialSearchQuery={initialSearchQ}
          />
        </Suspense>
      )}
    </div>
  );
}
