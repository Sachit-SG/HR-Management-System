import { jsonError, jsonOk } from "@/lib/internal-assistant/http";
import { withInternalAssistantAuth } from "@/lib/internal-assistant/route-handler";
import {
  assertEmployeeLookupQuery,
  filterEmployeeLookupResults,
} from "@/lib/internal-assistant/access";
import { lookupEmployee } from "@/lib/internal-assistant/services";

export const GET = withInternalAssistantAuth(async (request, actor) => {
  const q =
    new URL(request.url).searchParams.get("q")?.trim() ??
    new URL(request.url).searchParams.get("query")?.trim() ??
    "";
  if (!q) return jsonError("Missing query parameter `q`.", 400);

  const access = assertEmployeeLookupQuery(actor, q);
  if (!access.ok) return jsonError(access.error, access.status);

  const result = await lookupEmployee(q);
  if (!result.ok) return jsonError(result.error, 400);

  const employees = filterEmployeeLookupResults(actor, result.employees);
  if (employees.length === 0) {
    return jsonError("No matching employees found.", 404);
  }

  return jsonOk({ employees, count: employees.length });
});
