// Copyright (c) 2026 harry-sandhu. Licensed under the Elastic License 2.0 (ELv2).
// See LICENSE and NOTICE in the repository root. Do not remove this notice.
import { useEffect, useState } from "react";
import { Cinder, classifyRunResult, getOutputsAffectedBy } from "usecinder";

export function App() {
  const [crop, setCrop] = useState("");
  const [state, setState] = useState("");
  const [command, setCommand] = useState("");
  const [log, setLog] = useState<string>("not run yet");
  const [outcome, setOutcome] = useState<string>("(none yet)");
  const [affectsLog, setAffectsLog] = useState<string>("not checked yet");

  useEffect(() => {
    void Cinder.init({ root: document });
  }, []);

  async function runCommand() {
    const result = await Cinder.run(command, document);
    setOutcome(classifyRunResult(result));
    setLog(JSON.stringify({ intent: result.intent, dispatch: result.dispatch }, null, 2));
  }

  function checkAffectsEdge() {
    const snapshot = Cinder.graph();
    const stateFilterNode = snapshot.nodes.find((node) => node.type === "filter" && node.key === "state");
    const affected = stateFilterNode ? getOutputsAffectedBy(snapshot, stateFilterNode.id) : [];
    setAffectsLog(JSON.stringify({ stateFilterNodeId: stateFilterNode?.id, affectedOutputKeys: affected.map((n) => n.key) }, null, 2));
  }

  return (
    <div style={{ padding: 24, fontFamily: "sans-serif" }} cinder-context="formtest">
      <h1>Cinder React controlled-input test bed</h1>
      <p>
        This page exists to answer one question: when Cinder dispatches a <code>set_field</code> action against a
        React <em>controlled</em> input, does React's own state actually update, or only the raw DOM attribute?
      </p>

      <div style={{ display: "flex", gap: 16, marginTop: 24 }}>
        <label>
          Crop (controlled input)
          <input
            cinder-field="crop"
            value={crop}
            onChange={(e) => setCrop(e.target.value)}
            style={{ display: "block", marginTop: 4, padding: 8, width: 240 }}
          />
          <p>
            React state value: <strong id="crop-state-readout">{crop || "(empty)"}</strong>
          </p>
        </label>

        <label>
          Crop (controlled select)
          <select
            cinder-filter="state"
            data-cinder-affects="result-summary"
            value={state}
            onChange={(e) => setState(e.target.value)}
            style={{ display: "block", marginTop: 4, padding: 8, width: 240 }}
          >
            <option value="">Select a state</option>
            <option value="punjab">Punjab</option>
            <option value="haryana">Haryana</option>
          </select>
          <p>
            React state value: <strong id="state-state-readout">{state || "(empty)"}</strong>
          </p>
        </label>

        <div cinder-output="result-summary">
          Result summary output node (declared as affected by the state filter above via
          <code>data-cinder-affects</code>).
        </div>
      </div>

      <div style={{ marginTop: 16 }}>
        <button type="button" onClick={checkAffectsEdge} style={{ padding: "8px 16px" }}>
          Check "affects" graph edge (3.3)
        </button>
        <pre style={{ marginTop: 8, background: "#111", color: "#0af", padding: 16 }}>{affectsLog}</pre>
      </div>

      <div style={{ marginTop: 24 }}>
        <input
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          placeholder='try: set crop to soybean'
          style={{ padding: 8, width: 320 }}
        />
        <button type="button" onClick={() => void runCommand()} style={{ marginLeft: 8, padding: "8px 16px" }}>
          Run via Cinder
        </button>
      </div>

      <p style={{ marginTop: 12 }}>
        Outcome: <strong id="outcome-readout">{outcome}</strong>
      </p>

      <pre id="result-log" style={{ marginTop: 24, background: "#111", color: "#0f0", padding: 16 }}>
        {log}
      </pre>
    </div>
  );
}
