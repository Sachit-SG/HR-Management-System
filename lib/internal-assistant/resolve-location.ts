import type { SupabaseClient } from "@supabase/supabase-js";

export type ResolvedLocation = {
  id: string;
  name: string;
  status: string;
};

/** Resolve by UUID or case-insensitive name / partial name. */
export async function resolveLocation(
  supabase: SupabaseClient,
  locationIdOrName: string,
): Promise<ResolvedLocation | null> {
  const raw = locationIdOrName.trim();
  if (!raw) return null;

  const uuidRe =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (uuidRe.test(raw)) {
    const { data } = await supabase
      .from("locations")
      .select("id, name, status")
      .eq("id", raw)
      .maybeSingle();
    if (!data) return null;
    return {
      id: data.id as string,
      name: String(data.name ?? ""),
      status: String(data.status ?? ""),
    };
  }

  const { data: rows } = await supabase
    .from("locations")
    .select("id, name, status")
    .ilike("name", `%${raw.replace(/%/g, "")}%`)
    .neq("status", "archived")
    .limit(5);

  const list = rows ?? [];
  if (list.length === 0) return null;

  const exact = list.find((r) => String(r.name).toLowerCase() === raw.toLowerCase());
  const pick = exact ?? (list.length === 1 ? list[0] : null);
  if (!pick) return null;

  return {
    id: pick.id as string,
    name: String(pick.name ?? ""),
    status: String(pick.status ?? ""),
  };
}
