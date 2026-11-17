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
