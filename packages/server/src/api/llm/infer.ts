import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import {
  normalizeInferIntentRequest,
  normalizeInferIntentResponse,
  type LLMAdapter,
} from "@cinder/shared";
import { getBearerToken } from "../authToken.js";

export async function registerLlmInferRoutes(
  app: FastifyInstance,
  options: {
    adapter: LLMAdapter;
    apiKey?: string;
  },
): Promise<void> {
  app.post(
    "/v1/llm/infer",
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (options.apiKey) {
        const token = getBearerToken(request);

        if (token !== options.apiKey) {
          return reply.code(401).send({
            error: "Unauthorized",
          });
        }
      }

      const body = normalizeInferIntentRequest(request.body);

      if (!body) {
        return reply.code(400).send({
          error: "Invalid infer request body.",
        });
      }

      try {
        const adapterResponse = await options.adapter.infer(body);
        const response = normalizeInferIntentResponse(adapterResponse);

        if (!response) {
          return reply.code(502).send({
            error: "Provider returned an invalid infer response.",
          });
        }

        return reply.code(200).send(response);
      } catch {
        return reply.code(502).send({
          error: "Provider inference failed.",
        });
      }
    },
  );
}
