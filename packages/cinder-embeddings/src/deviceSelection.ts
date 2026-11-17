/**
 * Shared device-selection logic for every Transformers.js pipeline this package creates
 * (the embedding pipeline in model.ts, the constrained-choice generative pipeline in
 * generative.ts). Factored out specifically so both reuse the SAME already-fixed logic
 * rather than each having its own copy that could silently drift or reintroduce either of
 * the two real bugs found via real-browser testing (apps/embeddings-formtest) while
 * building the embedding pipeline:
 *
 * 1. A session-wide poisoning bug in onnxruntime-web: letting pipeline({device:"webgpu"})
 *    fail (e.g. "Failed to get GPU adapter" - a browser can have the navigator.gpu API
 *    surface present with no real adapter) poisons EVERY later pipeline() call in the same
 *    page, even one explicitly requesting device:"wasm". Fixed by feature-detecting a real
 *    adapter via the cheap, side-effect-free navigator.gpu.requestAdapter() BEFORE ever
 *    attempting the webgpu pipeline call, so the failing attempt that triggers the
 *    poisoning never happens in the first place.
 * 2. The non-GPU device string is environment-dependent: onnxruntime-web (browser) only
 *    accepts "webgpu"/"wasm"; onnxruntime-node (Node) only accepts "cuda"/"webgpu"/"cpu" -
 *    each throws "Unsupported device" for the other's non-GPU string. Detected via
 *    process.versions.node rather than "is `window` undefined", since this package's own
 *    jsdom-based tests define a fake `window` under real Node.
 */

interface GpuLike {
  requestAdapter: () => Promise<unknown>;
}

export async function hasUsableWebGpuAdapter(): Promise<boolean> {
  if (typeof navigator === "undefined") {
    return false;
  }

  const gpu = (navigator as Navigator & { gpu?: GpuLike }).gpu;

  if (!gpu) {
    return false;
  }

  try {
    const adapter = await gpu.requestAdapter();
    return Boolean(adapter);
  } catch {
    return false;
  }
}

export function getNonGpuDevice(): "wasm" | "cpu" {
  const isRealNode = typeof process !== "undefined" && Boolean(process.versions?.node);
  return isRealNode ? "cpu" : "wasm";
}

export type CinderPipelineDevice = "webgpu" | "wasm" | "cpu";

/**
 * Loads any Transformers.js pipeline with both fixes applied: only attempts "webgpu" when a
 * real adapter was detected (never letting the poisoning-triggering failure happen), falls
 * back to the environment-correct non-GPU device either when no adapter exists OR when an
 * adapter existed but pipeline creation still failed for some other reason (e.g. an
 * unsupported op) - that second fallback is safe specifically because it only runs after a
 * real adapter was already confirmed, not from the no-adapter case that causes the
 * poisoning.
 */
export async function loadPipelineWithFallback<T>(
  createPipeline: (device: CinderPipelineDevice) => Promise<T>,
): Promise<T> {
  if (await hasUsableWebGpuAdapter()) {
    try {
      return await createPipeline("webgpu");
    } catch {
      // Fall through below.
    }
  }

  return createPipeline(getNonGpuDevice());
}
