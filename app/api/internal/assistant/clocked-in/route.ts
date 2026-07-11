import { jsonError, jsonOk } from "@/lib/internal-assistant/http";
import { withInternalAssistantAuth } from "@/lib/internal-assistant/route-handler";
import {
  assertLocationScopedAccess,
  sanitizeClockedInRow,
} from "@/lib/internal-assistant/access";
import { getClockedInAtLocation } from "@/lib/internal-assistant/services";

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

  const access = await assertLocationScopedAccess(actor, location, "clocked_in");
  if (!access.ok) return jsonError(access.error, access.status);

  const result = await getClockedInAtLocation(location);
  if (!result.ok) {
    const status = result.error === "Location not found." ? 404 : 400;
    return jsonError(result.error, status);
  }

  return jsonOk({
    ...result,
    clockedIn: result.clockedIn.map((row) => sanitizeClockedInRow(actor, row)),
  });
});
