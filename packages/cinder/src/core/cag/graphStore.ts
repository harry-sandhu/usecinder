// Copyright (c) 2026 harry-sandhu. Licensed under the Elastic License 2.0 (ELv2).
// See LICENSE and NOTICE in the repository root. Do not remove this notice.
import type { CinderGraphSnapshot } from "../../types.js";
import { createEmptyGraphSnapshot } from "./graphBuilder.js";

export class CinderGraphStore {
  private snapshot: CinderGraphSnapshot = createEmptyGraphSnapshot();

  getSnapshot(): CinderGraphSnapshot {
    return this.snapshot;
  }

  setSnapshot(snapshot: CinderGraphSnapshot): void {
    this.snapshot = snapshot;
  }

  reset(): void {
    this.snapshot = createEmptyGraphSnapshot();
  }
}
