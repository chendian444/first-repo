<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import LineChart from '@/components/LineChart.vue'
import PanelTitle from '@/components/PanelTitle.vue'
import { dashboardApi } from '@/api/dashboard'
import type { StrategyDashboard, TransferTaskItem } from '@/types/dashboard'

const router = useRouter()
const data = ref<StrategyDashboard | null>(null)
const tasks = ref<TransferTaskItem[]>([])
const message = ref('')
let timer: number | undefined

const ratioLabels = computed(() => data.value?.compressionCurve.ratio.map((item) => `${item}%`) || [])
function niceInterval(value: number) {
  if (!Number.isFinite(value) || value <= 0) return 1
  const exponent = Math.floor(Math.log10(value))
  const fraction = value / 10 ** exponent
  const niceFraction = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 2.5 ? 2.5 : fraction <= 5 ? 5 : 10
  return niceFraction * 10 ** exponent
}

const curveAxis = computed(() => {
  const maximum = Math.max(0, ...(data.value?.compressionCurve.totalTime || []).map(Number))
  if (!maximum) return { max: 100, interval: 20 }
  const interval = niceInterval(maximum / 4)
  let max = Math.ceil(maximum / interval) * interval
  if (max - maximum < interval * 0.08) max += interval
  return { max: Number(max.toPrecision(12)), interval: Number(interval.toPrecision(12)) }
})
const recommendedSaving = computed(() => {
  const values = data.value?.compressionCurve.totalTime || []
  const baseline = Number(values[0] || 0)
  const recommended = Number(data.value?.compressionCurve.bestTime || 0)
  return baseline > 0 ? `${Math.max(0, (baseline - recommended) * 100 / baseline).toFixed(1)}%` : '—'
})

function priorityText(task: TransferTaskItem) {
  return ({ CRITICAL: '高', IMPORTANT: '中', NORMAL: '低' } as Record<string, string>)[task.priority?.priority || ''] || task.priority?.priority || '—'
}

function algorithmText(task: TransferTaskItem) {
  return String(task.currentDecision?.algorithm || 'AUTO').toUpperCase()
}

async function openTask(taskId: string) {
  try {
    await dashboardApi.selectTask(taskId)
    await router.push({ name: 'transmission', query: { task: taskId } })
  } catch (error) {
    message.value = error instanceof Error ? error.message : '无法切换到任务进程'
  }
}

async function load() {
  try {
    const [strategy, queue] = await Promise.all([
      dashboardApi.strategy(),
      dashboardApi.transferTasks()
    ])
    data.value = strategy
    tasks.value = queue
    message.value = ''
  } catch (error) {
    message.value = error instanceof Error ? error.message : '无法获取策略分析数据'
  }
}

onMounted(async () => { await load(); timer = window.setInterval(load, 4000) })
onBeforeUnmount(() => { if (timer) window.clearInterval(timer) })
</script>

<template>
  <section class="page-view strategy-page" v-if="data">
    <div v-if="message" class="toast-message error">{{ message }}</div>

    <div class="strategy-grid">
      <section class="panel strategy-chart-panel">
        <PanelTitle title="压缩率–总耗时分析" icon="〽" />
        <LineChart
          :labels="ratioLabels"
          :series="[{ name: '总耗时', data: data.compressionCurve.totalTime, color: '#1769ff' }]"
          y-name="总耗时（秒）"
          :y-max="curveAxis.max"
          :y-interval="curveAxis.interval"
          :height="300"
        />
        <div class="recommend-band" :style="{ left: '30%', width: '24%' }"><span>推荐区间<br><b>{{ data.compressionCurve.bestTime }} 秒</b></span></div>
        <div class="chart-summary-grid">
          <div><span>推荐压缩率</span><b>50%~60%</b></div>
          <div><span>对应总耗时</span><b>{{ data.compressionCurve.bestTime }} 秒</b></div>
          <div><span>推荐区间耗时降幅</span><b>{{ recommendedSaving }}</b></div>
          <div><span>当前算法</span><b>{{ data.task.algorithmId.toUpperCase() }}</b></div>
        </div>
      </section>

      <section class="panel recommendation-panel">
        <PanelTitle title="当前推荐策略" icon="✦" />
        <div class="recommendation-table">
          <div v-for="item in data.recommendation" :key="item.label" class="recommend-row">
            <span class="rec-icon">{{ item.icon }}</span>
            <span class="rec-label">{{ item.label }}</span>
            <strong v-html="item.value"></strong>
          </div>
        </div>
      </section>

      <section class="panel task-queue-panel">
        <PanelTitle title="传输任务队列" icon="◷" right-text="点击任务名查看进程" tone="blue" />
        <div class="strategy-task-table-wrap">
          <table class="strategy-task-table">
            <thead>
              <tr>
                <th>任务</th>
                <th>调度优先级</th>
                <th>策略</th>
                <th>进度</th>
                <th>打开文件</th>
                <th>打开文件夹</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="task in tasks" :key="task.id">
                <td><button class="task-name-button" type="button" @click="openTask(task.id)">{{ task.fileName }}</button></td>
                <td>{{ priorityText(task) }}</td>
                <td><b class="algorithm-code">{{ algorithmText(task) }}</b></td>
                <td>
                  <div class="queue-progress"><i :style="{ width: `${Math.max(0, Math.min(100, task.progressPercent || 0))}%` }"></i></div>
                  <span>{{ Number(task.progressPercent || 0).toFixed(1) }}%</span>
                </td>
                <td>
                  <a v-if="task.packageKind !== 'FOLDER'" :href="`/api/tasks/${task.id}/content/file`" target="_blank" rel="noopener">打开文件</a>
                  <button v-else class="queue-action-disabled" type="button" disabled aria-disabled="true">打开文件</button>
                </td>
                <td>
                  <a :href="`/api/tasks/${task.id}/browse`" target="_blank" rel="noopener">打开文件夹</a>
                </td>
              </tr>
              <tr v-if="!tasks.length"><td colspan="6" class="queue-empty">暂无传输任务</td></tr>
            </tbody>
          </table>
        </div>
      </section>
    </div>
  </section>
  <div v-else class="empty-panel">正在加载策略分析数据…</div>
</template>
