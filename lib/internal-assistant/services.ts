import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { resolveLocation } from "@/lib/internal-assistant/resolve-location";

function adminClient() {
  return createSupabaseAdminClient();
}

export async function lookupEmployee(query: string) {
  const supabase = adminClient();
  if (!supabase) {
    return { ok: false as const, error: "HR service role is not configured." };
  }

  const q = query.trim();
  if (!q) return { ok: false as const, error: "Missing query." };

  let dbQuery = supabase
    .from("employees")
    .select(
      "id, full_name, first_name, last_name, email, employee_code, role, status, location_id, locations!employees_location_id_fkey(name)",
    )
    .eq("status", "active")
    .limit(10);

  if (q.includes("@")) {
    dbQuery = dbQuery.ilike("email", q.toLowerCase());
  } else if (/^[0-9a-f-]{36}$/i.test(q)) {
    dbQuery = dbQuery.eq("id", q);
  } else {
    dbQuery = dbQuery.or(
      `full_name.ilike.%${q}%,employee_code.ilike.%${q}%,email.ilike.%${q}%`,
    );
  }

  const { data, error } = await dbQuery;
  if (error) return { ok: false as const, error: error.message };

  const employees = (data ?? []).map((row) => {
    const loc = row.locations as { name?: string } | { name?: string }[] | null;
    const storeName = Array.isArray(loc) ? loc[0]?.name : loc?.name;
    return {
      id: row.id as string,
      fullName:
        (row.full_name as string | null) ??
        [row.first_name, row.last_name].filter(Boolean).join(" ").trim() ??
        null,
      email: (row.email as string | null) ?? null,
      employeeCode: (row.employee_code as string | null) ?? null,
      role: (row.role as string | null) ?? null,
      storeName: storeName ?? null,
      locationId: (row.location_id as string | null) ?? null,
    };
  });

  return { ok: true as const, employees, count: employees.length };
}

export async function getPtoBalanceSummary(employeeId: string) {
  const supabase = adminClient();
  if (!supabase) {
    return { ok: false as const, error: "HR service role is not configured." };
  }

  const id = employeeId.trim();
  if (!id) return { ok: false as const, error: "Missing employeeId." };

  const { data: emp, error: empErr } = await supabase
    .from("employees")
    .select("id, full_name, email")
    .eq("id", id)
    .maybeSingle();
  if (empErr) return { ok: false as const, error: empErr.message };
  if (!emp) return { ok: false as const, error: "Employee not found." };

  const { data: balances, error: balErr } = await supabase
    .from("pto_employee_balances")
    .select("bucket, balance_hours")
    .eq("employee_id", id)
    .in("bucket", ["vacation", "sick"]);
  if (balErr) return { ok: false as const, error: balErr.message };

  let vacationHours = 0;
  let sickHours = 0;
  for (const row of balances ?? []) {
    const hrs = Number(row.balance_hours);
    if (!Number.isFinite(hrs)) continue;
    if (row.bucket === "vacation") vacationHours = hrs;
    if (row.bucket === "sick") sickHours = hrs;
  }

  return {
    ok: true as const,
    employeeId: id,
    fullName: (emp.full_name as string | null) ?? null,
    email: (emp.email as string | null) ?? null,
    vacationHours,
    sickHours,
  };
}

export async function getClockedInAtLocation(locationIdOrName: string) {
  const supabase = adminClient();
  if (!supabase) {
    return { ok: false as const, error: "HR service role is not configured." };
  }

  const location = await resolveLocation(supabase, locationIdOrName);
  if (!location) {
    return { ok: false as const, error: "Location not found." };
  }

  const { data, error } = await supabase
    .from("time_entries")
    .select(
      "id, clock_in_at, employee_id, employees!time_entries_employee_id_fkey(full_name, email, employee_code)",
    )
    .eq("location_id", location.id)
    .is("clock_out_at", null)
    .is("archived_at", null)
    .order("clock_in_at", { ascending: false })
    .limit(50);
  if (error) return { ok: false as const, error: error.message };

  const clockedIn = (data ?? []).map((row) => {
    const emp = row.employees as
      | { full_name?: string; email?: string; employee_code?: string }
      | { full_name?: string; email?: string; employee_code?: string }[]
      | null;
    const e = Array.isArray(emp) ? emp[0] : emp;
    return {
      timeEntryId: row.id as string,
      clockInAt: row.clock_in_at as string,
      employeeId: row.employee_id as string,
      fullName: e?.full_name ?? null,
      email: e?.email ?? null,
      employeeCode: e?.employee_code ?? null,
    };
  });

  return {
    ok: true as const,
    location,
    clockedInCount: clockedIn.length,
    clockedIn,
  };
}

export async function getPendingTimeOff(locationIdOrName: string) {
  const supabase = adminClient();
  if (!supabase) {
    return { ok: false as const, error: "HR service role is not configured." };
  }

  const location = await resolveLocation(supabase, locationIdOrName);
  if (!location) {
    return { ok: false as const, error: "Location not found." };
  }

  const { data: empRows } = await supabase
    .from("employees")
    .select("id")
    .eq("location_id", location.id)
    .eq("status", "active");
  const employeeIds = (empRows ?? []).map((r) => r.id as string);
  if (employeeIds.length === 0) {
    return {
      ok: true as const,
      location,
      pendingCount: 0,
      pending: [] as {
        id: string;
        employeeId: string;
        fullName: string | null;
        startAt: string;
        endAt: string;
        status: string;
      }[],
    };
  }

  const { data, error } = await supabase
    .from("time_off_records")
    .select(
      "id, employee_id, start_at, end_at, status, employees!time_off_records_employee_id_fkey(full_name)",
    )
    .in("employee_id", employeeIds)
    .eq("status", "pending")
    .order("start_at", { ascending: true })
    .limit(30);
  if (error) return { ok: false as const, error: error.message };

  const pending = (data ?? []).map((row) => {
    const emp = row.employees as { full_name?: string } | { full_name?: string }[] | null;
    const name = Array.isArray(emp) ? emp[0]?.full_name : emp?.full_name;
    return {
      id: row.id as string,
      employeeId: row.employee_id as string,
      fullName: name ?? null,
      startAt: row.start_at as string,
      endAt: row.end_at as string,
      status: row.status as string,
    };
  });

  return {
    ok: true as const,
    location,
    pendingCount: pending.length,
    pending,
  };
}

export async function getLocationRosterSummary(locationIdOrName: string) {
  const supabase = adminClient();
  if (!supabase) {
    return { ok: false as const, error: "HR service role is not configured." };
  }

  const location = await resolveLocation(supabase, locationIdOrName);
  if (!location) {
    return { ok: false as const, error: "Location not found." };
  }

  const { count: activeEmployees, error: empErr } = await supabase
    .from("employees")
    .select("id", { count: "exact", head: true })
    .eq("location_id", location.id)
    .eq("status", "active");
  if (empErr) return { ok: false as const, error: empErr.message };

  const { count: clockedIn, error: punchErr } = await supabase
    .from("time_entries")
    .select("id", { count: "exact", head: true })
    .eq("location_id", location.id)
    .is("clock_out_at", null)
    .is("archived_at", null);
  if (punchErr) return { ok: false as const, error: punchErr.message };

  return {
    ok: true as const,
    location,
    activeEmployees: activeEmployees ?? 0,
    clockedInNow: clockedIn ?? 0,
  };
}
