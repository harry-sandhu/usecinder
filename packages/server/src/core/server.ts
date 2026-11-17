import Fastify, { type FastifyInstance } from "fastify";
import { createAdapter } from "../adapters/index.js";
import { createSpeechAdapter } from "../adapters/speech/index.js";
import { resolveServerConfig, type CinderServerConfig } from "./config.js";
import { registerServerRoutes } from "./router.js";

export interface CinderServer {
  app: FastifyInstance;
  config: Required<CinderServerConfig>;
  start(): Promise<string>;
}

export async function createServer(
  config?: CinderServerConfig,
): Promise<CinderServer> {
  const resolved = resolveServerConfig(config);
  const app = Fastify({ logger: true });
  const adapter = createAdapter(resolved);
  const speechAdapter = createSpeechAdapter(resolved);

  await registerServerRoutes(app, {
    adapter,
    speechAdapter,
    apiKey: resolved.apiKey || undefined,
  });

  return {
    app,
    config: resolved,
    async start() {
      return app.listen({
        port: resolved.port,
        host: resolved.host,
      });
    },
  };
}

export { resolveServerConfig, type CinderServerConfig } from "./config.js";
