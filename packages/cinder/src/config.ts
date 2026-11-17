// Copyright (c) 2026 harry-sandhu. Licensed under the Elastic License 2.0 (ELv2).
// See LICENSE and NOTICE in the repository root. Do not remove this notice.
import type { CinderConfig } from "./types.js";

export const defaultCinderConfig: Required<CinderConfig> = {
  app: {
    name: "",
    version: "",
  },
  speech: {
    engine: "auto",
    lang: "en-US",
  },
  semantic: {
    scanOnInit: true,
    observeMutations: false,
  },
  ai: {
    enabled: false,
    mode: "local",
    endpoint: "",
    apiKey: "",
    provider: "custom",
    timeoutMs: 10000,
  },
};

export function mergeConfig(config?: CinderConfig): Required<CinderConfig> {
  return {
    app: {
      ...defaultCinderConfig.app,
      ...config?.app,
    },
    speech: {
      ...defaultCinderConfig.speech,
      ...config?.speech,
    },
    semantic: {
      ...defaultCinderConfig.semantic,
      ...config?.semantic,
    },
    ai: {
      ...defaultCinderConfig.ai,
      ...config?.ai,
    },
  };
}
