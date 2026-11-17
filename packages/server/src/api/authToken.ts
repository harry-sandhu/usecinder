import type { FastifyRequest } from "fastify";

/** Shared by every route that gates itself behind this server's own Bearer apiKey
 * (/v1/llm/infer, /v1/speech/transcribe) - pulled out once two routes needed the identical
 * check, rather than letting a second inline copy drift from the first. */
export function getBearerToken(request: FastifyRequest): string | undefined {
  const header = request.headers.authorization;

  if (!header || !header.startsWith("Bearer ")) {
    return undefined;
  }

  return header.slice("Bearer ".length).trim();
}
