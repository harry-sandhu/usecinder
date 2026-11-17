export interface CinderAppConfig {
  name?: string;
  version?: string;
}

export interface CinderSpeechConfig {
  engine?: "auto" | "browser";
  lang?: string;
}

export interface CinderSemanticConfig {
  scanOnInit?: boolean;
  observeMutations?: boolean;
}

export interface CinderAiConfig {
  enabled?: boolean;
  mode?: "local" | "cloud" | "hybrid";
  endpoint?: string;
  apiKey?: string;
  provider?: string;
  timeoutMs?: number;
}

export interface CinderConfig {
  app?: CinderAppConfig;
  speech?: CinderSpeechConfig;
  semantic?: CinderSemanticConfig;
  ai?: CinderAiConfig;
}
