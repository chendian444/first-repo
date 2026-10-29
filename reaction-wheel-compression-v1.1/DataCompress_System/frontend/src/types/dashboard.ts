export interface ApiResponse<T> {
  code: number
  message: string
  data: T
}

export type TaskState = 'IDLE' | 'RUNNING' | 'PAUSED' | 'FAILED' | 'COMPLETED'

export interface TaskSummary {
  id?: string
  state: TaskState
  stateText: string
  fileName: string
  fileSize: string
  fileType: string
  algorithm: string
  algorithmId: string
  level: string
  priority: string
  estimatedCompressedSize: string
  estimatedSaving: string
  retryCount?: number
  retryExhausted?: boolean
  message?: string
  editable: boolean
}

export interface PreTransmissionInfo {
  enabled: boolean
  mode: 'MESSAGE_QUEUE_STREAM' | 'API_CALLBACK' | string
  sourceProtocol?: string
  queue?: string
  frameBytes: number
  totalBytes: number
  frameCount: number
}
export interface FileOption {
  id: string
  name: string
  label: string
  size: string
  type: string
  description: string
  itemCount?: number
  packageKind?: 'FILE' | 'FOLDER'
  preTransmission?: PreTransmissionInfo
}

export interface IngressMetadata {
  version: string
  ingressMode: 'MESSAGE_QUEUE_STREAM' | 'API_CALLBACK' | string
  sourceProtocol: string
  sourceName: string
  topic?: string
  messageId?: string
  frameBytes: number
  totalBytes: number
  frameCount: number
  packageName: string
  receivedAt: string
}

export interface IngressResult {
  success: boolean
  message: string
  file: FileOption
  currentConfig: TaskConfig
  ingress: IngressMetadata
}
export interface AlgorithmOption {
  id: string
  name: string
  compressionRate: string
  description: string
}

export interface TaskConfig {
  fileId: string
  mode: 'AUTO' | 'MANUAL'
  algorithmId: string
  level: string
  priority: string
  state: TaskState
  stateText: string
}

export interface TaskOptions {
  fileOptions: FileOption[]
  algorithmOptions: AlgorithmOption[]
  levelOptions: string[]
  priorityOptions: string[]
  currentConfig: TaskConfig
  editable: boolean
}

export interface RabbitMqStatus {
  connected: boolean
  status: '已连接' | '未连接' | string
  message: string
  queue: string
  url: string
  publishedMessages: number
  consumedMessages: number
  ackedMessages: number
  consumedBytes: number
  lastPublishedAtMillis?: number
  lastConsumedAtMillis?: number
}

export interface ReceiverStatus {
  receiver: string
  online: boolean
  serviceStatus: string
  ip: string
  ipv4: string
  port: number
  receivedDir: string
  queuePreprocess: boolean
  priority: string
  preprocessThreads: number
  preprocessTimeoutMs: number
  maxQueueLength: number
  dashboardSync?: { active: boolean; updatedAtMillis?: number | null }
}

export interface DelayItem {
  name: string
  value: number
  color: string
}

export interface TrendPoint {
  time: string
  value: number
}

export interface TransmissionDashboard {
  task: TaskSummary
  sender: Record<string, string | number>
  receiver: {
    online: boolean
    remoteAddress?: string
    remoteConnected?: boolean
    remoteState?: 'CONNECTED' | 'DISCONNECTED'
    remoteMessage?: string
    services: { name: string; status: string }[]
    chunkCount: number
    processingTasks: number
    averageResponseDelay: number | null
    maxResponseDelay: number | null
  }
  route: {
    status: string
    nodes: { label: string; subLabel?: string; delay?: string; kind: string }[]
    steps: { name: string; status: 'done' | 'active' | 'waiting'; text: string }[]
    metrics: { label: string; value: string; note: string; tone: string }[]
  }
  progress: {
    value: number
    state: string
    chunkProgress: string
    sentSize: string
    totalSize: string
    totalLabel?: string
    transferRate: string
    stages: { name: string; status: string }[]
  }
  keyMetrics: { label: string; value: string; note: string; status?: string }[]
  activityLog: { title: string; detail: string; status: 'done' | 'active' | 'wait' }[]
  preview: { label: string; value: string; note: string }[]
}

export interface StrategyDashboard {
  task: TaskSummary
  compressionCurve: { ratio: number[]; totalTime: number[]; recommended: [number, number]; bestTime: number }
  networkForecast: {
    time: string[]
    predicted: number[]
    actual: number[]
    safe: number[]
    points: {
      elapsedMillis: number
      time: string
      actualRateKbps: number
      predictedRateKbps: number
      safeRateKbps: number
      predictionErrorPercent: number
    }[]
    modelName: string
    windowLabel: string
    yMax: number
    metrics: { label: string; value: string }[]
    annotations: { elapsedMillis: number; time: string; label: string; text: string; offset: number }[]
  }
  recommendation: { icon: string; label: string; value: string; extra?: string }[]
  adjustments: { id: string; time: string; title: string; operation: string; target: string }[]
}

export interface EffectDashboard {
  hasEvaluation: boolean
  snapshot?: boolean
  taskId?: string
  message?: string
  task: TaskSummary
  file?: Record<string, string>
  beforeDelay?: DelayItem[]
  afterDelay?: DelayItem[]
  network?: {
    status: string
    note: string
    metrics: { label: string; value: string }[]
    trend: TrendPoint[]
    yMax?: number
  }
  comparison?: { metric: string; before: string; after: string; change: string; direction?: 'down' | 'up' | 'none'; emphasis?: boolean }[]
  additionalDelayTitle?: string
  additionalDelayNote?: string
  additionalDelay?: { label: string; value: string; tone: string; note?: string }[]
  conclusion?: {
    improved?: boolean
    noCompression?: boolean
    intro?: string
    primaryLabel?: string
    primaryValue?: string
    primaryDescription?: string
    secondaryLabel?: string
    secondaryValue?: string
    secondaryDescription?: string
    timeSaved: string
    improvement: string
    totalBefore?: string
    totalAfter?: string
    details: string[]
    evaluatedAt: string
    result: string
  }
}


export interface TransferTaskItem {
  id: string
  fileName: string
  packageKind?: 'FILE' | 'FOLDER'
  itemCount?: number
  progressPercent: number
  state: string
  priority?: { priority?: string }
  currentDecision?: { algorithm?: string; level?: number }
}
