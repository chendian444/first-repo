<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import TransmissionControls from './TransmissionMonitorView.vue'
import PanelTitle from '@/components/PanelTitle.vue'
import NetworkPredictionChart from '@/components/NetworkPredictionChart.vue'
import { dashboardApi } from '@/api/dashboard'
import type { StrategyDashboard, EffectDashboard, TransmissionDashboard } from '@/types/dashboard'
const strategy = ref<StrategyDashboard | null>(null)
const effect = ref<EffectDashboard | null>(null)
const transmission = ref<TransmissionDashboard | null>(null)
const message = ref('')
const transferMetrics = computed(() => ['平均分片时延', '平均传输速率', '分片抖动'].map(label => ({ label, value: effect.value?.network?.metrics?.find(item => item.label === label)?.value || '—', note: '完成任务统计' })))
const liveMetrics = computed(() => [
  ...(transmission.value?.route.metrics || []).filter(item => item.label !== '当前链路状态'),
  ...(transmission.value?.keyMetrics || []).filter(item => ['平均有效吞吐率', '网络吞吐率', '重试次数', '完整性校验'].includes(item.label)),
  { label: '传输进度', value: transmission.value ? `${transmission.value.progress.value}%` : '—' },
  { label: '已处理帧/总帧', value: transmission.value?.progress.chunkProgress || '—' }
].map(item => ({ label: item.label, value: item.value, note: '链路与任务实时' })))
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
    <TransmissionControls controls-only @dashboard="transmission = $event" />
    <div v-if="message" class="toast-message error" role="status">{{ message }}</div>
    <section v-if="strategy" class="panel strategy-chart-panel network-panel prediction-analysis">
      <PanelTitle title="长短期记忆网络速率预测对比" icon="⌁" />
      <NetworkPredictionChart :points="strategy.networkForecast.points" />
      <div class="forecast-metrics">
        <div v-for="item in strategy.networkForecast.metrics" :key="item.label"><span>{{ item.label }}</span><b>{{ item.value }}</b></div>
      </div>
    </section>
    <section v-if="effect" class="panel monitor-metrics-panel">
      <div class="section-heading"><h2>关键指标 <small>（任务与链路）</small></h2><label>刷新频率：<b>1 秒</b></label></div>
      <div class="monitor-metrics-grid prediction-kpis">
        <article v-for="item in [...transferMetrics, ...liveMetrics]" :key="item.label" class="kpi-card"><div><small>{{ item.label }}</small><strong>{{ item.value }}</strong><em>{{ item.note }}</em></div></article>
      </div>
    </section>
    <div v-if="!strategy && !message" class="empty-panel">正在加载网络速率预测数据…</div>
  </div>
</template>
