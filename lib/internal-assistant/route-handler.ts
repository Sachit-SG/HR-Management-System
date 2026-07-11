import { validateInternalAssistantRequest } from "@/lib/internal-assistant/auth";
import { forbidden, jsonError, unauthorized } from "@/lib/internal-assistant/http";
import {
  resolveHubActorContext,
  type HubActorContext,
} from "@/lib/internal-assistant/hub-context";
import { logInternalAssistant } from "@/lib/internal-assistant/log";

type Handler = (request: Request) => Promise<Response>;
type AuthenticatedHandler = (
  request: Request,
  actor: HubActorContext,
) => Promise<Response>;

export function withInternalAssistantAuth(handler: AuthenticatedHandler): Handler {
  return async (request: Request) => {
    const pathname = new URL(request.url).pathname;

    const auth = validateInternalAssistantRequest(request);
    if (!auth.ok) {
      return unauthorized(auth.reason ?? "invalid_api_key");
    }

    const actorResult = await resolveHubActorContext(request);
    if (!actorResult.ok) {
      return forbidden(actorResult.message, actorResult.reason);
    }

    const actor = actorResult.actor;
    logInternalAssistant("REQUEST", {
      method: request.method,
      pathname,
      tier: actor.tier,
      hubRole: actor.hubRole,
      hasEmployee: Boolean(actor.employeeId),
    });

    try {
      const response = await handler(request, actor);
      logInternalAssistant("RESPONSE", {
        pathname,
        status: response.status,
        tier: actor.tier,
      });
      return response;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Internal error.";
      return jsonError(message, 500);
    }
  };
}
