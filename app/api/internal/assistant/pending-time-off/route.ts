import { jsonError, jsonOk } from "@/lib/internal-assistant/http";
import { withInternalAssistantAuth } from "@/lib/internal-assistant/route-handler";
import { assertLocationScopedAccess } from "@/lib/internal-assistant/access";
import { getPendingTimeOff } from "@/lib/internal-assistant/services";

export const GET = withInternalAssistantAuth(async (request, actor) => {
  const params = new URL(request.url).searchParams;
  const location =
    params.get("locationId")?.trim() ??
    params.get("location")?.trim() ??
    params.get("store")?.trim() ??
    "";
  if (!location) {
    return jsonError("Missing `locationId`, `location`, or `store` query parameter.", 400);
  }

  const access = await assertLocationScopedAccess(actor, location, "pending_time_off");
  if (!access.ok) return jsonError(access.error, access.status);

  const result = await getPendingTimeOff(location);
  if (!result.ok) {
    const status = result.error === "Location not found." ? 404 : 400;
    return jsonError(result.error, status);
  }

  return jsonOk(result);
});
