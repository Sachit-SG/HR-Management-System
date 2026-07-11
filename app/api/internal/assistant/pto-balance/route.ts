import { jsonError, jsonOk } from "@/lib/internal-assistant/http";
import { withInternalAssistantAuth } from "@/lib/internal-assistant/route-handler";
import {
  assertPtoBalanceAccess,
  sanitizePtoBalance,
} from "@/lib/internal-assistant/access";
import { getPtoBalanceSummary } from "@/lib/internal-assistant/services";

export const GET = withInternalAssistantAuth(async (request, actor) => {
  const employeeId = new URL(request.url).searchParams.get("employeeId")?.trim() ?? "";
  if (!employeeId) return jsonError("Missing query parameter `employeeId`.", 400);

  const access = await assertPtoBalanceAccess(actor, employeeId);
  if (!access.ok) return jsonError(access.error, access.status);

  const result = await getPtoBalanceSummary(employeeId);
  if (!result.ok) {
    const status = result.error === "Employee not found." ? 404 : 400;
    return jsonError(result.error, status);
  }

  return jsonOk(sanitizePtoBalance(actor, result));
});
