import type { ApiResponse, EffectDashboard, FileOption, IngressResult, RabbitMqStatus, ReceiverStatus, StrategyDashboard, TaskConfig, TaskOptions, TransmissionDashboard, TransferTaskItem } from '@/types/dashboard'

const apiRoot = import.meta.env.VITE_API_BASE_URL || '/api'
const LARGE_UPLOAD_THRESHOLD_BYTES = 1024 * 1024 * 1024

interface ChunkedUploadStart {
  success: boolean
  uploadId: string
  chunkBytes: number
  frameBytes: number
  totalBytes: number
  fileCount: number
  message: string
}

interface ChunkedUploadProgress {
  success: boolean
  uploadId: string
  receivedBytes: number
  totalBytes: number
  progressPercent: number
  frameCount: number
}

interface RabbitMqUploadStart {
  success: boolean
  uploadId: string
  queue: string
  chunkBytes: number
  frameBytes: number
  totalBytes: number
  fileCount: number
  message: string
}

interface RabbitMqChunkProgress {
  success: boolean
  uploadId: string
  publishedBytes: number
  message: string
}

function buildIngressMessageId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`
}
function packageInfoFromFiles(files: File[]) {
  const firstPath = files[0]?.webkitRelativePath || ''
  const packageName = firstPath.includes('/') ? firstPath.split('/')[0] : (files[0]?.name || '数据包')
  const packageKind = firstPath.includes('/') || files.length > 1 ? 'FOLDER' : 'FILE'
  const totalBytes = files.reduce((sum, file) => sum + file.size, 0)
  return { packageName, packageKind, totalBytes }
}
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const isFormData = init?.body instanceof FormData
  const response = await fetch(`${apiRoot}${path}`, {
    headers: isFormData ? (init?.headers || {}) : { 'Content-Type': 'application/json', ...(init?.headers || {}) },
    ...init
  })

  if (!response.ok) {
    throw new Error(`请求失败：${response.status}`)
  }

  const payload = (await response.json()) as ApiResponse<T>
  if (payload.code !== 0) throw new Error(payload.message || '服务返回异常')
  return payload.data
}

async function requestChunk<T>(path: string, body: Blob, headers: Record<string, string>): Promise<T> {
  const response = await fetch(`${apiRoot}${path}`, { method: 'PUT', headers, body })
  if (!response.ok) throw new Error(`请求失败：${response.status}`)
  const payload = (await response.json()) as ApiResponse<T>
  if (payload.code !== 0) throw new Error(payload.message || '服务返回异常')
  return payload.data
}
async function ingestMessageQueuePackage(files: File[], onProgress?: (progressPercent: number) => void) {
  const selectedFiles = files.filter(Boolean)
  if (!selectedFiles.length) throw new Error('请先选择要发送到RabbitMQ的文件或文件夹')
  const { packageName, packageKind, totalBytes } = packageInfoFromFiles(selectedFiles)
  const start = await request<RabbitMqUploadStart>('/ingress/message-queue/start', {
    method: 'POST',
    body: JSON.stringify({
      packageName,
      packageKind,
      totalBytes,
      files: selectedFiles.map((file) => ({
        name: file.name || 'message-queue-stream.bin',
        relativePath: file.webkitRelativePath || file.name || 'message-queue-stream.bin',
        size: file.size,
        type: file.type || 'application/octet-stream'
      }))
    })
  })

  const chunkBytes = Math.max(64 * 1024, Number(start.chunkBytes) || 1024 * 1024)
  let sentBytes = 0
  for (let fileIndex = 0; fileIndex < selectedFiles.length; fileIndex += 1) {
    const file = selectedFiles[fileIndex]
    let offset = 0
    while (offset < file.size) {
      const end = Math.min(file.size, offset + chunkBytes)
      const chunk = file.slice(offset, end)
      await requestChunk<RabbitMqChunkProgress>('/ingress/message-queue/chunk', chunk, {
        'Content-Type': file.type || 'application/octet-stream',
        'X-Upload-Id': start.uploadId,
        'X-File-Index': String(fileIndex),
        'X-File-Offset': String(offset)
      })
      sentBytes += chunk.size
      offset = end
      onProgress?.(Math.min(99, sentBytes / Math.max(1, totalBytes) * 100))
    }
  }

  const completed = await request<IngressResult>('/ingress/message-queue/complete', {
    method: 'POST',
    body: JSON.stringify({ uploadId: start.uploadId, totalBytes })
  })
  onProgress?.(100)
  return completed
}
export const dashboardApi = {
  transmission: () => request<TransmissionDashboard>('/dashboard/transmission'),
  strategy: () => request<StrategyDashboard>('/dashboard/strategy'),
  effect: () => request<EffectDashboard>('/dashboard/effect'),
  receiverStatus: () => request<ReceiverStatus>('/receiver/status'),
  rabbitmqStatus: () => request<RabbitMqStatus>('/rabbitmq/status'),
  connectReceiver: (address: string) => request<{ success: boolean; address: string; message: string }>('/receiver/connect', {
    method: 'POST',
    body: JSON.stringify({ address })
  }),
  disconnectReceiver: () => request<{ success: boolean; paused?: boolean; message: string }>('/receiver/disconnect', {
    method: 'POST',
    body: JSON.stringify({})
  }),
  openReceivedFile: (taskId: string) => request<{ success: boolean; taskId: string; fileName: string; savedTo: string; message: string }>('/receiver/open-file', {
    method: 'POST',
    body: JSON.stringify({ taskId })
  }),
  openReceivedFolder: () => request<{ success: boolean; folder: string; message: string }>('/receiver/open-folder', {
    method: 'POST',
    body: JSON.stringify({})
  }),
  taskOptions: () => request<TaskOptions>('/transfer/options'),
  ingestMessageQueuePackage,
  ingestMessageQueueFile: (file: File, onProgress?: (progressPercent: number) => void) =>
    ingestMessageQueuePackage([file], onProgress),
  ingestApiCallback: () => {
    const messageId = buildIngressMessageId('api')
    return request<IngressResult>('/ingress/api-callback?packageName=api-callback-data.json&protocol=HTTP', {
      method: 'POST',
      headers: {
        'X-Package-Name': 'api-callback-data.json',
        'X-Source-Protocol': 'HTTP',
        'X-Source-Name': 'BusinessSystem',
        'X-Message-Id': messageId
      },
      body: JSON.stringify({
        requestId: messageId,
        channel: 'api-callback',
        callbackAt: new Date().toISOString(),
        service: 'business-http-service',
        payload: {
          status: 'READY',
          sequence: Date.now(),
          data: 'callback-frame-ready'
        }
      })
    })
  },
  uploadPackage: async (files: File[], onProgress?: (progressPercent: number) => void) => {
    const { packageName, packageKind, totalBytes } = packageInfoFromFiles(files)

    if (totalBytes <= LARGE_UPLOAD_THRESHOLD_BYTES) {
      const form = new FormData()
      files.forEach((file) => form.append('files', file, file.webkitRelativePath || file.name))
      form.append('packageName', packageName)
      form.append('packageKind', packageKind)
      return request<{ success: boolean; message: string; file: FileOption; currentConfig: TaskConfig }>('/transfer/file', { method: 'POST', body: form, headers: {} })
    }

    const start = await request<ChunkedUploadStart>('/transfer/chunked/start', {
      method: 'POST',
      body: JSON.stringify({
        packageName,
        packageKind,
        totalBytes,
        files: files.map((file) => ({
          name: file.name,
          relativePath: file.webkitRelativePath || file.name,
          size: file.size,
          type: file.type || 'application/octet-stream'
        }))
      })
    })

    const chunkBytes = Math.max(1024 * 1024, Number(start.chunkBytes) || 16 * 1024 * 1024)
    let sentBytes = 0
    for (let fileIndex = 0; fileIndex < files.length; fileIndex += 1) {
      const file = files[fileIndex]
      let offset = 0
      while (offset < file.size) {
        const end = Math.min(file.size, offset + chunkBytes)
        const chunk = file.slice(offset, end)
        const progress = await requestChunk<ChunkedUploadProgress>('/transfer/chunked/chunk', chunk, {
          'Content-Type': 'application/octet-stream',
          'X-Upload-Id': start.uploadId,
          'X-File-Index': String(fileIndex),
          'X-File-Offset': String(offset)
        })
        offset = end
        sentBytes += chunk.size
        onProgress?.(progress.progressPercent || Math.min(99, sentBytes / Math.max(1, totalBytes) * 100))
      }
    }

    const completed = await request<IngressResult>('/transfer/chunked/complete', {
      method: 'POST',
      body: JSON.stringify({ uploadId: start.uploadId })
    })
    onProgress?.(100)
    return completed
  },
  updateTaskConfig: (config: Pick<TaskConfig, 'fileId' | 'mode' | 'algorithmId' | 'level' | 'priority'>) =>
    request<{ success: boolean; message: string; currentConfig: TaskConfig }>('/transfer/config', { method: 'PUT', body: JSON.stringify(config) }),
  startTransfer: () => request<{ success: boolean; running: boolean; message: string }>('/transfer/start', { method: 'POST' }),
  stopTransfer: () => request<{ success: boolean; running: boolean; message: string }>('/transfer/stop', { method: 'POST' }),
  resetTransfer: () => request<{ success: boolean; running: boolean; message: string }>('/transfer/reset', { method: 'POST' }),
  transferTasks: () => request<TransferTaskItem[]>('/transfer/tasks'),
  selectTask: (id: string) => request<{ success: boolean; message: string }>('/transfer/select', {
    method: 'POST',
    body: JSON.stringify({ id })
  })
}
