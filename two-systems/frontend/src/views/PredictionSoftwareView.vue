<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import TransmissionControls from './TransmissionMonitorView.vue'
import PanelTitle from '@/components/PanelTitle.vue'
import NetworkPredictionChart from '@/components/NetworkPredictionChart.vue'
import { dashboardApi } from '@/api/dashboard'
import type { StrategyDashboard, EffectDashboard } from '@/types/dashboard'
const strategy = ref<StrategyDashboard | null>(null)
const effect = ref<EffectDashboard | null>(null)
const message = ref('')
const transferMetrics = computed(() => ['平均分片时延', '平均传输速率', '分片抖动'].map(label => ({ label, value: effect.value?.network?.metrics?.find(item => item.label === label)?.value || '—' })))
let timer: number | undefined
let pending = false
async function load() {
  if (pending) return
  pending = true
  try {
    const [nextStrategy, nextEffect] = await Promise.all([dashboardApi.strategy(), dashboardApi.effect()])
    strategy.value = nextStrategy
    effect.value = nextEffect
    message.value = ''
  } catch (error) {
    message.value = error instanceof Error ? error.message : '无法获取网络速率预测数据'
  } finally { pending = false }
}
onMounted(async () => { await load(); timer = window.setInterval(load, 1000) })
onBeforeUnmount(() => { if (timer) window.clearInterval(timer) })
</script>
<template>
  <div class="split-software prediction-software">
    <TransmissionControls controls-only />
    <div v-if="message" class="toast-message error" role="status">{{ message }}</div>
    <section v-if="strategy" class="panel strategy-chart-panel network-panel prediction-analysis">
      <PanelTitle title="长短期记忆网络速率预测对比" icon="⌁" />
      <NetworkPredictionChart :points="strategy.networkForecast.points" />
      <div class="forecast-metrics">
        <div v-for="item in strategy.networkForecast.metrics" :key="item.label"><span>{{ item.label }}</span><b>{{ item.value }}</b></div>
      </div>
    </section>
    <section v-if="effect" class="panel monitor-metrics-panel">
      <div class="section-heading"><h2>关键指标 <small>（原系统任务统计）</small></h2><label>刷新频率：<b>1 秒</b></label></div>
      <div class="monitor-metrics-grid prediction-kpis">
        <article v-for="item in transferMetrics" :key="item.label" class="kpi-card"><div><small>{{ item.label }}</small><strong>{{ item.value }}</strong></div></article>
      </div>
    </section>
    <div v-if="!strategy && !message" class="empty-panel">正在加载网络速率预测数据…</div>
  </div>
</template>
