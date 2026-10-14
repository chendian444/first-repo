<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import PanelTitle from '@/components/PanelTitle.vue'
import { dashboardApi } from '@/api/dashboard'
import type { AlgorithmOption, RabbitMqStatus, TaskOptions, TransmissionDashboard } from '@/types/dashboard'

const props = withDefaults(defineProps<{ controlsOnly?: boolean }>(), { controlsOnly: false })
const data = ref<TransmissionDashboard | null>(null)
const options = ref<TaskOptions | null>(null)
const loading = ref(false)
const saving = ref(false)
const uploading = ref(false)
const uploadProgress = ref(0)
const ingesting = ref<'queue' | 'api' | ''>('')
const ingressMode = ref<'queue' | 'api' | ''>('')
const selectedQueueFiles = ref<File[]>([])
const queueUploadProgress = ref(0)
const rabbitmq = ref<RabbitMqStatus | null>(null)
const starting = ref(false)
const connectingReceiver = ref(false)
const disconnectingReceiver = ref(false)
const message = ref('')
const messageError = ref(false)
const receiverAddress = ref('')
const config = reactive({ fileId: '', mode: 'AUTO' as 'AUTO' | 'MANUAL', algorithmId: '', level: '', priority: '' })
const fileInput = ref<HTMLInputElement | null>(null)
const folderInput = ref<HTMLInputElement | null>(null)
const queueFileInput = ref<HTMLInputElement | null>(null)
const queueFolderInput = ref<HTMLInputElement | null>(null)
let receiverAddressInitialized = false
let backgroundLoading = false
let timer: number | undefined
let lastFailureKey = ''

const ACTIVE_STATES = new Set(['RUNNING', 'PROFILING', 'WAITING_NETWORK', 'TRANSMITTING', 'VERIFYING', 'RETRYING'])

const canEdit = computed(() => Boolean(options.value?.editable && !saving.value && !uploading.value && !ingesting.value))
const isRunning = computed(() => ACTIVE_STATES.has(String(data.value?.task.state || '').toUpperCase()))
const isManualMode = computed(() => config.mode === 'MANUAL')
const selectedAlgorithm = computed<AlgorithmOption | undefined>(() => options.value?.algorithmOptions.find((item) => item.id === config.algorithmId))
const currentFileOption = computed(() => options.value?.fileOptions.find((item) => item.id === config.fileId))
const currentIngressMode = computed<'queue' | 'api' | ''>(() => {
  const mode = String(currentFileOption.value?.preTransmission?.mode || '').toUpperCase()
  if (mode === 'MESSAGE_QUEUE_STREAM') return 'queue'
  if (mode === 'API_CALLBACK') return 'api'
  return ''
})
const uploadLabel = computed(() => uploadProgress.value > 0 ? `上传中 ${Math.floor(uploadProgress.value)}%` : '上传中...')
const rabbitConnected = computed(() => Boolean(rabbitmq.value?.connected))
const rabbitStatusText = computed(() => rabbitConnected.value ? '已连接' : '未连接')
const receiverConnected = computed(() => Boolean(data.value?.receiver.remoteConnected))
const receiverStatusText = computed(() => receiverConnected.value ? '接收端已连接' : (data.value?.receiver.remoteMessage || '接收端未连接'))
const receiverTone = computed<'blue' | 'green'>(() => receiverConnected.value ? 'green' : 'blue')
const startButtonText = computed(() => starting.value ? '启动中...' : (isRunning.value ? '传输中' : '开始传输'))
const senderMetricKeys = ['fileName', 'fileSize', 'algorithm', 'priority']
const senderMetrics = computed(() => senderMetricKeys.flatMap((key) => {
  const value = data.value?.sender?.[key]
  return value === undefined ? [] : [[key, value] as [string, string | number]]
}))

function packageInfo(files: File[]) {
  const firstPath = files[0]?.webkitRelativePath || ''
  const isFolder = firstPath.includes('/')
  const packageName = isFolder ? firstPath.split('/')[0] : (files[0]?.name || '数据包')
  const packageKind = isFolder || files.length > 1 ? 'FOLDER' : 'FILE'
  return { packageName, packageKind, isFolder }
}

function retryCountOf(dashboard: TransmissionDashboard) {
  const direct = Number(dashboard.task.retryCount)
  if (Number.isFinite(direct)) return Math.max(0, direct)
  const metric = dashboard.keyMetrics.find((item) => item.label.includes('重试'))
  const matched = String(metric?.value || '').match(/\d+/)
  return matched ? Number(matched[0]) : 0
}

function notifyRetryExhaustion(dashboard: TransmissionDashboard) {
  const state = String(dashboard.task.state || '').toUpperCase()
  const retryCount = retryCountOf(dashboard)
  const exhausted = Boolean(dashboard.task.retryExhausted || (state === 'FAILED' && retryCount > 0))
  const key = `${dashboard.task.id || dashboard.task.fileName || 'current'}:${retryCount}`
  if (exhausted && lastFailureKey !== key) {
    message.value = `异常提示：任务失败，重试已达到上限（已重试 ${retryCount} 次），请检查链路并人工补传。`
    messageError.value = true
    lastFailureKey = key
  }
  if (state !== 'FAILED') lastFailureKey = ''
}

function applyConfig(taskOptions: TaskOptions) {
  config.fileId = taskOptions.currentConfig.fileId
  config.mode = taskOptions.currentConfig.mode || 'AUTO'
  config.algorithmId = taskOptions.currentConfig.algorithmId
  config.level = taskOptions.currentConfig.level
  config.priority = taskOptions.currentConfig.priority
}

async function load(showLoading = false, includeOptions = showLoading || !options.value) {
  if (!showLoading && backgroundLoading) return
  backgroundLoading = true
  if (showLoading) loading.value = true
  try {
    const rabbitStatusPromise = dashboardApi.rabbitmqStatus().catch(() => null)
    const [dashboard, taskOptions, rabbitStatus] = await Promise.all([
      dashboardApi.transmission(),
      includeOptions || !options.value ? dashboardApi.taskOptions() : Promise.resolve(options.value),
      rabbitStatusPromise
    ])
    data.value = dashboard
    notifyRetryExhaustion(dashboard)
    if (rabbitStatus) rabbitmq.value = rabbitStatus
    if (!receiverAddressInitialized && dashboard.receiver.remoteAddress) {
      receiverAddress.value = dashboard.receiver.remoteAddress
      receiverAddressInitialized = true
    }
    if (taskOptions) {
      const previous = options.value
      options.value = taskOptions
      if (!previous || !config.fileId) applyConfig(taskOptions)
    }
  } catch (error) {
    message.value = error instanceof Error ? error.message : '无法获取传输监控数据'
    messageError.value = true
  } finally {
    backgroundLoading = false
    if (showLoading) loading.value = false
  }
}

async function connectReceiver() {
  if (connectingReceiver.value || disconnectingReceiver.value) return
  const address = receiverAddress.value.trim()
  if (!address) {
    message.value = '请输入接收端IP地址，格式如172.20.10.3:8081'
    messageError.value = true
    return
  }
  connectingReceiver.value = true
  try {
    const result = await dashboardApi.connectReceiver(address)
    message.value = result.message || `连接成功，远端接收机：${result.address}`
    messageError.value = !result.success
    if (result.success) {
      receiverAddress.value = result.address
      receiverAddressInitialized = true
      await load(true)
    }
  } catch {
    message.value = '连接失败，请检查IP地址、网络、接收端服务是否启动'
    messageError.value = true
  } finally {
    connectingReceiver.value = false
  }
}

async function disconnectReceiver() {
  if (disconnectingReceiver.value || connectingReceiver.value) return
  disconnectingReceiver.value = true
  try {
    const result = await dashboardApi.disconnectReceiver()
    message.value = result.message || '已断开远端接收端连接'
    messageError.value = !result.success
    await load(true)
  } catch (error) {
    message.value = error instanceof Error ? error.message : '断开连接失败'
    messageError.value = true
  } finally {
    disconnectingReceiver.value = false
  }
}

function openFilePicker() {
  if (canEdit.value) fileInput.value?.click()
}

function openFolderPicker() {
  if (canEdit.value) folderInput.value?.click()
}

async function handlePackageChange(event: Event) {
  const input = event.target as HTMLInputElement
  const files = Array.from(input.files || [])
  if (files.length) {
    uploading.value = true
    uploadProgress.value = 0
    try {
      const result = await dashboardApi.uploadPackage(files, (progress) => {
        uploadProgress.value = Math.max(0, Math.min(100, progress))
        if (uploadProgress.value > 0 && uploadProgress.value < 100) {
          message.value = `上传中 ${Math.floor(uploadProgress.value)}%`
          messageError.value = false
        }
      })
      message.value = result.message
      messageError.value = !result.success
      await load(true)
    } catch (error) {
      message.value = error instanceof Error ? error.message : '数据包选择失败'
      messageError.value = true
    } finally {
      uploading.value = false
      uploadProgress.value = 0
      input.value = ''
    }
  }
}

function selectIngressMode(mode: 'queue' | 'api') {
  if (!canEdit.value) return
  ingressMode.value = mode
  messageError.value = false
  message.value = mode === 'queue'
    ? '已选择消息队列流式传输，请选择文件或文件夹后开始接入'
    : '已选择API接口数据接入，接口保持 POST /api/ingress/api-callback'
}

function openQueuePackagePicker() {
  if (!canEdit.value || ingressMode.value !== 'queue') return
  if (window.confirm('请选择接入类型：\n确定：选择文件夹\n取消：选择文件')) queueFolderInput.value?.click()
  else queueFileInput.value?.click()
}

function handleQueuePackageChange(event: Event) {
  const input = event.target as HTMLInputElement
  const files = Array.from(input.files || [])
  selectedQueueFiles.value = files
  queueUploadProgress.value = 0
  if (files.length) {
    const { packageName, packageKind, isFolder } = packageInfo(files)
    message.value = `已选择RabbitMQ接入${packageKind === 'FOLDER' ? (isFolder ? '文件夹' : '多文件') : '文件'}：${packageName}${packageKind === 'FOLDER' ? `（${files.length}项）` : ''}`
    messageError.value = false
  }
  input.value = ''
}

async function startIngress() {
  if (!canEdit.value || ingesting.value) return
  if (ingressMode.value === 'api') {
    message.value = 'API模式已选择：请通过 POST /api/ingress/api-callback 接入数据'
    messageError.value = false
    return
  }
  if (ingressMode.value !== 'queue') {
    message.value = '请先选择接入模式'
    messageError.value = true
    return
  }
  if (!selectedQueueFiles.value.length) {
    openQueuePackagePicker()
    return
  }

  ingesting.value = 'queue'
  queueUploadProgress.value = 0
  message.value = '正在检查RabbitMQ连接...'
  messageError.value = false
  try {
    const latestRabbit = await dashboardApi.rabbitmqStatus().catch(() => null)
    if (latestRabbit) rabbitmq.value = latestRabbit
    if (!latestRabbit?.connected) {
      message.value = latestRabbit?.message || 'RabbitMQ未连接，请先启动RabbitMQ Broker'
      messageError.value = true
      return
    }
    message.value = '正在提交RabbitMQ传输任务...'
    const result = await dashboardApi.ingestMessageQueuePackage(selectedQueueFiles.value, (progress) => {
      queueUploadProgress.value = Math.max(0, Math.min(100, progress))
      if (queueUploadProgress.value > 0 && queueUploadProgress.value < 100) {
        message.value = `RabbitMQ传输中 ${Math.floor(queueUploadProgress.value)}%`
        messageError.value = false
      }
    })
    message.value = result.message
    messageError.value = !result.success
    selectedQueueFiles.value = []
    ingressMode.value = 'queue'
    await load(true)
  } catch (error) {
    message.value = error instanceof Error ? error.message : 'RabbitMQ接入失败'
    messageError.value = true
  } finally {
    ingesting.value = ''
    queueUploadProgress.value = 0
  }
}

async function saveConfiguration() {
  if (!canEdit.value) return
  saving.value = true
  try {
    const result = await dashboardApi.updateTaskConfig({
      fileId: config.fileId,
      mode: config.mode,
      algorithmId: config.algorithmId,
      level: config.level,
      priority: config.priority
    })
    message.value = result.message
    messageError.value = !result.success
    if (result.success) await load(true)
  } catch (error) {
    message.value = error instanceof Error ? error.message : '任务配置保存失败'
    messageError.value = true
  } finally {
    saving.value = false
  }
}

async function startTransfer() {
  if (starting.value || isRunning.value) return
  starting.value = true
  try {
    const result = await dashboardApi.startTransfer()
    message.value = result.message
    messageError.value = !result.success
    await load(true)
  } catch (error) {
    message.value = error instanceof Error ? error.message : '启动失败'
    messageError.value = true
  } finally {
    starting.value = false
  }
}

async function stopTransfer() {
  try {
    const result = await dashboardApi.stopTransfer()
    message.value = result.message
    messageError.value = !result.success
    await load(true)
  } catch (error) {
    message.value = error instanceof Error ? error.message : '暂停失败'
    messageError.value = true
  }
}

async function resetTransfer() {
  try {
    const result = await dashboardApi.resetTransfer()
    message.value = result.message
    messageError.value = !result.success
    await load(true)
  } catch (error) {
    message.value = error instanceof Error ? error.message : '重置失败'
    messageError.value = true
  }
}

function displayValue(value: number | string | null, unit = '') {
  if (value === null || value === undefined || value === '') return '—'
  return `${value}${unit}`
}

function routeStep(index: number) {
  return data.value?.route.steps?.[index] || { name: '', status: 'waiting', text: '未开始' }
}

onMounted(async () => {
  await load(true)
  timer = window.setInterval(() => load(false, false), 1000)
})

onBeforeUnmount(() => {
  if (timer) window.clearInterval(timer)
})
</script>

<template>
  <section class="transmission-page">
    <div v-if="data && options" class="transmission-layout" :class="{ 'split-controls': props.controlsOnly }">
      <div v-if="message" class="toast-message" :class="{ error: messageError }" role="status">{{ message }}</div>

      <section class="panel sender-panel">
        <PanelTitle title="发送端配置" />
        <div class="task-form-head">
          <span>传输任务配置</span>
          <b :class="data.task.state.toLowerCase()">{{ data.task.stateText }}</b>
        </div>
        <div class="task-form">
          <label>
            <span>发送数据包</span>
            <select v-model="config.fileId" :disabled="!canEdit" @change="saveConfiguration">
              <option v-for="item in options.fileOptions" :key="item.id" :value="item.id">{{ item.name }}</option>
            </select>
          </label>
          <div class="file-select-row package-pick-row">
            <button type="button" class="file-pick-button" :disabled="!canEdit" @click="openFilePicker">{{ uploading ? uploadLabel : '选择文件' }}</button>
            <button type="button" class="file-pick-button" :disabled="!canEdit" @click="openFolderPicker">{{ uploading ? uploadLabel : '选择文件夹' }}</button>
            <input ref="fileInput" class="visually-hidden-file" type="file" @change="handlePackageChange" />
            <input ref="folderInput" class="visually-hidden-file" type="file" webkitdirectory multiple @change="handlePackageChange" />
          </div>
          <div class="ingress-action-row">
            <button type="button" class="file-pick-button ingress-button" :class="{ active: ingressMode === 'queue' || currentIngressMode === 'queue' }" :disabled="!canEdit" @click="selectIngressMode('queue')">消息队列流式传输</button>
            <button type="button" class="file-pick-button ingress-button" :class="{ active: ingressMode === 'api' || currentIngressMode === 'api' }" :disabled="!canEdit" @click="selectIngressMode('api')">API接口数据接入</button>
          </div>
          <div class="rabbitmq-status-line" :class="{ connected: rabbitConnected }">
            <span>{{ rabbitStatusText }}</span>
          </div>
          <div v-if="ingressMode === 'queue'" class="queue-ingress-row queue-ingress-action">
            <button type="button" class="file-pick-button ingress-start-button" :disabled="!canEdit || ingesting === 'queue'" @click="startIngress">
              {{ ingesting === 'queue' ? `RabbitMQ传输中 ${Math.floor(queueUploadProgress)}%` : '开始接入' }}
            </button>
            <input ref="queueFileInput" class="visually-hidden-file" type="file" multiple @change="handleQueuePackageChange" />
            <input ref="queueFolderInput" class="visually-hidden-file" type="file" webkitdirectory multiple @change="handleQueuePackageChange" />
          </div>
          <div v-else-if="ingressMode === 'api'" class="queue-ingress-row">
            <button type="button" class="file-pick-button ingress-start-button" :disabled="!canEdit" @click="startIngress">开始接入</button>
          </div>
          <div class="control-mode-field">
            <span class="control-mode-title">压缩控制模式</span>
            <div class="control-mode-switch">
              <label :class="{ active: config.mode === 'AUTO' }">
                <input v-model="config.mode" type="radio" value="AUTO" :disabled="!canEdit" @change="saveConfiguration" />
                <b>自动控制</b>
              </label>
              <label :class="{ active: config.mode === 'MANUAL' }">
                <input v-model="config.mode" type="radio" value="MANUAL" :disabled="!canEdit" @change="saveConfiguration" />
                <b>手动控制</b>
              </label>
            </div>
          </div>
          <label>
            <span>压缩算法</span>
            <select v-if="isManualMode" v-model="config.algorithmId" :disabled="!canEdit" @change="saveConfiguration">
              <option v-for="item in options.algorithmOptions" :key="item.id" :value="item.id">{{ item.name }}</option>
            </select>
            <select v-else disabled><option>系统自动选择最优算法</option></select>
          </label>
          <p v-if="isManualMode" class="field-help">{{ `${selectedAlgorithm?.compressionRate || '动态'} 压缩率 · ${selectedAlgorithm?.description || ''}` }}</p>
          <div class="form-split">
            <label>
              <span>压缩级别</span>
              <select v-if="isManualMode" v-model="config.level" :disabled="!canEdit" @change="saveConfiguration">
                <option v-for="level in options.levelOptions" :key="level" :value="level">等级 {{ level }}</option>
              </select>
              <select v-else disabled><option>系统自动选择</option></select>
            </label>
            <label>
              <span>调度优先级</span>
              <select v-model="config.priority" :disabled="!canEdit" @change="saveConfiguration">
                <option v-for="priority in options.priorityOptions" :key="priority" :value="priority">{{ priority }}</option>
              </select>
            </label>
          </div>
        </div>
        <dl class="config-list">
          <template v-for="([label, value]) in senderMetrics" :key="label">
            <dt>{{ label }}</dt>
            <dd>{{ value }}</dd>
          </template>
        </dl>
        <div class="task-actions">
          <button class="primary-action" :disabled="starting || isRunning || uploading || !!ingesting" @click="startTransfer"><span>▶</span>{{ startButtonText }}</button>
          <div class="sub-actions">
            <button :disabled="!isRunning" @click="stopTransfer">暂停任务</button>
            <button :disabled="loading || data.task.state === 'IDLE'" @click="resetTransfer">重置</button>
          </div>
        </div>
      </section>

      <section v-if="!props.controlsOnly" class="panel route-panel">
        <PanelTitle title="传输链路" :right-text="data.route.status" :tone="isRunning ? 'green' : 'blue'" />
        <div class="route-visual reference-route route-wireframe" :class="{ idle: data.task.state === 'IDLE', running: isRunning, completed: data.task.state === 'COMPLETED' }">
          <section class="route-source-card">
            <h3>多模态监测数据</h3>
            <div class="source-type-list">
              <article><span class="source-icon icon-slot has-image"><img src="/route-icons/source-video.png" alt="" /></span><b>视频 / 图像</b></article>
              <article><span class="source-icon icon-slot has-image"><img src="/route-icons/source-metric.png" alt="" /></span><b>统计 / 指标</b></article>
              <article><span class="source-icon icon-slot has-image"><img src="/route-icons/source-sensor.png" alt="" /></span><b>传感器 / 监测</b></article>
              <article><span class="source-icon icon-slot has-image"><img src="/route-icons/source-log.png" alt="" /></span><b>日志 / 文本</b></article>
            </div>
          </section>
          <div class="route-main-flow">
            <article class="route-step compress" :class="routeStep(0).status">
              <div class="route-step-icon icon-slot has-image"><img src="/route-icons/compress.png" alt="" /></div>
              <strong>动态压缩处理</strong><span>压缩编码 / 策略控制</span><em :class="routeStep(0).status"><i></i>{{ routeStep(0).text }}</em>
            </article>
            <div class="route-arrow"></div>
            <article class="route-step sender" :class="routeStep(1).status">
              <div class="route-step-icon icon-slot has-image"><img src="/route-icons/sender.png" alt="" /></div>
              <strong>分级发送 / 发送端</strong><span>优先级调度 / 分片发送</span><em :class="routeStep(1).status"><i></i>{{ routeStep(1).text }}</em>
            </article>
            <div class="route-arrow"></div>
            <article class="route-step network" :class="routeStep(2).status">
              <div class="route-step-icon icon-slot has-image"><img src="/route-icons/network.png" alt="" /></div>
              <strong>传输网络</strong><span>4G / 5G / 专网 /<br />工业以太网</span><em :class="routeStep(2).status"><i></i>{{ routeStep(2).text }}</em>
            </article>
            <div class="route-arrow"></div>
            <article class="route-step receiver" :class="routeStep(3).status">
              <div class="route-step-icon icon-slot has-image"><img src="/route-icons/receiver.png" alt="" /></div>
              <strong>接收端</strong><span>接收 / 校验 / 缓存</span><em :class="routeStep(3).status"><i></i>{{ routeStep(3).text }}</em>
            </article>
            <div class="route-arrow"></div>
            <article class="route-step decompress" :class="routeStep(4).status">
              <div class="route-step-icon icon-slot has-image"><img src="/route-icons/decompress.png" alt="" /></div>
              <strong>解压缩处理</strong><span>解压 / 数据恢复</span><em :class="routeStep(4).status"><i></i>{{ routeStep(4).text }}</em>
            </article>
          </div>
          <div class="route-feedback-loop" aria-hidden="true">
            <span class="route-feedback-vertical route-feedback-left"></span>
            <span class="route-feedback-horizontal route-feedback-horizontal-left"></span>
            <span class="route-feedback-horizontal route-feedback-horizontal-right"></span>
            <span class="route-feedback-vertical route-feedback-right"></span>
          </div>
          <section class="route-monitor-card">
            <div class="monitor-pulse-icon icon-slot has-image"><img src="/route-icons/monitor.png" alt="" /></div>
            <div><strong>网络状态监测及预测</strong><span>带宽 / 时延 / 丢包 / 质量</span></div>
          </section>
        </div>
        <div class="link-metric-grid">
          <article v-for="metric in data.route.metrics" :key="metric.label" :class="metric.tone">
            <span>{{ metric.label }}</span><b>{{ metric.value }}</b><small>{{ metric.note }}</small>
          </article>
        </div>
        <div class="progress-section">
          <div class="progress-main">
            <div class="progress-title"><span>传输进度</span><b>{{ data.progress.value }}%</b></div>
            <div class="progress-track"><i :class="{ running: isRunning }" :style="{ width: `${data.progress.value}%` }"></i></div>
            <div class="stage-list">
              <span v-for="stage in data.progress.stages" :key="stage.name" :class="stage.status"><b>{{ stage.status === 'done' ? '✓' : stage.status === 'active' ? '◉' : '○' }}</b>{{ stage.name }}</span>
            </div>
          </div>
          <div class="progress-stat highlight-stat"><span>已处理帧/总帧</span><b>{{ data.progress.chunkProgress }}</b></div>
          <div class="progress-stat"><span>▣ 已传输 / {{ data.progress.totalLabel || '压缩后总量' }}</span><b>{{ data.progress.sentSize }} <em>/ {{ data.progress.totalSize }}</em></b></div>
          <div class="progress-stat"><span>↯ 当前传输速率</span><b>{{ data.progress.transferRate }}</b></div>
        </div>
      </section>

      <section class="panel receiver-panel">
        <PanelTitle title="接收端状态" :right-text="receiverStatusText" :tone="receiverTone" />
        <div class="receiver-section receiver-overview">
          <div class="receiver-connect-form">
            <input v-model="receiverAddress" type="text" :disabled="connectingReceiver || disconnectingReceiver" placeholder="请输入接收端IP地址" @keyup.enter="connectReceiver" />
            <button type="button" :disabled="connectingReceiver || disconnectingReceiver" @click="receiverConnected ? disconnectReceiver() : connectReceiver()">
              {{ connectingReceiver ? '连接中...' : disconnectingReceiver ? '断开中...' : receiverConnected ? '断开连接' : '建立连接' }}
            </button>
          </div>
          <div class="receiver-status-item"><span>远端接收机</span><b :class="{ complete: data.receiver.remoteConnected }">{{ data.receiver.remoteAddress || '未连接' }}</b></div>
          <div class="receiver-status-item"><span>通信状态</span><b :class="{ complete: data.receiver.remoteConnected }">{{ data.receiver.remoteConnected ? '已连接' : data.receiver.remoteMessage || '待连接' }}</b></div>
        </div>
        <div class="receiver-section receiver-services">
          <h3>服务状态</h3>
          <div v-for="service in data.receiver.services" :key="service.name" class="service-row">
            <span><i>◈</i>{{ service.name }}</span><b :class="{ complete: service.status === '完成', waiting: service.status === '待命' }">● {{ service.status }}</b>
          </div>
        </div>
        <div class="receiver-section receiver-queue">
          <h3>队列与处理</h3>
          <div><span>分块个数</span><b>{{ data.receiver.chunkCount }}</b></div>
          <div><span>正在处理任务</span><b>{{ data.receiver.processingTasks }}</b></div>
          <div><span>平均响应延迟</span><b>{{ displayValue(data.receiver.averageResponseDelay, ' ms') }}</b></div>
          <div><span>最大响应延迟</span><b>{{ displayValue(data.receiver.maxResponseDelay, ' ms') }}</b></div>
        </div>
      </section>
    </div>

    <section v-if="data && !props.controlsOnly" class="panel monitor-metrics-panel">
      <div class="section-heading">
        <h2>关键指标 <small>（任务实时）</small></h2>
        <label>刷新频率：<b>1 秒</b></label>
      </div>
      <div class="monitor-metrics-grid">
        <article v-for="metric in data.keyMetrics" :key="metric.label" class="kpi-card" :class="metric.status || ''">
          <div><small>{{ metric.label }}</small><strong>{{ metric.value }}</strong><em v-if="metric.note">{{ metric.note }}</em></div>
        </article>
      </div>
    </section>

    <div v-if="!data && !loading" class="empty-panel">服务暂不可用，请先启动后端服务。</div>
  </section>
</template>
