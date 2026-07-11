type LogPayload = Record<string, unknown>;

/** Structured logs for Hub connector debugging (match QuickTrack Hub prefixes). */
export function logInternalAssistant(
  tag: "REQUEST" | "RESPONSE" | "ERROR",
  payload: LogPayload,
): void {
  console.info(`[HR][INTERNAL_ASSISTANT][${tag}]`, JSON.stringify(payload));
}
