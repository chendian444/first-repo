<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import DonutChart from '@/components/DonutChart.vue'
import LineChart from '@/components/LineChart.vue'
import PanelTitle from '@/components/PanelTitle.vue'
import { dashboardApi } from '@/api/dashboard'
import type { EffectDashboard } from '@/types/dashboard'

const data = ref<EffectDashboard | null>(null)
const message = ref('')
const loaded = ref(false)
let timer: number | undefined

const trendLabels = computed(() => data.value?.network?.trend.map((item) => item.time) || [])
const trendValues = computed(() => data.value?.network?.trend.map((item) => item.value) || [])
const trendYMax = computed(() => data.value?.network?.yMax || 90)

function delayIcon(tone: string) {
  return ({ purple: '◬', yellow: '▣', orange: '◌', red: '↻', blue: '↯', green: '◈' } as Record<string, string>)[tone] || '◫'
}

function changeMark(direction?: string) {
  if (direction === 'up') return '↑'
  if (direction === 'none') return '—'
  return '↓'
}

function stopPolling() {
  if (timer) {
    window.clearInterval(timer)
    timer = undefined
  }
}

async function load() {
  try {
    data.value = await dashboardApi.effect()
    message.value = ''
    if (data.value?.hasEvaluation) stopPolling()
  } catch (error) {
    message.value = error instanceof Error ? error.message : '无法获取效果展示数据'
  } finally {
    loaded.value = true
  }
}

onMounted(async () => {
  await load()
  if (!data.value?.hasEvaluation) timer = window.setInterval(load, 4000)
})
onBeforeUnmount(stopPolling)
</script>

<template>
  <section class="page-view effect-page" v-if="data">
    <div v-if="message" class="toast-message error">{{ message }}</div>

    <section v-if="!data.hasEvaluation" class="panel evaluation-empty-panel">
      <PanelTitle title="效果展示" icon="▥" right-text="等待任务完成" tone="blue" />
      <div class="evaluation-empty-content">
        <div class="evaluation-empty-visual"><span>◌</span><i></i><b>数据压缩效果评估</b><small>将在本次传输完成后自动生成</small></div>
        <div class="evaluation-empty-info">
          <h2>当前尚无可展示的传输结果</h2>
          <p>{{ data.message }}</p>
          <div class="waiting-task-grid">
            <article><span>当前任务</span><b>{{ data.task.fileName }}</b><small>{{ data.task.fileType }} · {{ data.task.fileSize }}</small></article>
            <article><span>已选压缩策略</span><b>{{ data.task.algorithm }} · 等级 {{ data.task.level }}</b><small>{{ data.task.priority }}优先级调度</small></article>
            <article><span>预计压缩后大小</span><b>{{ data.task.estimatedCompressedSize }}</b><small>预估节省 {{ data.task.estimatedSaving }}</small></article>
          </div>
          <RouterLink to="/transmission" class="go-monitor-btn">前往传输监控并启动任务 <span>→</span></RouterLink>
        </div>
      </div>
      <div class="evaluation-steps"><span><i>1</i>配置文件与压缩策略</span><b>→</b><span><i>2</i>启动传输与网络状态监测</span><b>→</b><span><i>3</i>完成后生成时延与收益评估</span></div>
    </section>

    <div v-else class="effect-layout">
      <div class="effect-analysis-shell">
        <section class="panel delay-panel">
          <PanelTitle title="文件与时延对比" icon="▣" />
          <div class="file-info-row">
            <div v-for="(value, key) in data.file" :key="key">
              <span>{{ key }}</span><b>{{ value }}</b>
            </div>
          </div>
          <div class="donut-compare">
            <div class="donut-area">
              <h3>压缩前（原始数据）时延构成</h3>
              <DonutChart :data="data.beforeDelay || []" :height="292" />
            </div>
            <div class="compare-arrow"><span>➜</span><span>➜</span><span>➜</span></div>
            <div class="donut-area">
              <h3>压缩后（使用策略）时延构成</h3>
              <DonutChart :data="data.afterDelay || []" :height="292" />
            </div>
          </div>
          <div class="delay-legend">
            <span v-for="(item, index) in data.afterDelay || []" :key="item.name + '-' + index"><i :style="{ background: item.color }"></i>{{ item.name }}</span>
          </div>
        </section>

        <section class="panel delay-table-panel">
          <PanelTitle title="可对比时延对比" icon="◫" />
          <table class="delay-table">
            <thead><tr><th>时延指标</th><th>压缩前（原始数据）</th><th>压缩后（使用策略）</th><th>变化 / 对比</th></tr></thead>
            <tbody>
              <tr v-for="row in data.comparison || []" :key="row.metric" :class="{ emphasis: row.emphasis }">
                <td><i>●</i>{{ row.metric }}</td>
                <td>{{ row.before }}</td>
                <td>{{ row.after }}</td>
                <td><b :class="row.direction || 'down'">{{ changeMark(row.direction) }} {{ row.change }}</b></td>
              </tr>
            </tbody>
          </table>
        </section>

        <section class="panel additional-panel">
          <PanelTitle :title="data.additionalDelayTitle || '压缩后新增时延'" icon="◫" />
          <div v-for="item in data.additionalDelay || []" :key="item.label" class="additional-row" :class="item.tone">
            <span class="additional-icon">{{ delayIcon(item.tone) }}</span>
            <span class="additional-copy"><em>{{ item.label }}</em><small v-if="item.note">{{ item.note }}</small></span>
            <b>{{ item.value }}</b>
          </div>
          <p>{{ data.additionalDelayNote || '注：新增时延已计入整体评估。' }}</p>
        </section>
      </div>

      <div class="effect-side-stack">
        <section class="panel conclusion-panel" :class="{ 'no-benefit': data.conclusion?.improved === false }">
          <PanelTitle title="传输结论分析" icon="◫" />
          <p class="conclusion-intro">{{ data.conclusion?.intro || '本次任务已完成传输效果评估。' }}</p>
          <div class="conclusion-cards">
            <article class="saving-card"><span>{{ data.conclusion?.improved === false ? '△' : '◉' }}</span><div><small>{{ data.conclusion?.primaryLabel || '节约时间' }}</small><strong>{{ data.conclusion?.primaryValue || data.conclusion?.timeSaved }}</strong><p>{{ data.conclusion?.primaryDescription || `总耗时由 ${data.conclusion?.totalBefore} 降至 ${data.conclusion?.totalAfter}` }}</p></div></article>
            <article class="efficiency-card"><span>{{ data.conclusion?.noCompression ? '↔' : data.conclusion?.improved === false ? '!' : '↗' }}</span><div><small>{{ data.conclusion?.secondaryLabel || '提升效率' }}</small><strong>{{ data.conclusion?.secondaryValue || data.conclusion?.improvement }}</strong><p>{{ data.conclusion?.secondaryDescription || `整体传输效率变化 ${data.conclusion?.improvement}` }}</p></div></article>
          </div>
          <ul class="conclusion-list"><li v-for="item in data.conclusion?.details || []" :key="item">{{ item }}</li></ul>
          <footer><span>评估时间：<b>{{ data.conclusion?.evaluatedAt }}</b></span><span>评估结果：<strong>{{ data.conclusion?.result }}</strong></span></footer>
        </section>

        <section class="panel network-status-panel">
          <PanelTitle title="网络总体状态" icon="▣" right-text="● 任务已完成" tone="green" />
          <div class="stable-banner"><div><strong>{{ data.network?.status }}</strong><span>{{ data.network?.note }}</span></div></div>
          <div class="network-metrics">
            <div v-for="metric in data.network?.metrics || []" :key="metric.label"><span>{{ metric.label }}</span><b>{{ metric.value }}</b></div>
          </div>
          <h3 class="mini-chart-title">本次任务链路时延趋势（ms）</h3>
          <LineChart :labels="trendLabels" :series="[{ name: '平均延迟', data: trendValues, color: '#16c4dc', area: true }]" :y-max="trendYMax" :height="176" />
        </section>
      </div>
    </div>
  </section>
  <div v-else class="empty-panel effect-load-state">
    <template v-if="message">
      <strong>效果展示数据暂时不可用</strong>
      <span>{{ message }}</span>
      <RouterLink to="/transmission" class="go-monitor-btn">返回传输监控 <span>→</span></RouterLink>
    </template>
    <template v-else>{{ loaded ? '暂无效果展示数据' : '正在加载效果展示数据…' }}</template>
  </div>
</template>
