import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { TranscriptionProviderError, type TranscriptionProvider } from "../../adapters/speech/transcriptionProvider.js";
import { getBearerToken } from "../authToken.js";

function isAudioContentType(contentType: string | undefined): boolean {
  return Boolean(contentType && /^audio\//i.test(contentType));
}

export async function registerSpeechTranscribeRoutes(
  app: FastifyInstance,
  options: {
    /** undefined when no speech provider is configured (core/adapters/speech/index.ts) -
     * the route itself reports 501, not a startup failure, since this is an optional
     * capability (known-limitations.md #3). */
    adapter: TranscriptionProvider | undefined;
    apiKey?: string;
  },
): Promise<void> {
  // Fastify only parses application/json and text/plain by default - audio bodies need their
  // own parser that just hands back the raw bytes, same way every browser MediaRecorder output
  // (audio/webm, audio/mp4, audio/ogg, ...) arrives: as a single binary blob, not JSON.
  app.addContentTypeParser(
    /^audio\//,
    { parseAs: "buffer" },
    (_request, body, done) => done(null, body),
  );

  app.post(
    "/v1/speech/transcribe",
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (options.apiKey) {
        const token = getBearerToken(request);

        if (token !== options.apiKey) {
          return reply.code(401).send({ error: "Unauthorized" });
        }
      }

      if (!options.adapter) {
        return reply.code(501).send({
          error: "Speech transcription is not configured on this server (no speechApiKey/CINDER_SPEECH_API_KEY).",
        });
      }

      const contentType = request.headers["content-type"];

      if (!isAudioContentType(contentType) || !Buffer.isBuffer(request.body)) {
        return reply.code(400).send({
          error: "Expected a raw audio request body with an audio/* content-type.",
        });
      }

      const lang = typeof request.query === "object" && request.query !== null
        ? (request.query as Record<string, unknown>).lang
        : undefined;

      try {
        const transcript = await options.adapter.transcribe({
          audio: request.body,
          mimeType: contentType!,
          lang: typeof lang === "string" ? lang : undefined,
        });

        return reply.code(200).send({ transcript });
      } catch (error) {
        if (error instanceof TranscriptionProviderError) {
          return reply.code(502).send({ error: error.message });
        }

        return reply.code(502).send({ error: "Speech transcription failed." });
      }
    },
  );
}
