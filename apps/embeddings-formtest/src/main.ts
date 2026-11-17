// Copyright (c) 2026 harry-sandhu. Licensed under the Elastic License 2.0 (ELv2).
// See LICENSE and NOTICE in the repository root. Do not remove this notice.
import { Cinder, classifyRunResult } from "usecinder";
import { createEmbeddingLlmCore } from "@cinder/embeddings";
import { pipeline } from "@huggingface/transformers";

declare global {
  interface Window {
    __runEmbeddingTest: (input: string) => Promise<unknown>;
    __inferDirect: (input: string) => Promise<unknown>;
    __testDevices: () => Promise<unknown>;
    __checkWebGpu: () => Promise<{ hasGpuApi: boolean; adapterFound: boolean; adapterInfo?: string }>;
  }
}

async function boot() {
  await Cinder.init({
    semantic: { scanOnInit: false, observeMutations: false },
    ai: { enabled: true, mode: "local", endpoint: "", apiKey: "" },
  });
  await Cinder.scan(document);
  Cinder.setLlmCore(createEmbeddingLlmCore(), { requiresNetwork: false });
  document.getElementById("status")!.textContent = "ready";
}

window.__runEmbeddingTest = async (input: string) => {
  const result = await Cinder.run(input, document);
  return {
    intent: result.intent.intent,
    target: result.intent.target,
    source: result.intent.source,
    confidence: result.intent.confidence,
    outcome: classifyRunResult(result),
  };
};

window.__inferDirect = async (input: string) => {
  const snapshot = Cinder.graph();
  const localIntent = Cinder.resolve(input);
  const core = createEmbeddingLlmCore();
  // @ts-expect-error - Required<CinderConfig> shape not needed for this diagnostic call
  const result = await core.infer(input, localIntent, snapshot, {});
  return result;
};

window.__testDevices = async () => {
  const results: Record<string, unknown> = {};
  const attempts: Array<[string, Record<string, unknown> | undefined]> = [
    ["webgpu-first", { device: "webgpu" }],
    ["wasm-right-after-webgpu-failure", { device: "wasm" }],
  ];
  for (const [label, options] of attempts) {
    try {
      const p = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2", options);
      try {
        const out = await p("test sentence", { pooling: "mean", normalize: true });
        results[label] = { pipelineCreated: true, inferenceRan: true, dataLength: (out as { data: Float32Array }).data.length };
      } catch (inferError) {
        results[label] = { pipelineCreated: true, inferenceRan: false, inferError: String(inferError) };
      }
    } catch (createError) {
      results[label] = { pipelineCreated: false, createError: String(createError) };
    }
  }
  return results;
};

window.__checkWebGpu = async () => {
  const nav = navigator as Navigator & { gpu?: { requestAdapter: () => Promise<unknown> } };
  const hasGpuApi = typeof nav.gpu !== "undefined";
  if (!hasGpuApi) {
    return { hasGpuApi: false, adapterFound: false };
  }
  try {
    const adapter = await nav.gpu!.requestAdapter();
    return { hasGpuApi: true, adapterFound: Boolean(adapter), adapterInfo: adapter ? String(adapter) : undefined };
  } catch (error) {
    return { hasGpuApi: true, adapterFound: false, adapterInfo: String(error) };
  }
};

void boot();
