import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  normalizeRoleLabel,
  permissionsForRoleKey,
  type AppRoleKey,
} from "@/lib/rbac/matrix";
import { PERMISSIONS, type Permission } from "@/lib/rbac/permissions";
import { storeManagerPermissionsFromAccess } from "@/lib/users/admin-access";

export type HubRole = "ADMIN" | "STAFF";

export type AssistantCapabilityTier = "employee" | "manager" | "admin";

export interface HubActorContext {
  hubRole: HubRole;
  email: string;
  employeeId: string | null;
  hrRoleKey: AppRoleKey | null;
  locationId: string | null;
  tier: AssistantCapabilityTier;
  permissions: Permission[];
  fullName: string | null;
}

export type HubActorResolveResult =
  | { ok: true; actor: HubActorContext }
  | { ok: false; reason: string; message: string; status: number };

const HUB_EMAIL_HEADERS = ["x-hub-user-email", "x-user-email"] as const;
const HUB_ROLE_HEADERS = ["x-hub-user-role", "x-user-role"] as const;

function readHeader(request: Request, names: readonly string[]): string | undefined {
  for (const name of names) {
    const value = request.headers.get(name)?.trim();
    if (value) return value;
  }
  return undefined;
}

function normalizeHubRole(raw: string | undefined): HubRole {
  return raw?.trim().toUpperCase() === "ADMIN" ? "ADMIN" : "STAFF";
}

function resolvePermissions(
  roleKey: AppRoleKey,
  adminAccess: unknown,
): Permission[] {
  if (roleKey === "owner") return permissionsForRoleKey("owner");
  if (roleKey === "store_manager") {
    return storeManagerPermissionsFromAccess(adminAccess);
  }
  return permissionsForRoleKey(roleKey);
}

function resolveTier(
  hubRole: HubRole,
  hrRoleKey: AppRoleKey | null,
  permissions: Permission[],
): AssistantCapabilityTier {
  if (hrRoleKey === "owner") return "admin";
  if (hubRole === "ADMIN") return "admin";

  if (!hrRoleKey) return "employee";

  if (
    (hrRoleKey === "store_manager" || hrRoleKey === "shift_lead") &&
    permissions.includes(PERMISSIONS.TIME_CLOCK_MANAGE)
  ) {
    return "manager";
  }

  if (
    hrRoleKey === "store_manager" &&
    permissions.includes(PERMISSIONS.USERS_VIEW)
  ) {
    return "manager";
  }

  return "employee";
}

export async function resolveHubActorContext(
  request: Request,
): Promise<HubActorResolveResult> {
  const email = readHeader(request, HUB_EMAIL_HEADERS)?.toLowerCase();
  if (!email) {
    return {
      ok: false,
      reason: "missing_user_context",
      message: "Missing Hub user email header (x-hub-user-email).",
      status: 403,
    };
  }

  const hubRole = normalizeHubRole(readHeader(request, HUB_ROLE_HEADERS));

  const supabase = createSupabaseAdminClient();
  if (!supabase) {
    return {
      ok: false,
      reason: "service_unavailable",
      message: "HR service role is not configured.",
      status: 503,
    };
  }

  const { data: row, error } = await supabase
    .from("employees")
    .select("id, role, admin_access, location_id, full_name, status")
    .ilike("email", email)
    .maybeSingle();

  if (error) {
    return {
      ok: false,
      reason: "employee_lookup_failed",
      message: "Could not resolve Hub user in HR roster.",
      status: 500,
    };
  }

  const rec = row as {
    id?: string;
    role?: string;
    admin_access?: unknown;
    location_id?: string | null;
    full_name?: string | null;
    status?: string;
  } | null;

  const activeEmployee =
    rec?.id && rec.status === "active"
      ? {
          id: rec.id,
          roleKey: normalizeRoleLabel(rec.role),
          adminAccess: rec.admin_access,
          locationId: (rec.location_id as string | null) ?? null,
          fullName: (rec.full_name as string | null) ?? null,
        }
      : null;

  if (hubRole === "STAFF" && !activeEmployee) {
    return {
      ok: false,
      reason: "employee_not_linked",
      message: "This Hub account is not linked to an active HR employee profile.",
      status: 403,
    };
  }

  const hrRoleKey = activeEmployee?.roleKey ?? null;
  const permissions = hrRoleKey
    ? resolvePermissions(hrRoleKey, activeEmployee?.adminAccess)
    : permissionsForRoleKey("owner");

  const tier = resolveTier(hubRole, hrRoleKey, permissions);

  return {
    ok: true,
    actor: {
      hubRole,
      email,
      employeeId: activeEmployee?.id ?? null,
      hrRoleKey,
      locationId: activeEmployee?.locationId ?? null,
      tier,
      permissions,
      fullName: activeEmployee?.fullName ?? null,
    },
  };
}
