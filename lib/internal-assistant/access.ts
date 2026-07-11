import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { resolveLocation } from "@/lib/internal-assistant/resolve-location";
import type { HubActorContext } from "@/lib/internal-assistant/hub-context";

type AccessOk = { ok: true };
type AccessErr = { ok: false; error: string; status: number };

export type EmployeeLookupRow = {
  id: string;
  fullName: string | null;
  email: string | null;
  employeeCode: string | null;
  role: string | null;
  storeName: string | null;
  locationId: string | null;
};

export function assertEmployeeLookupQuery(
  actor: HubActorContext,
  query: string,
): AccessErr | AccessOk {
  const q = query.trim();
  if (!q) {
    return { ok: false, error: "Missing query.", status: 400 };
  }

  if (actor.tier === "admin" || actor.tier === "manager") {
    return { ok: true };
  }

  if (!actor.employeeId) {
    return {
      ok: false,
      error: "Employee lookup is limited to your own profile.",
      status: 403,
    };
  }

  if (!employeeQueryMatchesSelf(actor, q)) {
    return {
      ok: false,
      error: "Employee lookup is limited to your own profile.",
      status: 403,
    };
  }

  return { ok: true };
}

export function filterEmployeeLookupResults(
  actor: HubActorContext,
  employees: EmployeeLookupRow[],
): EmployeeLookupRow[] {
  let rows = employees;

  if (actor.tier === "manager" && actor.locationId) {
    rows = rows.filter((row) => row.locationId === actor.locationId);
  }

  if (actor.tier === "employee" && actor.employeeId) {
    rows = rows.filter((row) => row.id === actor.employeeId);
  }

  return rows.map((row) => sanitizeEmployeeRow(actor, row));
}

function employeeQueryMatchesSelf(actor: HubActorContext, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return false;
  if (q === actor.email) return true;
  if (actor.employeeId && q === actor.employeeId.toLowerCase()) return true;
  const name = actor.fullName?.trim().toLowerCase();
  if (name && (name.includes(q) || q.includes(name))) return true;
  return false;
}

function sanitizeEmployeeRow(
  actor: HubActorContext,
  row: EmployeeLookupRow,
): EmployeeLookupRow {
  if (actor.tier === "admin") return row;
  if (actor.tier === "manager") {
    return { ...row, email: null };
  }
  return row.id === actor.employeeId ? row : { ...row, email: null };
}

export async function assertPtoBalanceAccess(
  actor: HubActorContext,
  employeeId: string,
): Promise<AccessErr | AccessOk> {
  const id = employeeId.trim();
  if (!id) {
    return { ok: false, error: "Missing employeeId.", status: 400 };
  }

  if (actor.tier === "admin") {
    return { ok: true };
  }

  if (actor.tier === "employee") {
    if (actor.employeeId && id === actor.employeeId) {
      return { ok: true };
    }
    return {
      ok: false,
      error: "PTO balance is only available for your own employee record.",
      status: 403,
    };
  }

  const targetLocationId = await getEmployeeLocationId(id);
  if (!targetLocationId) {
    return { ok: false, error: "Employee not found.", status: 404 };
  }

  if (!actor.locationId || targetLocationId !== actor.locationId) {
    return {
      ok: false,
      error: "PTO balance is limited to employees at your assigned store.",
      status: 403,
    };
  }

  return { ok: true };
}

export function sanitizePtoBalance<T extends { email?: string | null }>(
  actor: HubActorContext,
  data: T,
): T {
  if (actor.tier === "admin") return data;
  if (actor.tier === "manager") {
    return { ...data, email: null };
  }
  return data;
}

export async function assertLocationScopedAccess(
  actor: HubActorContext,
  locationIdOrName: string,
  endpoint:
    | "clocked_in"
    | "pending_time_off"
    | "location_roster_summary",
): Promise<
  AccessErr | (AccessOk & { location: { id: string; name: string } })
> {
  const raw = locationIdOrName.trim();
  if (!raw) {
    return { ok: false, error: "Missing location.", status: 400 };
  }

  if (actor.tier === "employee") {
    const label =
      endpoint === "clocked_in"
        ? "Who is clocked in"
        : endpoint === "pending_time_off"
          ? "Pending time off"
          : "Store roster summaries";
    return {
      ok: false,
      error: `${label} is available to managers and admins only.`,
      status: 403,
    };
  }

  const supabase = createSupabaseAdminClient();
  if (!supabase) {
    return {
      ok: false,
      error: "HR service role is not configured.",
      status: 503,
    };
  }

  const location = await resolveLocation(supabase, raw);
  if (!location) {
    return { ok: false, error: "Location not found.", status: 404 };
  }

  if (actor.tier === "admin") {
    return { ok: true, location };
  }

  if (!actor.locationId) {
    return {
      ok: false,
      error: "Your HR profile has no assigned store for this request.",
      status: 403,
    };
  }

  if (location.id !== actor.locationId) {
    return {
      ok: false,
      error: "This request is limited to your assigned store.",
      status: 403,
    };
  }

  return { ok: true, location };
}

export function sanitizeClockedInRow<T extends { email?: string | null }>(
  actor: HubActorContext,
  row: T,
): T {
  if (actor.tier === "admin") return row;
  return { ...row, email: null };
}

async function getEmployeeLocationId(employeeId: string): Promise<string | null> {
  const supabase = createSupabaseAdminClient();
  if (!supabase) return null;

  const { data } = await supabase
    .from("employees")
    .select("location_id, status")
    .eq("id", employeeId)
    .maybeSingle();

  const rec = data as { location_id?: string | null; status?: string } | null;
  if (!rec || rec.status !== "active") return null;
  return (rec.location_id as string | null) ?? null;
}
