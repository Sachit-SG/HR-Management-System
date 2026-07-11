import { PERMISSIONS, type Permission } from "./permissions";

/** Canonical keys — map from `employees.role` text (normalized). */
export type AppRoleKey = "employee" | "shift_lead" | "store_manager" | "owner";

/**
 * Maps `employees.role` (any casing/spacing) to a canonical key.
 * Unknown labels default to `employee` for safety.
 */
export function normalizeRoleLabel(raw: string | null | undefined): AppRoleKey {
  if (!raw?.trim()) return "employee";
  const k = raw.trim().toLowerCase().replace(/\s+/g, "_");
  if (k === "owner" || k === "org_owner" || k === "organization_owner") {
    return "owner";
  }
  if (k === "shift_lead" || k === "shift-lead") return "shift_lead";
  if (k === "store_manager" || k === "store-manager") return "store_manager";
  if (k === "employee") return "employee";
  if (k.includes("manager") || k.includes("lead")) {
    return k.includes("store") ? "store_manager" : "shift_lead";
  }
  return "employee";
}

/** Base employee: self-serve dashboard, clock in/out, and read-only schedule — no team ops feed or labor KPIs. */
const employee: Permission[] = [
  PERMISSIONS.DASHBOARD_VIEW,
  PERMISSIONS.TIME_CLOCK_VIEW,
  PERMISSIONS.SCHEDULE_VIEW,
];

/** Office / shift lead: operations plus read-only user directory (no USERS_MANAGE). */
const shiftLead: Permission[] = [
  ...employee,
  PERMISSIONS.ACTIVITY_VIEW,
  PERMISSIONS.LABOR_REPORT_VIEW,
  PERMISSIONS.TIME_CLOCK_MANAGE,
  PERMISSIONS.SCHEDULE_EDIT,
  PERMISSIONS.USERS_VIEW,
];

const storeManager: Permission[] = [
  ...shiftLead,
  PERMISSIONS.USERS_VIEW,
  PERMISSIONS.USERS_MANAGE,
  PERMISSIONS.USERS_GROUPS_VIEW,
];

/** Full operational access + ability to grant/restrict Store Manager product permissions. */
const owner: Permission[] = [...storeManager, PERMISSIONS.ORG_OWNER];

export const ROLE_PERMISSIONS: Record<AppRoleKey, Permission[]> = {
  employee,
  shift_lead: shiftLead,
  store_manager: storeManager,
  owner,
};

export function permissionsForRoleKey(roleKey: AppRoleKey): Permission[] {
  return [...ROLE_PERMISSIONS[roleKey]];
}
