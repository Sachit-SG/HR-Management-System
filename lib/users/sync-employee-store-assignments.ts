import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export type SyncStoreAssignmentsResult = { ok: true } | { ok: false; error: string };

/**
 * Persists additional store access in `employee_location_assignments`.
 * Home store stays on `employees.location_id`; this table holds extra stores only.
 */
export async function syncEmployeeAdditionalStoreAssignments(
  employeeId: string,
  homeLocationId: string,
  additionalLocationIds: string[],
): Promise<SyncStoreAssignmentsResult> {
  const admin = createSupabaseAdminClient();
  if (!admin) {
    return {
      ok: false,
      error:
        "Store assignments could not be saved — SUPABASE_SERVICE_ROLE_KEY is missing on the server.",
    };
  }

  const extra = [
    ...new Set(
      additionalLocationIds.filter((id) => id.trim() && id.trim() !== homeLocationId.trim()),
    ),
  ];

  const { error: delErr } = await admin
    .from("employee_location_assignments")
    .delete()
    .eq("employee_id", employeeId);

  if (delErr) return { ok: false, error: delErr.message };

  if (extra.length === 0) return { ok: true };

  const rows = extra.map((location_id) => ({
    employee_id: employeeId,
    location_id,
  }));

  const { error: insErr } = await admin.from("employee_location_assignments").insert(rows);
  if (insErr) return { ok: false, error: insErr.message };

  return { ok: true };
}
