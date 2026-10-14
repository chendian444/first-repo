<script setup lang="ts">
import TransmissionControls from './TransmissionMonitorView.vue'
import CompressionAnalysis from './StrategyAnalysisView.vue'
</script>
<template>
  <div class="split-software adaptive-software">
    <TransmissionControls controls-only />
    <CompressionAnalysis />
  </div>
</template>
