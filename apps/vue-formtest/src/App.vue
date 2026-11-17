<!--
Copyright (c) 2026 harry-sandhu. Licensed under the Elastic License 2.0 (ELv2).
See LICENSE and NOTICE in the repository root. Do not remove this notice.
-->
<script setup lang="ts">
import { onMounted, ref } from "vue";
import { Cinder, classifyRunResult } from "usecinder";

const crop = ref("");
const stateVal = ref("");
const command = ref("");
const outcome = ref("(none yet)");
const log = ref("not run yet");

onMounted(() => {
  void Cinder.init({ root: document });
});

async function runCommand() {
  const result = await Cinder.run(command.value, document);
  outcome.value = classifyRunResult(result);
  log.value = JSON.stringify({ intent: result.intent, dispatch: result.dispatch }, null, 2);
}
</script>

<template>
  <div style="padding: 24px; font-family: sans-serif" cinder-context="vue-formtest">
    <h1>Cinder Vue v-model test bed</h1>
    <p>
      Same question as the React test bed, for Vue: when Cinder dispatches a <code>set_field</code>
      action against a <code>v-model</code>-bound input, does Vue's own reactive state actually update?
    </p>

    <div style="display: flex; gap: 16px; margin-top: 24px">
      <label>
        Crop (v-model input)
        <input cinder-field="crop" v-model="crop" style="display: block; margin-top: 4px; padding: 8px; width: 240px" />
        <p>Vue state value: <strong id="crop-state-readout">{{ crop || "(empty)" }}</strong></p>
      </label>

      <label>
        State (v-model select)
        <select cinder-filter="state" v-model="stateVal" style="display: block; margin-top: 4px; padding: 8px; width: 240px">
          <option value="">Select a state</option>
          <option value="punjab">Punjab</option>
          <option value="haryana">Haryana</option>
        </select>
        <p>Vue state value: <strong id="state-state-readout">{{ stateVal || "(empty)" }}</strong></p>
      </label>
    </div>

    <div style="margin-top: 24px">
      <input v-model="command" placeholder="try: set crop to soybean" style="padding: 8px; width: 320px" />
      <button type="button" @click="runCommand" style="margin-left: 8px; padding: 8px 16px">Run via Cinder</button>
    </div>

    <p style="margin-top: 12px">Outcome: <strong id="outcome-readout">{{ outcome }}</strong></p>

    <pre id="result-log" style="margin-top: 24px; background: #111; color: #0f0; padding: 16px">{{ log }}</pre>
  </div>
</template>
