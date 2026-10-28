<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import DonutChart from '@/components/DonutChart.vue'
import PanelTitle from '@/components/PanelTitle.vue'
import { dashboardApi } from '@/api/dashboard'
import { softwareTitle } from '@/software'
import type { DelayItem, EffectDashboard, ReceiverStatus, TransferTaskItem, TransmissionDashboard } from '@/types/dashboard'

const transmission = ref<TransmissionDashboard | null>(null)
const effect = ref<EffectDashboard | null>(null)
const tasks = ref<TransferTaskItem[]>([])
const receiverStatus = ref<ReceiverStatus | null>(null)
const message = ref('')
const loaded = ref(false)
let timer: number | undefined

const fallbackBeforeDelay: DelayItem[] = [
  { name: "发送时延", value: 20, color: "#1769ff" },
  { name: "传输时延", value: 62, color: "#19dfff" },
  { name: "排队时延", value: 8, color: "#8cbb4d" },
  { name: "其他时延", value: 10, color: "#ff5e36" }
]
const fallbackAfterDelay: DelayItem[] = [
  { name: "发送时延", value: 12, color: "#1769ff" },
  { name: "传输时延", value: 48, color: "#19dfff" },
  { name: "排队时延", value: 6, color: "#8cbb4d" },
  { name: "压缩时延", value: 14, color: "#8a50ef" },
  { name: "解压时延", value: 9, color: "#ee59bd" },
  { name: "其他时延", value: 11, color: "#ff5e36" }
]
const fallbackStages = [
  { name: '文件压缩与封装', status: 'wait' },
  { name: '网络数据传输', status: 'wait' },
  { name: '接收与解压', status: 'wait' },
  { name: '完整性校验', status: 'wait' }
]

function firstError(results: PromiseSettledResult<unknown>[]) {
  const rejected = results.find((item) => item.status === 'rejected') as PromiseRejectedResult | undefined
  if (!rejected) return ''
  return rejected.reason instanceof Error ? rejected.reason.message : '接收端数据暂时不可用'
}

async function load() {
  const results = await Promise.allSettled([
    dashboardApi.transmission(),
    dashboardApi.effect(),
    dashboardApi.transferTasks(),
    dashboardApi.receiverStatus()
  ])

  if (results[0].status === 'fulfilled') transmission.value = results[0].value
  if (results[1].status === 'fulfilled') effect.value = results[1].value
  if (results[2].status === 'fulfilled') tasks.value = results[2].value
  if (results[3].status === 'fulfilled') receiverStatus.value = results[3].value
  message.value = firstError(results)
  loaded.value = true
}

onMounted(async () => {
  await load()
  timer = window.setInterval(load, 1000)
})
onBeforeUnmount(() => { if (timer) window.clearInterval(timer) })

const hasEvaluation = computed(() => Boolean(effect.value?.hasEvaluation))
const beforeDelay = computed(() => hasEvaluation.value && effect.value?.beforeDelay?.length ? effect.value.beforeDelay : fallbackBeforeDelay)
const afterDelay = computed(() => hasEvaluation.value && effect.value?.afterDelay?.length ? effect.value.afterDelay : fallbackAfterDelay)
const comparison = computed(() => effect.value?.comparison || [])
const progressValue = computed(() => Math.max(0, Math.min(100, Number(transmission.value?.progress.value || 0))))
const progressStages = computed(() => transmission.value?.progress.stages?.length ? transmission.value.progress.stages : fallbackStages)
const activeTasks = computed(() => tasks.value.filter((task) => ['QUEUED', 'PROFILING', 'WAITING_NETWORK', 'TRANSMITTING', 'VERIFYING', 'CACHED', 'RETRYING'].includes(String(task.state || '').toUpperCase())).length)
const receivedCount = computed(() => {
  const chunkCount = Number(transmission.value?.receiver.chunkCount || 0)
  return chunkCount > 0 ? chunkCount.toLocaleString('zh-CN') : tasks.value.length.toLocaleString('zh-CN')
})
const receiveState = computed(() => progressValue.value >= 100 ? '完成' : transmission.value?.progress.state || transmission.value?.task.stateText || '待命')
const serviceOnlineText = computed(() => receiverStatus.value?.serviceStatus || (receiverStatus.value?.online === false ? '离线' : '正常运行'))
const topServiceText = computed(() => receiverStatus.value?.online === false ? '接收服务离线' : '接收服务在线')
const timePrimaryLabel = computed(() => effect.value?.conclusion?.primaryLabel || '时间节省')
const timePrimaryValue = computed(() => effect.value?.conclusion?.primaryValue || (hasEvaluation.value ? '0 ms' : '等待结果'))
const timeSavingRate = computed(() => effect.value?.conclusion?.improvement || (hasEvaluation.value ? '0%' : '等待结果'))
const processLift = computed(() => effect.value?.conclusion?.secondaryValue || (hasEvaluation.value ? '0%' : '等待结果'))

const delayMetricRows = computed(() => {
  if (comparison.value.length) return comparison.value
  const waiting = hasEvaluation.value ? '—' : '等待结果'
  return [
    { metric: '总时延', before: waiting, after: waiting },
    { metric: '传输时延', before: '—', after: '—' },
    { metric: '排队时延', before: '—', after: '—' },
    { metric: '压缩时延', before: '—', after: '—' },
    { metric: '解压时延', before: '—', after: '—' },
    { metric: '其他时延', before: '—', after: '—' }
  ]
})
const beforeStats = computed(() => delayMetricRows.value.map((row) => ({ label: row.metric, value: row.before })))
const afterStats = computed(() => delayMetricRows.value.map((row) => ({ label: row.metric, value: row.after })))
const summaryCards = computed(() => [
  { label: '接收文件', value: receivedCount.value, tone: 'blue' },
  { label: '接收数据量', value: transmission.value?.progress.sentSize || '—', tone: 'cyan' },
  { label: '平均处理速率', value: transmission.value?.progress.transferRate || '—', tone: 'blue' },
  { label: '当前状态', value: receiveState.value, tone: progressValue.value >= 100 ? 'green' : 'blue' }
])
const configRows = computed(() => [
  { label: '服务状态', value: serviceOnlineText.value, tone: 'green' },
  { label: '当前接收端 IP (IPv4)', value: receiverStatus.value?.ipv4 || receiverStatus.value?.ip || '正在获取' },
  { label: '接收端端口', value: String(receiverStatus.value?.port || window.location.port || '8081') },
  { label: '队列预处理', value: receiverStatus.value?.queuePreprocess === false ? '停用' : '启用' },
  { label: '预处理优先级', value: receiverStatus.value?.priority || '中' },
  { label: '预处理线程数', value: String(receiverStatus.value?.preprocessThreads || 4) },
  { label: '预处理超时 (ms)', value: String(receiverStatus.value?.preprocessTimeoutMs || 5000) },
  { label: '最大队列长度', value: String(receiverStatus.value?.maxQueueLength || 500) }
])

function priorityText(task: TransferTaskItem) {
  const priority = task.priority?.priority || ''
  return ({ CRITICAL: '高', IMPORTANT: '中', NORMAL: '低' } as Record<string, string>)[priority] || priority || '—'
}

function algorithmText(task: TransferTaskItem) {
  return String(task.currentDecision?.algorithm || 'AUTO').toUpperCase()
}

function progressPercent(value?: number) {
  return Math.max(0, Math.min(100, Number(value) || 0))
}

function progressText(value?: number) {
  const safeValue = progressPercent(value)
  return safeValue >= 100 ? '100%' : safeValue.toFixed(1) + '%'
}

function stageMark(status: string) {
  if (status === 'done') return '✓'
  if (status === 'active') return '●'
  return '○'
}
</script>

<template>
  <div class="receiver-display-shell">
    <header class="topbar">
      <div class="brand">
        <span class="brand-cube"><i></i><i></i><i></i></span>
        <span>{{ softwareTitle }}</span>
      </div>
      <div class="top-actions">
        <span class="top-status"><b class="status-dot"></b>系统在线</span>
        <span class="top-divider"></span>
        <span class="top-status muted">{{ topServiceText }}</span>
      </div>
    </header>

    <aside class="receiver-display-sidebar">
      <div class="collapse-mark">☰</div>
      <nav>
        <span class="nav-item active"><span class="nav-icon">↙</span><span>接收监控</span></span>
      </nav>
    </aside>

    <main class="receiver-display-area">
      <div v-if="message" class="toast-message error">{{ message }}</div>
      <section class="receiver-display-page" :class="{ loading: !loaded }">
        <section class="panel receiver-time-panel">
          <PanelTitle title="压缩前后时间对比" icon="▣" />
          <div class="receiver-time-compare">
            <article class="receiver-time-card">
              <header>压缩前</header>
              <div class="receiver-time-body">
                <DonutChart :data="beforeDelay"  :height="210" />
                <div class="receiver-time-stats">
                  <div v-for="item in beforeStats" :key="item.label">
                    <span>{{ item.label }}</span>
                    <b>{{ item.value }}</b>
                  </div>
                </div>
              </div>
              <footer>
                <span v-for="item in beforeDelay" :key="item.name"><i :style="{ background: item.color }"></i>{{ item.name }}</span>
              </footer>
            </article>
            <div class="receiver-time-arrows"><span>→</span><span>→</span><span>→</span></div>
            <article class="receiver-time-card after">
              <header>压缩后</header>
              <div class="receiver-time-body">
                <DonutChart :data="afterDelay"  :height="210" />
                <div class="receiver-time-stats">
                  <div v-for="item in afterStats" :key="item.label">
                    <span>{{ item.label }}</span>
                    <b>{{ item.value }}</b>
                  </div>
                </div>
              </div>
              <footer>
                <span v-for="item in afterDelay" :key="item.name"><i :style="{ background: item.color }"></i>{{ item.name }}</span>
              </footer>
            </article>
          </div>
          <div class="receiver-time-saving-row">
            <article><span>{{ timePrimaryLabel }}</span><b>{{ timePrimaryValue }}</b></article>
            <article><span>时间节省率</span><b class="green">{{ timeSavingRate }}</b></article>
            <article><span>处理效率提升</span><b>{{ processLift }}</b></article>
          </div>
        </section>

        <section class="panel receiver-config-panel">
          <PanelTitle title="接收端配置" icon="◎" />
          <div class="receiver-config-list">
            <div v-for="row in configRows" :key="row.label" class="receiver-config-row">
              <i :class="row.tone || ''"></i>
              <span>{{ row.label }}</span>
              <b :class="row.tone || ''">{{ row.value }}</b>
            </div>
          </div>
        </section>

        <section class="panel receiver-summary-panel">
          <PanelTitle title="接收总结" icon="▥" />
          <div class="receiver-summary-cards">
            <article v-for="card in summaryCards" :key="card.label" :class="card.tone">
              <span>{{ card.label }}</span>
              <b>{{ card.value }}</b>
            </article>
          </div>
          <div class="receiver-progress-block">
            <div class="receiver-progress-title"><span>传输进度</span><b>{{ progressValue.toFixed(0) }}%</b></div>
            <div class="receiver-receive-track"><i :style="{ width: progressValue + '%' }"></i></div>
            <div class="receiver-stage-row">
              <span v-for="stage in progressStages" :key="stage.name" :class="stage.status">
                <b>{{ stageMark(stage.status) }}</b>{{ stage.name }}
              </span>
            </div>
          </div>
        </section>

        <section class="panel receiver-task-panel task-queue-panel">
          <PanelTitle title="传输任务队列" icon="◴" :right-text="'共 ' + tasks.length + ' 个任务'" tone="blue" />
          <div class="strategy-task-table-wrap receiver-task-table-wrap">
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
                  <td><span class="task-name-button receiver-task-name">{{ task.fileName }}</span></td>
                  <td>{{ priorityText(task) }}</td>
                  <td><b class="algorithm-code">{{ algorithmText(task) }}</b></td>
                  <td>
                    <div class="queue-progress"><i :style="{ width: progressPercent(task.progressPercent) + '%' }"></i></div>
                    <span>{{ progressText(task.progressPercent) }}</span>
                  </td>
                  <td>
                    <a
                      v-if="task.packageKind !== 'FOLDER'"
                      :href="`/api/receiver/tasks/${encodeURIComponent(task.id)}/content/file`"
                      target="_blank"
                      rel="noopener"
                    >打开文件</a>
                    <button v-else class="queue-action-disabled" type="button" disabled aria-disabled="true">打开文件</button>
                  </td>
                  <td>
                    <a
                      :href="`/api/receiver/tasks/${encodeURIComponent(task.id)}/browse`"
                      target="_blank"
                      rel="noopener"
                    >打开文件夹</a>
                  </td>
                </tr>
                <tr v-if="!tasks.length"><td colspan="6" class="queue-empty">暂无传输任务</td></tr>
              </tbody>
            </table>
          </div>
        </section>
      </section>
    </main>
  </div>
</template>
