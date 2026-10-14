import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { mkdtemp, mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'

import { IntegrationBridge, buildTaskSummary, calculatePredictionMetrics, createRequestHandler, estimateUncompressedTransferMillis, formatBytes, linkState, mapTaskState, normalizeReceiverAddress, parseMultipartBody } from '../src/server.mjs'


function createStoredZip(items) {
  const localParts = []
  const centralParts = []
  let localOffset = 0
  for (const item of items) {
    const name = Buffer.from(item.name.replace(/\\/g, '/'), 'utf8')
    const content = Buffer.isBuffer(item.content) ? item.content : Buffer.from(item.content)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0x0800, 6)
    local.writeUInt16LE(0, 8)
    local.writeUInt32LE(0, 10)
    local.writeUInt32LE(0, 14)
    local.writeUInt32LE(content.length, 18)
    local.writeUInt32LE(content.length, 22)
    local.writeUInt16LE(name.length, 26)
    local.writeUInt16LE(0, 28)
    localParts.push(local, name, content)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0x0800, 8)
    central.writeUInt16LE(0, 10)
    central.writeUInt32LE(0, 12)
    central.writeUInt32LE(0, 16)
    central.writeUInt32LE(content.length, 20)
    central.writeUInt32LE(content.length, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt16LE(0, 30)
    central.writeUInt16LE(0, 32)
    central.writeUInt16LE(0, 34)
    central.writeUInt16LE(0, 36)
    central.writeUInt32LE(0, 38)
    central.writeUInt32LE(localOffset, 42)
    centralParts.push(central, name)
    localOffset += local.length + name.length + content.length
  }
  const centralDirectory = Buffer.concat(centralParts)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(0, 4)
  end.writeUInt16LE(0, 6)
  end.writeUInt16LE(items.length, 8)
  end.writeUInt16LE(items.length, 10)
  end.writeUInt32LE(centralDirectory.length, 12)
  end.writeUInt32LE(localOffset, 16)
  end.writeUInt16LE(0, 20)
  return Buffer.concat([...localParts, centralDirectory, end])
}

test('maps every active backend state to the dashboard running state', () => {
  for (const state of ['QUEUED', 'PROFILING', 'WAITING_NETWORK', 'TRANSMITTING', 'VERIFYING', 'CACHED', 'RETRYING']) {
    assert.equal(mapTaskState(state).state, 'RUNNING')
  }
  assert.equal(mapTaskState('COMPLETED').state, 'COMPLETED')
  assert.equal(mapTaskState('FAILED').state, 'FAILED')
  assert.equal(mapTaskState('PAUSED').state, 'PAUSED')
  assert.equal(mapTaskState('CANCELLED').text, '任务已取消')
  assert.equal(mapTaskState(null).state, 'IDLE')
})


test('reset hides the current dashboard task without deleting task history', async () => {
  const bridge = new IntegrationBridge({ receiverUrl: '', backendUrl: 'http://127.0.0.1:1' })
  const task = { id: 'task-reset-hide', fileName: 'demo.csv', state: 'COMPLETED', progressPercent: 100, originalBytes: 1000, compressedBytes: 500 }
  bridge.config.fileId = 'sample.csv'
  bridge.files = async () => [{ id: 'sample.csv', name: 'sample.csv', bytes: 1000, type: 'CSV / 数值时序' }]
  bridge.backend = async (pathname) => {
    if (pathname === '/api/tasks') return [task]
    if (pathname === '/api/tasks/task-reset-hide') return task
    throw new Error('unexpected backend path: ' + pathname)
  }

  assert.equal((await bridge.currentTask()).id, task.id)
  assert.equal((await bridge.resetTransfer()).success, true)
  assert.equal(await bridge.currentTask(), null)
  assert.equal((await bridge.transferTasks())[0].id, task.id)
})

test('reset pushes receiver sync after hiding the current task', async () => {
  const bridge = new IntegrationBridge({ receiverUrl: 'http://receiver.local', backendUrl: 'http://127.0.0.1:1' })
  const task = { id: 'task-reset-sync', fileName: 'demo.csv', state: 'COMPLETED', progressPercent: 100 }
  bridge.backend = async (pathname) => {
    if (pathname === '/api/tasks') return [task]
    if (pathname === '/api/tasks/task-reset-sync') return task
    throw new Error('unexpected backend path: ' + pathname)
  }

  let synced = false
  bridge.pushReceiverTaskSync = async () => { synced = true }

  assert.equal((await bridge.resetTransfer()).success, true)
  assert.equal(bridge.hiddenTaskIds.has(task.id), true)
  assert.equal(synced, true)
})


test('receiver sync omits hidden reset tasks from the pushed task list', async () => {
  const bridge = new IntegrationBridge({ receiverUrl: 'http://receiver.local', backendUrl: 'http://127.0.0.1:1' })
  const hiddenTask = { id: 'task-reset-old', fileName: 'old-smoke.txt', state: 'COMPLETED', progressPercent: 100 }
  const visibleTask = { id: 'task-reset-visible', fileName: 'normal.csv', state: 'QUEUED', progressPercent: 0 }
  bridge.hiddenTaskIds.add(hiddenTask.id)
  bridge.transferTasks = async () => [hiddenTask, visibleTask]
  bridge.transmissionDashboard = async () => ({ task: { id: visibleTask.id }, progress: { value: 0, stages: [] } })

  const originalFetch = globalThis.fetch
  let pushed = null
  globalThis.fetch = async (url, init = {}) => {
    if (String(url) === 'http://receiver.local/api/receiver/task-sync') {
      pushed = JSON.parse(init.body)
      return new Response(JSON.stringify({ code: 0, message: 'success', data: {} }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    }
    return originalFetch(url, init)
  }

  try {
    await bridge.pushReceiverTaskSync()
  } finally {
    globalThis.fetch = originalFetch
  }

  assert.equal(pushed.dashboards.transmission.task.id, visibleTask.id)
  assert.deepEqual(pushed.tasks.map((task) => task.id), [visibleTask.id])
})

test('disconnecting a receiver pauses the current running task', async () => {
  const bridge = new IntegrationBridge({ receiverUrl: 'http://127.0.0.1:8081', backendUrl: 'http://127.0.0.1:1' })
  let paused = false
  bridge.currentTask = async () => ({ id: 'task-disconnect-pause', state: 'TRANSMITTING' })
  bridge.clearReceiverDisplay = async () => {}
  bridge.backend = async (pathname, init = {}) => {
    if (pathname === '/api/tasks/task-disconnect-pause/pause' && init.method === 'POST') {
      paused = true
      return { id: 'task-disconnect-pause', state: 'PAUSED' }
    }
    throw new Error('unexpected backend path: ' + pathname)
  }

  const result = await bridge.disconnectReceiver()
  assert.equal(paused, true)
  assert.equal(result.paused, true)
  assert.equal(bridge.options.receiverUrl, '')
  assert.equal(bridge.remoteDelivery.state, 'disconnected')
})

test('link-loss disconnect keeps the receiver address for automatic recovery', async () => {
  const bridge = new IntegrationBridge({ receiverUrl: 'http://receiver.local', backendUrl: 'http://127.0.0.1:1' })
  bridge.currentTask = async () => null

  const result = await bridge.markReceiverDisconnected('lost', { pauseTask: false })

  assert.equal(result.success, true)
  assert.equal(bridge.options.receiverUrl, 'http://receiver.local')
  assert.equal(bridge.remoteHealth.connected, false)
  assert.equal(bridge.remoteDelivery.target, 'http://receiver.local')
})


test('receiver ignores stale sync payloads that arrive after a newer snapshot', async () => {
  const bridge = new IntegrationBridge({ port: 8081, receiverUrl: '', backendUrl: 'http://127.0.0.1:1' })
  const newer = {
    tasks: [{ id: 'task-new', fileName: 'new.csv', state: 'TRANSMITTING', progressPercent: 55 }],
    dashboards: { transmission: { task: { id: 'task-new' }, progress: { value: 55, stages: [] } }, effect: null, updatedAtMillis: 200 },
    updatedAtMillis: 200
  }
  const older = {
    tasks: [{ id: 'task-old', fileName: 'old.csv', state: 'QUEUED', progressPercent: 1 }],
    dashboards: { transmission: { task: { id: 'task-old' }, progress: { value: 1, stages: [] } }, effect: null, updatedAtMillis: 100 },
    updatedAtMillis: 100
  }

  assert.equal((await bridge.receiveTaskSync([Buffer.from(JSON.stringify(newer))])).success, true)
  const stale = await bridge.receiveTaskSync([Buffer.from(JSON.stringify(older))])

  assert.equal(stale.stale, true)
  assert.equal((await bridge.transferTasks())[0].id, 'task-new')
  assert.equal((await bridge.transmissionDashboard()).task.id, 'task-new')
})

test('receiver transfer task endpoint prefers synced sender queue over local backend tasks', async () => {
  const bridge = new IntegrationBridge({ port: 8081, receiverUrl: '', backendUrl: 'http://127.0.0.1:1' })
  const synced = {
    tasks: [
      { id: 'sender-frame-1', fileName: 'data-frame-00001', state: 'TRANSMITTING', progressPercent: 25, queuedAtMillis: 200 }
    ],
    dashboards: { updatedAtMillis: 1000 },
    updatedAtMillis: 1000
  }
  await bridge.receiveTaskSync([Buffer.from(JSON.stringify(synced))])
  bridge.backend = async (pathname) => {
    if (pathname === '/api/tasks') return []
    throw new Error('unexpected backend path: ' + pathname)
  }

  const tasks = await bridge.transferTasks()

  assert.deepEqual(tasks.map((task) => task.fileName), ['data-frame-00001'])
  assert.equal(tasks[0].progressPercent, 25)
})
test('sender sync compacts chunk-heavy tasks before posting to the receiver', async () => {
  const bridge = new IntegrationBridge({ receiverUrl: 'http://receiver.local', backendUrl: 'http://127.0.0.1:1' })
  const heavyTask = {
    id: 'task-heavy-sync',
    fileName: 'large.csv',
    state: 'TRANSMITTING',
    progressPercent: 64,
    originalBytes: 200_000_000,
    compressedBytes: 50_000_000,
    queuedAtMillis: 300,
    currentDecision: { algorithm: 'ZSTD', level: 3, estimatedCompressedRatio: 0.25, reason: 'ok' },
    chunks: Array.from({ length: 20000 }, (_, index) => ({ chunkIndex: index, originalBytes: 1024, compressedBytes: 256, checksumPassed: true })),
    networkCurve: Array.from({ length: 20000 }, (_, index) => ({ elapsedMillis: index, actualRateKbps: 1000 + index })),
    adjustments: Array.from({ length: 2000 }, (_, index) => ({ elapsedMillis: index, reason: 'adjust' }))
  }
  bridge.transferTasks = async () => [heavyTask]
  bridge.transmissionDashboard = async () => ({ task: { id: heavyTask.id }, progress: { value: 64, stages: [] } })

  const originalFetch = globalThis.fetch
  let pushed = null
  globalThis.fetch = async (url, init = {}) => {
    if (String(url) === 'http://receiver.local/api/receiver/task-sync') {
      pushed = JSON.parse(init.body)
      return new Response(JSON.stringify({ code: 0, message: 'success', data: {} }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    }
    return originalFetch(url, init)
  }

  try {
    await bridge.pushReceiverTaskSync(heavyTask)
  } finally {
    globalThis.fetch = originalFetch
  }

  assert.ok(Buffer.byteLength(JSON.stringify(pushed)) < 1024 * 1024)
  assert.equal(pushed.tasks[0].id, heavyTask.id)
  assert.equal(Object.prototype.hasOwnProperty.call(pushed.tasks[0], 'chunks'), false)
  assert.equal(Object.prototype.hasOwnProperty.call(pushed.tasks[0], 'networkCurve'), false)
  assert.equal(Object.prototype.hasOwnProperty.call(pushed.tasks[0], 'adjustments'), false)
})
test('sender sync keeps the receiver task queue progress aligned with the transmission dashboard', async () => {
  const bridge = new IntegrationBridge({ receiverUrl: 'http://receiver.local', backendUrl: 'http://127.0.0.1:1' })
  const task = { id: 'task-sync-progress', fileName: 'remote.csv', state: 'COMPLETED', progressPercent: 100, queuedAtMillis: 400 }
  bridge.transferTasks = async () => [task]
  bridge.transmissionDashboard = async () => ({ task: { id: task.id, state: 'RUNNING' }, progress: { value: 97.5, stages: [] } })

  const originalFetch = globalThis.fetch
  let pushed = null
  globalThis.fetch = async (url, init = {}) => {
    if (String(url) === 'http://receiver.local/api/receiver/task-sync') {
      pushed = JSON.parse(init.body)
      return new Response(JSON.stringify({ code: 0, message: 'success', data: {} }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    }
    return originalFetch(url, init)
  }

  try {
    await bridge.pushReceiverTaskSync(task)
  } finally {
    globalThis.fetch = originalFetch
  }

  assert.equal(pushed.tasks[0].id, task.id)
  assert.equal(pushed.tasks[0].progressPercent, 97.5)
  assert.equal(pushed.tasks[0].state, 'TRANSMITTING')
})

test('receiver promotes a received package snapshot to complete progress', async () => {
  const bridge = new IntegrationBridge({ port: 8081, receiverUrl: '', backendUrl: 'http://127.0.0.1:1' })
  const pending = {
    tasks: [{ id: 'task-received-final', fileName: 'remote.csv', state: 'TRANSMITTING', progressPercent: 99 }],
    dashboards: {
      transmission: {
        task: { id: 'task-received-final', state: 'RUNNING' },
        progress: { value: 99, state: 'remote delivery', stages: [] },
        route: { status: 'remote delivery' },
        receiver: { chunkCount: 1 }
      },
      effect: null,
      updatedAtMillis: 1000
    },
    updatedAtMillis: 1000
  }

  await bridge.receiveTaskSync([Buffer.from(JSON.stringify(pending))])
  const promoted = bridge.markReceivedTaskComplete({ id: 'task-received-final', fileName: 'remote.csv', state: 'COMPLETED', progressPercent: 100 }, { updatedAtMillis: 1001 })

  assert.equal(promoted, true)
  assert.equal((await bridge.transferTasks())[0].progressPercent, 100)
  assert.equal((await bridge.transferTasks())[0].state, 'COMPLETED')
  const dashboard = await bridge.transmissionDashboard()
  assert.equal(dashboard.progress.value, 100)
  assert.equal(dashboard.task.state, 'COMPLETED')
})
test('receiver accepts final effect sync after local package completion when clocks differ', async () => {
  const bridge = new IntegrationBridge({ port: 8081, receiverUrl: '', backendUrl: 'http://127.0.0.1:1' })
  const taskId = 'task-clock-effect'
  const pending = {
    tasks: [{ id: taskId, fileName: 'clock.csv', state: 'TRANSMITTING', progressPercent: 99 }],
    dashboards: {
      transmission: {
        task: { id: taskId, state: 'RUNNING' },
        progress: { value: 99, state: 'remote delivery', stages: [] },
        route: { status: 'remote delivery' }
      },
      effect: { hasEvaluation: false, taskId, task: { fileName: 'clock.csv' } },
      updatedAtMillis: 1000
    },
    updatedAtMillis: 1000
  }

  await bridge.receiveTaskSync([Buffer.from(JSON.stringify(pending))])
  const originalNow = Date.now
  Date.now = () => 50000
  try {
    assert.equal(bridge.markReceivedTaskComplete({ id: taskId, fileName: 'clock.csv', state: 'COMPLETED', progressPercent: 100 }), true)
  } finally {
    Date.now = originalNow
  }
  assert.equal(bridge.syncedDashboardAtMillis, 1001)

  const finalEffect = { hasEvaluation: true, taskId, comparison: [{ metric: 'total', before: '2 s', after: '1 s' }] }
  const result = await bridge.receiveTaskSync([Buffer.from(JSON.stringify({
    tasks: [{ id: taskId, fileName: 'clock.csv', state: 'COMPLETED', progressPercent: 100 }],
    dashboards: {
      transmission: { task: { id: taskId, state: 'COMPLETED' }, progress: { value: 100, stages: [] } },
      effect: finalEffect,
      updatedAtMillis: 1002
    },
    updatedAtMillis: 1002
  }))])

  assert.notEqual(result.stale, true)
  assert.deepEqual(await bridge.effectDashboard(), finalEffect)
})
test('sender measures remote receiver throughput with a real HTTP probe', async (t) => {
  const receiver = new IntegrationBridge({ port: 8081, receiverUrl: '', backendUrl: 'http://127.0.0.1:1' })
  const server = http.createServer(createRequestHandler(receiver))
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  t.after(() => new Promise((resolve) => server.close(resolve)))

  const address = server.address()
  const sender = new IntegrationBridge({ port: 8080, receiverUrl: `http://127.0.0.1:${address.port}`, backendUrl: 'http://127.0.0.1:1' })
  sender.markReceiverConnected(sender.options.receiverUrl)

  const rate = await sender.measureReceiverThroughput({ force: true })
  assert.ok(rate > 0)
  assert.equal(sender.remoteRateSample.bytes, sender.remoteRateProbeBuffer.length)
  assert.equal(sender.remoteRateSample.throughputKbps, rate)
})

test('remote delivery keeps the dashboard running until the receiver accepts the package', async () => {
  const bridge = new IntegrationBridge({ receiverUrl: 'http://127.0.0.1:8081', backendUrl: 'http://127.0.0.1:1' })
  const task = {
    id: 'task-remote-pending',
    fileName: 'remote.csv',
    state: 'COMPLETED',
    progressPercent: 100,
    originalBytes: 1000,
    compressedBytes: 500,
    integrityPassed: true,
    currentDecision: { algorithm: 'ZSTD', level: 3, estimatedCompressedRatio: 0.5 },
    chunks: [{ compressedBytes: 500, modeledTransferMillis: 10, actualRateKbps: 400 }]
  }
  const fileOption = { id: 'remote.csv', name: 'remote.csv', bytes: 1000, type: 'CSV / 数值时序' }
  const algorithms = [{ id: 'ZSTD', name: 'ZSTD' }]
  const config = { fileId: 'remote.csv', mode: 'AUTO', algorithmId: 'ZSTD', level: '3', priority: '中' }

  bridge.remoteHealth.connected = true
  bridge.remoteDelivery = {
    enabled: true,
    target: bridge.options.receiverUrl,
    state: 'waiting',
    taskId: task.id,
    progress: 0,
    sentBytes: 0,
    totalBytes: 0,
    throughputKbps: 0
  }
  bridge.refreshReceiverLink = async () => true
  bridge.measureReceiverThroughput = async () => 1000
  bridge.baseContext = async () => ({
    files: [fileOption],
    algorithms,
    sources: [{ id: 'sensor-line-01', name: 'sensor', endpoint: 'mqtt://edge-gateway/line1', online: true }],
    task,
    network: { throughputKbps: 800, rttMillis: 10, jitterMillis: 1, packetLossPercent: 0, connectionState: 'CONNECTED', quality: 'GOOD' },
    dashboard: { queueSize: 0 },
    fileOption,
    source: { id: 'sensor-line-01', name: 'sensor', endpoint: 'mqtt://edge-gateway/line1', online: true },
    summary: buildTaskSummary({ task, config, fileOption, algorithms })
  })

  const dashboard = await bridge.transmissionDashboard()
  assert.equal(dashboard.task.state, 'RUNNING')
  assert.equal(dashboard.progress.value, 90)
  assert.equal(dashboard.keyMetrics[1].note, '')
  assert.equal(dashboard.keyMetrics[2].note, '')

  const effect = await bridge.effectDashboard()
  assert.equal(effect.hasEvaluation, false)
})

test('key metrics show real average effective throughput for completed remote delivery', async () => {
  const bridge = new IntegrationBridge({ receiverUrl: 'http://127.0.0.1:8081', backendUrl: 'http://127.0.0.1:1' })
  const task = {
    id: 'task-average-throughput',
    fileName: 'remote.csv',
    state: 'COMPLETED',
    progressPercent: 100,
    originalBytes: 1_000_000,
    compressedBytes: 500_000,
    startedAtMillis: 1_000,
    completedAtMillis: 3_000,
    integrityPassed: true,
    priority: { priority: 'IMPORTANT' },
    currentDecision: { algorithm: 'ZSTD', level: 3, estimatedCompressedRatio: 0.5 }
  }
  const fileOption = { id: 'remote.csv', name: 'remote.csv', bytes: 1_000_000, type: 'CSV / 数据时序' }
  const algorithms = [{ id: 'ZSTD', name: 'ZSTD' }]
  const config = { fileId: 'remote.csv', mode: 'AUTO', algorithmId: 'ZSTD', level: '3', priority: '中' }

  bridge.remoteHealth.connected = true
  bridge.remoteDelivery = {
    enabled: true,
    target: bridge.options.receiverUrl,
    state: 'delivered',
    taskId: task.id,
    progress: 100,
    sentBytes: 1_000_000,
    totalBytes: 1_000_000,
    throughputKbps: 0,
    startedAtMillis: 10_000,
    completedAtMillis: 12_000,
    updatedAtMillis: 12_000
  }
  bridge.refreshReceiverLink = async () => true
  bridge.measureReceiverThroughput = async () => 0
  bridge.baseContext = async () => ({
    files: [fileOption],
    algorithms,
    sources: [{ id: 'sensor-line-01', name: 'sensor', endpoint: 'mqtt://edge-gateway/line1', online: true }],
    task,
    network: { throughputKbps: 800, rttMillis: 10, jitterMillis: 1, packetLossPercent: 0, connectionState: 'CONNECTED', quality: 'GOOD' },
    dashboard: { queueSize: 0 },
    fileOption,
    source: { id: 'sensor-line-01', name: 'sensor', endpoint: 'mqtt://edge-gateway/line1', online: true },
    summary: buildTaskSummary({ task, config, fileOption, algorithms })
  })

  const dashboard = await bridge.transmissionDashboard({ skipReceiverRateProbe: true })
  const metric = dashboard.keyMetrics.find((item) => item.label === '平均有效吞吐率')

  assert.equal(metric.value, '4.00 Mbps')
  assert.equal(dashboard.keyMetrics.some((item) => item.label === '压缩节省率' || item.label === '预计节省率'), false)
})
test('formats byte values for the dashboard contract', () => {
  assert.equal(formatBytes(0), '0 B')
  assert.equal(formatBytes(1024), '1.00 KB')
  assert.equal(formatBytes(1024 ** 2), '1.00 MB')
})

test('defaults to a 5GB upload limit with backend-safe pre-transmission frames', () => {
  const bridge = new IntegrationBridge({ backendUrl: 'http://127.0.0.1:1' })
  assert.equal(bridge.options.uploadLimitBytes, 5 * 1024 * 1024 * 1024)
  assert.equal(bridge.options.preTransmissionFrameBytes, 512 * 1024 * 1024)
  const requested = bridge.preTransmissionFrameBytes(new URL('http://localhost/?frameBytes=9999999999'), { headers: {} })
  assert.equal(requested, 512 * 1024 * 1024)
})

test('chunked upload rejects packages above the configured upload limit', async () => {
  const bridge = new IntegrationBridge({ backendUrl: 'http://127.0.0.1:1', uploadLimitBytes: 10, preTransmissionFrameBytes: 5 })
  await assert.rejects(() => bridge.beginChunkedUpload({
    packageName: 'too-large.bin',
    packageKind: 'FILE',
    files: [{ name: 'too-large.bin', relativePath: 'too-large.bin', size: 11, type: 'application/octet-stream' }]
  }), /10 B/)
})

test('normalizes receiver IP input with the default port', () => {
  assert.deepEqual(normalizeReceiverAddress('192.168.1.30'), {
    address: '192.168.1.30:8081',
    url: 'http://192.168.1.30:8081',
    host: '192.168.1.30',
    port: 8081
  })
  assert.equal(normalizeReceiverAddress('http://192.168.1.30:9090/').address, '192.168.1.30:9090')
  assert.throws(() => normalizeReceiverAddress('999.168.1.30'))
})

test('builds a completed task summary from a real task', () => {
  const summary = buildTaskSummary({
    config: { fileId: 'sample.csv', algorithmId: 'ZSTD', level: '3', priority: '中' },
    fileOption: { name: 'sample.csv', bytes: 1000, type: 'CSV / 数值时序' },
    algorithms: [{ name: 'ZSTD' }],
    task: {
      state: 'COMPLETED',
      fileName: 'sample.csv',
      originalBytes: 1000,
      compressedBytes: 400,
      recognition: { format: 'CSV' },
      priority: { priority: 'IMPORTANT' },
      currentDecision: { algorithm: 'ZSTD', level: 3, estimatedCompressedRatio: 0.4 }
    }
  })

  assert.equal(summary.state, 'COMPLETED')
  assert.equal(summary.algorithmId, 'ZSTD')
  assert.equal(summary.estimatedSaving, '60.00%')
  assert.equal(summary.editable, true)
})

test('parses a browser file upload for the bridge file picker', () => {
  const boundary = '----codex-test-boundary'
  const body = Buffer.from([
    `--${boundary}`,
    'Content-Disposition: form-data; name="file"; filename="demo.csv"',
    'Content-Type: text/csv',
    '',
    'a,b\n1,2',
    `--${boundary}--`,
    ''
  ].join('\r\n'))

  const parsed = parseMultipartBody(body, `multipart/form-data; boundary=${boundary}`)
  assert.equal(parsed.files.length, 1)
  assert.equal(parsed.files[0].filename, 'demo.csv')
  assert.equal(parsed.files[0].content.toString('utf8'), 'a,b\n1,2')
})




test('preserves folder paths for a multi-file package upload', () => {
  const boundary = '----folder-package-boundary'
  const body = Buffer.from([
    `--${boundary}`,
    'Content-Disposition: form-data; name="files"; filename="reports/day1/a.csv"',
    'Content-Type: text/csv',
    '',
    'a,1',
    `--${boundary}`,
    'Content-Disposition: form-data; name="files"; filename="reports/day2/b.csv"',
    'Content-Type: text/csv',
    '',
    'b,2',
    `--${boundary}`,
    'Content-Disposition: form-data; name="packageKind"',
    '',
    'FOLDER',
    `--${boundary}--`,
    ''
  ].join('\r\n'))

  const parsed = parseMultipartBody(body, `multipart/form-data; boundary=${boundary}`)
  assert.equal(parsed.files.length, 2)
  assert.equal(parsed.files[0].filename, 'reports/day1/a.csv')
  assert.equal(parsed.files[1].filename, 'reports/day2/b.csv')
  assert.equal(parsed.fields.packageKind, 'FOLDER')
})


test('folder package upload rejects more than 600 files', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'folder-count-limit-'))
  const bridge = new IntegrationBridge({ uploadsDir: path.join(root, 'uploads'), backendUrl: 'http://127.0.0.1:1' })
  const server = http.createServer(createRequestHandler(bridge))
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  t.after(() => new Promise((resolve) => server.close(resolve)))
  const address = server.address()
  const form = new FormData()
  for (let index = 0; index < 601; index++) {
    form.append('files', new Blob(['x'], { type: 'text/plain' }), `folder/file-${index}.txt`)
  }
  form.append('packageKind', 'FOLDER')

  const payload = await fetch(`http://127.0.0.1:${address.port}/api/transfer/file`, { method: 'POST', body: form }).then((response) => response.json())
  assert.notEqual(payload.code, 0)
  assert.match(payload.message, /600/)
})
test('calculates bounded fit score and trend consistency from transfer points', () => {
  const metrics = calculatePredictionMetrics([
    { actualRateKbps: 100, predictedRateKbps: 90 },
    { actualRateKbps: 200, predictedRateKbps: 240 }
  ])
  assert.equal(metrics.sampleCount, 2)
  assert.equal(Math.round(metrics.fitScorePercent * 100) / 100, 86.67)
  assert.equal(metrics.trendConsistencyPercent, 100)
})

test('returns no prediction metrics before a file transfer creates samples', () => {
  assert.deepEqual(calculatePredictionMetrics([]), {
    sampleCount: 0,
    fitScorePercent: null,
    trendConsistencyPercent: null
  })
})


test('strategy dashboard renders readable prediction health labels', async () => {
  const bridge = new IntegrationBridge({ backendUrl: 'http://127.0.0.1:1' })
  bridge.config = { fileId: 'forecast-file', mode: 'AUTO', algorithmId: 'ZSTD', level: '3', priority: '中' }
  bridge.currentTaskId = 'task-forecast'
  const task = {
    id: 'task-forecast',
    sourceId: 'source-1',
    fileName: 'forecast.bin',
    packageKind: 'FILE',
    state: 'TRANSMITTING',
    progressPercent: 45,
    originalBytes: 1024,
    compressedBytes: 512,
    totalChunks: 4,
    completedChunks: 2,
    currentDecision: { algorithm: 'ZSTD', level: 3, estimatedCompressedRatio: 0.5 },
    priority: { priority: 'NORMAL' },
    networkCurve: [
      { elapsedMillis: 100, actualRateKbps: 1000, predictedRateKbps: 900, safeRateKbps: 800 },
      { elapsedMillis: 200, actualRateKbps: 1200, predictedRateKbps: 1100, safeRateKbps: 900 }
    ]
  }
  bridge.files = async () => [{ id: 'forecast-file', name: 'forecast.bin', bytes: 1024, type: 'BIN / 文件' }]
  bridge.algorithms = async () => [{ id: 'ZSTD', name: 'ZSTD' }]
  bridge.sources = async () => [{ id: 'source-1', name: 'source', endpoint: 'http://source.local:9000', online: true }]
  bridge.backend = async (pathname) => {
    if (pathname === '/api/tasks/task-forecast') return task
    if (pathname === '/api/network/current') return { throughputKbps: 1000, rttMillis: 10, jitterMillis: 1, packetLossPercent: 0, connectionState: 'CONNECTED', quality: 'GOOD' }
    if (pathname === '/api/dashboard') return { queueSize: 1 }
    if (pathname === '/api/network/history?limit=60') return []
    if (pathname === '/api/network/forecast') return { modelName: 'COMPACT_LSTM_MULTISCALE_GUARDED', degraded: true, degradationReason: 'insufficient history' }
    throw new Error('unexpected backend path: ' + pathname)
  }

  const dashboard = await bridge.strategyDashboard()
  const metrics = new Map(dashboard.networkForecast.metrics.map((item) => [item.label, item.value]))
  assert.equal(metrics.get('预测模型'), '长短期记忆网络预测器')
  assert.equal(metrics.get('预测健康'), '保护模式：历史样本不足')
})
test('estimates the uncompressed baseline from each chunk counterfactually', () => {
  const estimated = estimateUncompressedTransferMillis([
    { originalBytes: 1000, compressedBytes: 500, modeledTransferMillis: 80 },
    { originalBytes: 900, compressedBytes: 300, modeledTransferMillis: 120 }
  ], 200, 1900, 800)

  assert.equal(estimated, 520)
})

test('uses the weighted chunk ratio for transfer time not covered by chunk metrics', () => {
  const estimated = estimateUncompressedTransferMillis([
    { originalBytes: 1000, compressedBytes: 500, modeledTransferMillis: 80 }
  ], 100, 1250, 625)

  assert.equal(estimated, 200)
})

test('falls back to the task transfer time when no compression metrics exist', () => {
  assert.equal(estimateUncompressedTransferMillis([], 250, 0, 0), 250)
})


test('never exposes an interrupted label for the current link status', () => {
  assert.deepEqual(linkState({ quality: 'DISCONNECTED', connectionState: 'DISCONNECTED' }), {
    value: '波动',
    tone: 'orange'
  })
  assert.equal(linkState({ quality: '网络中断' }).value.includes('中断'), false)
})


test('receiver display serves synchronized dashboard snapshots without a local backend', async () => {
  const bridge = new IntegrationBridge({
    port: 8081,
    receiverUrl: '',
    backendUrl: 'http://127.0.0.1:1'
  })
  const transmission = { progress: { value: 42, state: '链路传输中', stages: [] }, task: { id: 'task-1' } }
  const effect = { hasEvaluation: true, taskId: 'task-1', comparison: [] }

  assert.equal(bridge.storeSyncedDashboards({ transmission, effect, updatedAtMillis: 100 }), true)
  assert.deepEqual(await bridge.transmissionDashboard(), transmission)
  assert.deepEqual(await bridge.effectDashboard(), effect)

  assert.equal(bridge.storeSyncedDashboards({ transmission: { progress: { value: 1 } }, updatedAtMillis: 99 }), false)
  assert.deepEqual(await bridge.transmissionDashboard(), transmission)
})


test('receiver does not rebuild a stale effect dashboard for a newly synced task', async () => {
  const bridge = new IntegrationBridge({ port: 8081, receiverUrl: '', backendUrl: 'http://127.0.0.1:1' })
  bridge.storeSyncedDashboards({
    transmission: { task: { id: 'old-task' }, progress: { value: 100, stages: [] } },
    effect: { hasEvaluation: true, taskId: 'old-task', comparison: [] },
    updatedAtMillis: 10
  })

  const task = {
    id: 'task-effect-sync',
    fileName: 'effect.csv',
    state: 'COMPLETED',
    progressPercent: 100,
    originalBytes: 1000,
    compressedBytes: 500,
    queuedAtMillis: 100,
    startedAtMillis: 200,
    completedAtMillis: 1200,
    totalCompressionMillis: 12,
    totalTransferMillis: 100,
    totalDecompressionMillis: 8,
    integrityPassed: true,
    currentDecision: { algorithm: 'ZSTD', level: 3, estimatedCompressedRatio: 0.5 },
    completedChunks: 1,
    chunks: [{ originalBytes: 1000, compressedBytes: 500, modeledTransferMillis: 100, actualRateKbps: 400, elapsedMillis: 500 }]
  }
  await bridge.receiveTaskSync([Buffer.from(JSON.stringify({
    tasks: [task],
    dashboards: { transmission: { task: { id: task.id }, progress: { value: 100, stages: [] } }, updatedAtMillis: 20 },
    updatedAtMillis: 20
  }))])

  const effect = await bridge.effectDashboard()
  assert.equal(effect.hasEvaluation, false)
  assert.equal(effect.taskId, task.id)
  assert.equal(effect.task?.fileName, task.fileName)
  assert.notEqual(effect.taskId, 'old-task')
})
test('sender pushes progress and effect snapshots to an independent receiver service', async (t) => {
  const receiver = new IntegrationBridge({ port: 8081, receiverUrl: '', backendUrl: 'http://127.0.0.1:1' })
  const server = http.createServer(createRequestHandler(receiver))
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  t.after(() => new Promise((resolve) => server.close(resolve)))

  const address = server.address()
  const sender = new IntegrationBridge({ port: 8080, receiverUrl: `http://127.0.0.1:${address.port}` })
  const task = { id: 'task-push-1', fileName: 'demo.csv', state: 'COMPLETED', progressPercent: 100 }
  const transmission = { task: { id: task.id }, progress: { value: 100, state: '任务已完成', stages: [] } }
  const effect = { hasEvaluation: true, taskId: task.id, comparison: [{ metric: '总时延', before: '2 s', after: '1 s' }] }

  sender.transferTasks = async () => [task]
  sender.transmissionDashboard = async () => transmission
  sender.effectDashboard = async () => effect

  await sender.pushReceiverTaskSync(task)

  assert.deepEqual(await receiver.transmissionDashboard(), transmission)
  assert.deepEqual(await receiver.effectDashboard(), effect)
  assert.equal((await receiver.transferTasks())[0].id, task.id)
})


test('receiver opens the extracted local file and runtime received folder without downloading again', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'receiver-open-'))
  const receivedDir = path.join(root, 'runtime', 'received')
  await mkdir(receivedDir, { recursive: true })
  const packagePath = path.join(receivedDir, '2026-restored-demo.csv.zip')
  await writeFile(packagePath, createStoredZip([{ name: 'demo.csv', content: 'a,b\n1,2' }]))

  const opened = []
  const bridge = new IntegrationBridge({
    port: 8081,
    receiverUrl: '',
    backendUrl: 'http://127.0.0.1:1',
    receivedDir,
    openPath: async (targetPath) => { opened.push(path.resolve(targetPath)) }
  })
  await bridge.rememberReceivedPackage('task-local-open', packagePath)

  const fileResult = await bridge.openReceivedFile('task-local-open')
  const folderResult = await bridge.openReceivedFolder()

  assert.equal(path.basename(fileResult.savedTo), 'demo.csv')
  assert.equal(await readFile(fileResult.savedTo, 'utf8'), 'a,b\n1,2')
  assert.equal(folderResult.folder, receivedDir)
  assert.deepEqual(opened, [fileResult.savedTo, receivedDir])
  assert.notEqual(fileResult.savedTo, packagePath)
})

test('receiver opens an extracted folder when the package contains multiple files', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'receiver-open-folder-'))
  const receivedDir = path.join(root, 'runtime', 'received')
  await mkdir(receivedDir, { recursive: true })
  const packagePath = path.join(receivedDir, '2026-restored-documents.zip')
  await writeFile(packagePath, createStoredZip([
    { name: 'documents/a.txt', content: 'A' },
    { name: 'documents/b.txt', content: 'B' }
  ]))
  const opened = []
  const bridge = new IntegrationBridge({
    port: 8081, receiverUrl: '', backendUrl: 'http://127.0.0.1:1', receivedDir,
    openPath: async (targetPath) => { opened.push(path.resolve(targetPath)) }
  })
  await bridge.rememberReceivedPackage('task-folder-open', packagePath)
  const result = await bridge.openReceivedFile('task-folder-open')
  assert.equal(path.basename(result.savedTo), 'documents')
  assert.equal((await stat(result.savedTo)).isDirectory(), true)
  assert.equal(await readFile(path.join(result.savedTo, 'a.txt'), 'utf8'), 'A')
  assert.deepEqual(opened, [result.savedTo])
})

test('receiver local-open HTTP endpoints call the extracted receiver computer paths', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'receiver-open-http-'))
  const receivedDir = path.join(root, 'runtime', 'received')
  await mkdir(receivedDir, { recursive: true })
  const packagePath = path.join(receivedDir, '2026-restored-http-demo.zip')
  await writeFile(packagePath, createStoredZip([{ name: 'http-demo.txt', content: 'received' }]))
  const opened = []
  const bridge = new IntegrationBridge({
    port: 8081,
    receiverUrl: '',
    backendUrl: 'http://127.0.0.1:1',
    receivedDir,
    openPath: async (targetPath) => { opened.push(path.resolve(targetPath)) }
  })
  await bridge.rememberReceivedPackage('task-http-open', packagePath)
  const server = http.createServer(createRequestHandler(bridge))
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  t.after(() => new Promise((resolve) => server.close(resolve)))
  const address = server.address()
  const base = `http://127.0.0.1:${address.port}`

  const filePayload = await fetch(base + '/api/receiver/open-file', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ taskId: 'task-http-open' })
  }).then((response) => response.json())
  const folderPayload = await fetch(base + '/api/receiver/open-folder', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}'
  }).then((response) => response.json())

  assert.equal(filePayload.code, 0)
  assert.equal(path.basename(filePayload.data.savedTo), 'http-demo.txt')
  assert.equal(folderPayload.code, 0)
  assert.deepEqual(opened, [filePayload.data.savedTo, receivedDir])
})

test('received package is automatically extracted, indexed by task id, and opened locally after upload', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'receiver-package-index-'))
  const receivedDir = path.join(root, 'runtime', 'received')
  const opened = []
  const bridge = new IntegrationBridge({
    port: 8081,
    receiverUrl: '',
    backendUrl: 'http://127.0.0.1:1',
    receivedDir,
    openPath: async (targetPath) => { opened.push(path.resolve(targetPath)) }
  })
  const server = http.createServer(createRequestHandler(bridge))
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  t.after(() => new Promise((resolve) => server.close(resolve)))
  const address = server.address()
  const base = `http://127.0.0.1:${address.port}`

  const restoredZip = createStoredZip([{ name: 'upload-demo.csv', content: 'name,value\ndemo,1' }])
  const form = new FormData()
  form.append('taskId', 'task-upload-open')
  form.append('taskSnapshot', JSON.stringify({ id: 'task-upload-open', fileName: 'upload-demo.csv', state: 'COMPLETED', progressPercent: 100 }))
  form.append('file', new Blob([restoredZip], { type: 'application/zip' }), 'restored-upload-demo.csv.zip')
  const uploadPayload = await fetch(base + '/api/receiver/package', { method: 'POST', body: form }).then((response) => response.json())
  assert.equal(uploadPayload.code, 0)
  assert.equal(path.basename(uploadPayload.data.openTarget), 'upload-demo.csv')
  assert.equal(await readFile(uploadPayload.data.openTarget, 'utf8'), 'name,value\ndemo,1')

  const openPayload = await fetch(base + '/api/receiver/open-file', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ taskId: 'task-upload-open' })
  }).then((response) => response.json())
  assert.equal(openPayload.code, 0)
  assert.equal(opened.length, 1)
  assert.equal(path.basename(opened[0]), 'upload-demo.csv')
  assert.equal(opened[0].endsWith('.zip'), false)
})


test('receiver task links open the received file and browse extracted contents without contacting sender backend', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'receiver-task-links-'))
  const receivedDir = path.join(root, 'runtime', 'received')
  await mkdir(receivedDir, { recursive: true })
  const packagePath = path.join(receivedDir, '2026-restored-local-demo.zip')
  await writeFile(packagePath, createStoredZip([
    { name: 'local-demo.txt', content: 'opened from receiver runtime' }
  ]))

  const bridge = new IntegrationBridge({
    port: 8081,
    receiverUrl: '',
    backendUrl: 'http://127.0.0.1:1',
    receivedDir
  })
  bridge.storeSyncedTransferTasks([{
    id: 'task-receiver-link',
    fileName: 'local-demo.txt',
    packageKind: 'FILE',
    state: 'COMPLETED',
    progressPercent: 100
  }])
  await bridge.rememberReceivedPackage('task-receiver-link', packagePath)

  const server = http.createServer(createRequestHandler(bridge))
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  t.after(() => new Promise((resolve) => server.close(resolve)))
  const address = server.address()
  const base = `http://127.0.0.1:${address.port}`

  const directFile = await fetch(base + '/api/receiver/tasks/task-receiver-link/content/file')
  assert.equal(directFile.status, 200)
  assert.equal(await directFile.text(), 'opened from receiver runtime')

  const browse = await fetch(base + '/api/receiver/tasks/task-receiver-link/browse')
  assert.equal(browse.status, 200)
  const browseHtml = await browse.text()
  assert.match(browseHtml, /local-demo\.txt/)
  assert.match(browseHtml, /\/api\/receiver\/tasks\/task-receiver-link\/content\/file/)

  // Compatibility path for an older cached receiver page that still uses /api/tasks/...
  const legacyFile = await fetch(base + '/api/tasks/task-receiver-link/content/file')
  assert.equal(legacyFile.status, 200)
  assert.equal(await legacyFile.text(), 'opened from receiver runtime')
})

test('receiver reassembles pre-transmission frames before opening or downloading', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'receiver-pre-frames-'))
  const receivedDir = path.join(root, 'runtime', 'received')
  const opened = []
  const bridge = new IntegrationBridge({
    port: 8081,
    receiverUrl: '',
    backendUrl: 'http://127.0.0.1:1',
    receivedDir,
    openPath: async (targetPath) => { opened.push(path.resolve(targetPath)) }
  })
  const server = http.createServer(createRequestHandler(bridge))
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  t.after(() => new Promise((resolve) => server.close(resolve)))
  const address = server.address()
  const base = `http://127.0.0.1:${address.port}`

  const frameMeta = {
    groupId: 'upload:pre-frame-group',
    packageName: 'large.bin',
    packageKind: 'FILE',
    frameBytes: 5,
    totalBytes: 10,
    frameCount: 2,
    sourceFiles: [{ index: 0, name: 'large.bin', relativePath: 'large.bin', bytes: 10, contentType: 'application/octet-stream' }]
  }
  const sendFrame = async (taskId, frameIndex, content) => {
    const form = new FormData()
    form.append('taskId', taskId)
    form.append('taskSnapshot', JSON.stringify({ id: taskId, fileName: `large.bin-frame-${String(frameIndex).padStart(5, '0')}`, state: 'COMPLETED', progressPercent: 100 }))
    form.append('preTransmissionFrame', JSON.stringify({ ...frameMeta, frameIndex }))
    form.append('file', new Blob([createStoredZip([{ name: `frames/frame-${String(frameIndex).padStart(5, '0')}.bin`, content }])], { type: 'application/zip' }), `restored-frame-${frameIndex}.zip`)
    return fetch(base + '/api/receiver/package', { method: 'POST', body: form }).then((response) => response.json())
  }

  const first = await sendFrame('task-frame-1', 1, 'abcde')
  assert.equal(first.code, 0)
  assert.equal(first.data.preTransmission.completed, false)
  assert.equal(first.data.preTransmission.receivedCount, 1)

  const second = await sendFrame('task-frame-2', 2, 'fghij')
  assert.equal(second.code, 0)
  assert.equal(second.data.preTransmission.completed, true)
  assert.equal(path.basename(second.data.openTarget), 'large.bin')
  assert.equal(await readFile(second.data.openTarget, 'utf8'), 'abcdefghij')

  const openPayload = await fetch(base + '/api/receiver/open-file', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ taskId: 'task-frame-1' })
  }).then((response) => response.json())
  assert.equal(openPayload.code, 0)
  assert.equal(path.basename(opened[0]), 'large.bin')

  const directFile = await fetch(base + '/api/receiver/tasks/task-frame-1/content/file')
  assert.equal(directFile.status, 200)
  assert.equal(await directFile.text(), 'abcdefghij')
})
test('receiver folder browser uses the same open-file and open-folder behavior as strategy analysis', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'receiver-folder-links-'))
  const receivedDir = path.join(root, 'runtime', 'received')
  await mkdir(receivedDir, { recursive: true })
  const packagePath = path.join(receivedDir, '2026-restored-reports.zip')
  await writeFile(packagePath, createStoredZip([
    { name: 'reports/day1/a.txt', content: 'A' },
    { name: 'reports/day2/b.txt', content: 'B' }
  ]))

  const bridge = new IntegrationBridge({
    port: 8081,
    receiverUrl: '',
    backendUrl: 'http://127.0.0.1:1',
    receivedDir
  })
  bridge.storeSyncedTransferTasks([{
    id: 'task-receiver-folder-link',
    fileName: 'reports',
    packageKind: 'FOLDER',
    state: 'COMPLETED',
    progressPercent: 100
  }])
  await bridge.rememberReceivedPackage('task-receiver-folder-link', packagePath)

  const server = http.createServer(createRequestHandler(bridge))
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  t.after(() => new Promise((resolve) => server.close(resolve)))
  const address = server.address()
  const base = `http://127.0.0.1:${address.port}`

  const rootBrowse = await fetch(base + '/api/receiver/tasks/task-receiver-folder-link/browse')
  assert.equal(rootBrowse.status, 200)
  const rootHtml = await rootBrowse.text()
  assert.match(rootHtml, /打开目录/)
  assert.match(rootHtml, /path=reports/)

  const nestedBrowse = await fetch(base + '/api/receiver/tasks/task-receiver-folder-link/browse?path=reports%2Fday1')
  assert.equal(nestedBrowse.status, 200)
  const nestedHtml = await nestedBrowse.text()
  assert.match(nestedHtml, /a\.txt/)
  assert.match(nestedHtml, /打开文件/)

  const nestedFile = await fetch(base + '/api/receiver/tasks/task-receiver-folder-link/content/file?path=reports%2Fday1%2Fa.txt')
  assert.equal(nestedFile.status, 200)
  assert.equal(await nestedFile.text(), 'A')
})
test('api callback ingress stores pre-transmission frames as a selectable package', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'api-ingress-frames-'))
  const bridge = new IntegrationBridge({ uploadsDir: path.join(root, 'uploads'), backendUrl: 'http://127.0.0.1:1', preTransmissionFrameBytes: 4 })
  const server = http.createServer(createRequestHandler(bridge))
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  t.after(() => new Promise((resolve) => server.close(resolve)))
  const address = server.address()
  const base = `http://127.0.0.1:${address.port}`

  const payload = await fetch(`${base}/api/ingress/api-callback?frameBytes=4&packageName=orders.json&protocol=HTTP`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Source-Name': 'OrderService' },
    body: 'abcdefghij'
  }).then((response) => response.json())

  assert.equal(payload.code, 0)
  assert.equal(payload.data.ingress.ingressMode, 'API_CALLBACK')
  assert.equal(payload.data.ingress.sourceProtocol, 'HTTP')
  assert.equal(payload.data.ingress.sourceName, 'OrderService')
  assert.equal(payload.data.ingress.frameCount, 3)
  assert.equal(payload.data.ingress.totalBytes, 10)
  assert.equal(payload.data.file.type, '预传输帧数据包')
  assert.equal(payload.data.file.preTransmission.frameCount, 3)

  const stored = bridge.uploads.get(payload.data.file.id)
  assert.equal(stored.files.filter((item) => item.relativePath.startsWith('frames/')).length, 3)
  assert.equal(await readFile(stored.files[0].absolutePath, 'utf8'), 'abcd')
  assert.equal(await readFile(stored.files[1].absolutePath, 'utf8'), 'efgh')
  assert.equal(await readFile(stored.files[2].absolutePath, 'utf8'), 'ij')

  assert.equal(bridge.config.fileId, payload.data.file.id)
})

test('message queue ingress requires RabbitMQ instead of falling back to HTTP simulation', async (t) => {
  const bridge = new IntegrationBridge({ backendUrl: 'http://127.0.0.1:1', receiverUrl: '', rabbitmqUrl: 'amqp://127.0.0.1:1' })
  const server = http.createServer(createRequestHandler(bridge))
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  t.after(() => new Promise((resolve) => server.close(resolve)))
  const address = server.address()
  const base = `http://127.0.0.1:${address.port}`

  const payload = await fetch(`${base}/api/ingress/message-queue?frameBytes=6&packageName=topic.bin`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/octet-stream',
      'X-Source-Protocol': 'RabbitMQ',
      'X-Topic': 'business.realtime',
      'X-Message-Id': 'mq-message-1'
    },
    body: 'abcdefghijklmn'
  }).then((response) => response.json())

  assert.equal(payload.code, 1)
  assert.match(payload.message, /RabbitMQ未连接/)
})
test('start transfer submits pre-transmission frames as separate backend tasks', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'pre-transfer-submit-'))
  const frameDir = path.join(root, 'frames')
  await mkdir(frameDir, { recursive: true })
  const frame1 = path.join(frameDir, 'frame-00001.bin')
  const frame2 = path.join(frameDir, 'frame-00002.bin')
  await writeFile(frame1, 'first-frame')
  await writeFile(frame2, 'second-frame')

  const bridge = new IntegrationBridge({ backendUrl: 'http://127.0.0.1:1', receiverUrl: '' })
  bridge.config = { fileId: 'pre-frame-package', mode: 'AUTO', algorithmId: 'ZSTD', level: '3', priority: '中' }
  bridge.currentTask = async () => null
  bridge.files = async () => [{
    id: 'pre-frame-package',
    name: 'stream.bin',
    bytes: 22,
    type: '预传输帧数据包',
    packageKind: 'FOLDER',
    preTransmission: { enabled: true, mode: 'API_CALLBACK', frameBytes: 10, totalBytes: 22, frameCount: 2 },
    files: [
      { absolutePath: frame1, relativePath: 'frames/frame-00001.bin', contentType: 'application/octet-stream', bytes: 11 },
      { absolutePath: frame2, relativePath: 'frames/frame-00002.bin', contentType: 'application/octet-stream', bytes: 12 },
      { absolutePath: path.join(root, 'manifest.json'), relativePath: 'manifest.json', contentType: 'application/json', bytes: 2 }
    ]
  }]
  bridge.algorithms = async () => [{ id: 'ZSTD', name: 'ZSTD' }]
  bridge.sources = async () => [{ id: 'source-1', name: 'source', online: true, businessScene: '综合监测' }]
  let queuedGroupTaskId = null
  bridge.queuePreTransmissionGroupDelivery = (taskId) => { queuedGroupTaskId = taskId }
  bridge.pushReceiverTaskSync = async () => false

  const submissions = []
  bridge.backend = async (pathname, init = {}) => {
    assert.equal(pathname, '/api/tasks')
    const form = init.body
    submissions.push({ packageName: form.get('packageName'), packageKind: form.get('packageKind') })
    return { id: `task-${submissions.length}`, fileName: form.get('packageName'), state: 'RUNNING', progressPercent: 0 }
  }

  const result = await bridge.startTransfer()
  assert.equal(result.success, true)
  assert.equal(result.running, true)
  assert.match(result.message, /2 帧/)
  assert.deepEqual(submissions, [
    { packageName: 'stream.bin-frame-00001', packageKind: 'FILE' },
    { packageName: 'stream.bin-frame-00002', packageKind: 'FILE' }
  ])
  assert.equal(bridge.currentTaskId, 'task-1')
  assert.equal(queuedGroupTaskId, 'task-1')
  assert.deepEqual(bridge.preTransmissionDeliveries.get('task-1').taskIds, ['task-1', 'task-2'])
})
test('pre-transmission frame task names follow package frame naming', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'pre-transfer-source-names-'))
  const frameDir = path.join(root, 'frames')
  await mkdir(frameDir, { recursive: true })
  const frame1 = path.join(frameDir, 'frame-00001.bin')
  const frame2 = path.join(frameDir, 'frame-00002.bin')
  const manifestPath = path.join(root, 'manifest.json')
  await writeFile(frame1, 'aaaaa')
  await writeFile(frame2, 'bbbbb')
  await writeFile(manifestPath, JSON.stringify({
    packageName: 'data',
    packageKind: 'FOLDER',
    ingressMode: 'MESSAGE_QUEUE_STREAM',
    frameBytes: 5,
    totalBytes: 10,
    frameCount: 2,
    sourceFiles: [
      { index: 0, name: 'sensor-a.txt', relativePath: 'data/sensor-a.txt', bytes: 5, contentType: 'text/plain' },
      { index: 1, name: 'sensor-b.csv', relativePath: 'data/sensor-b.csv', bytes: 5, contentType: 'text/csv' }
    ],
    frames: [
      { index: 1, name: 'frames/frame-00001.bin', bytes: 5, last: false },
      { index: 2, name: 'frames/frame-00002.bin', bytes: 5, last: true }
    ]
  }))

  const bridge = new IntegrationBridge({ backendUrl: 'http://127.0.0.1:1', receiverUrl: '' })
  bridge.config = { fileId: 'pre-frame-package', mode: 'AUTO', algorithmId: 'ZSTD', level: '3', priority: '中' }
  bridge.currentTask = async () => null
  bridge.files = async () => [{
    id: 'pre-frame-package',
    name: 'data',
    bytes: 10,
    type: '预传输帧数据包',
    packageKind: 'FOLDER',
    preTransmission: { enabled: true, mode: 'MESSAGE_QUEUE_STREAM', frameBytes: 5, totalBytes: 10, frameCount: 2 },
    files: [
      { absolutePath: frame1, relativePath: 'frames/frame-00001.bin', contentType: 'application/octet-stream', bytes: 5 },
      { absolutePath: frame2, relativePath: 'frames/frame-00002.bin', contentType: 'application/octet-stream', bytes: 5 },
      { absolutePath: manifestPath, relativePath: 'manifest.json', contentType: 'application/json', bytes: 2 }
    ]
  }]
  bridge.algorithms = async () => [{ id: 'ZSTD', name: 'ZSTD' }]
  bridge.sources = async () => [{ id: 'source-1', name: 'source', online: true, businessScene: '综合监测' }]
  bridge.queuePreTransmissionGroupDelivery = () => {}
  bridge.pushReceiverTaskSync = async () => false

  const submissions = []
  bridge.backend = async (_pathname, init = {}) => {
    const form = init.body
    submissions.push({ packageName: form.get('packageName'), packageKind: form.get('packageKind') })
    return { id: `source-task-${submissions.length}`, fileName: form.get('packageName'), state: 'QUEUED', progressPercent: 0 }
  }

  await bridge.startTransfer()
  assert.deepEqual(submissions, [
    { packageName: 'data-frame-00001', packageKind: 'FILE' },
    { packageName: 'data-frame-00002', packageKind: 'FILE' }
  ])
})
test('pre-transmission group progress feeds sender dashboard and receiver sync', async () => {
  const bridge = new IntegrationBridge({ receiverUrl: 'http://receiver.local', backendUrl: 'http://127.0.0.1:1' })
  bridge.config = { fileId: 'pre-frame-group', mode: 'AUTO', algorithmId: 'ZSTD', level: '3', priority: '中' }
  bridge.currentTaskId = 'task-1'
  bridge.remoteHealth.connected = true
  bridge.refreshReceiverLink = async () => true
  bridge.measureReceiverThroughput = async () => 0

  const taskIds = ['task-1', 'task-2']
  const frameInfo = {
    groupId: 'pre-frame-group',
    packageName: 'stream.bin',
    packageKind: 'FILE',
    mode: 'API_CALLBACK',
    frameBytes: 11,
    totalBytes: 22,
    frameCount: 2,
    sourceFiles: [{ index: 0, name: 'stream.bin', relativePath: 'stream.bin', bytes: 22, contentType: 'application/octet-stream' }],
    frames: [
      { index: 1, name: 'frames/frame-00001.bin', bytes: 11, last: false },
      { index: 2, name: 'frames/frame-00002.bin', bytes: 11, last: true }
    ],
    taskIds
  }
  bridge.preTransmissionDeliveries.set('task-1', { ...frameInfo, frameIndex: 1, framePath: 'frames/frame-00001.bin', frameSize: 11 })
  bridge.preTransmissionDeliveries.set('task-2', { ...frameInfo, frameIndex: 2, framePath: 'frames/frame-00002.bin', frameSize: 11 })

  const tasks = [
    {
      id: 'task-1',
      sourceId: 'source-1',
      fileName: 'stream.bin-frame-00001',
      packageKind: 'FILE',
      state: 'COMPLETED',
      progressPercent: 100,
      originalBytes: 11,
      compressedBytes: 8,
      queuedAtMillis: 10,
      startedAtMillis: 11,
      completedAtMillis: 12,
      totalChunks: 1,
      completedChunks: 1,
      integrityPassed: true,
      currentDecision: { algorithm: 'ZSTD', level: 3, estimatedCompressedRatio: 0.5 },
      priority: { priority: 'NORMAL' }
    },
    {
      id: 'task-2',
      sourceId: 'source-1',
      fileName: 'stream.bin-frame-00002',
      packageKind: 'FILE',
      state: 'QUEUED',
      progressPercent: 0,
      originalBytes: 11,
      compressedBytes: 0,
      queuedAtMillis: 13,
      totalChunks: 1,
      completedChunks: 0,
      currentDecision: { algorithm: 'ZSTD', level: 3, estimatedCompressedRatio: 0.5 },
      priority: { priority: 'NORMAL' }
    }
  ]
  bridge.files = async () => [{ id: 'pre-frame-group', name: 'stream.bin', bytes: 22, type: 'BIN / 文件' }]
  bridge.algorithms = async () => [{ id: 'ZSTD', name: 'ZSTD' }]
  bridge.sources = async () => [{ id: 'source-1', name: 'source', endpoint: 'http://source.local:9000', online: true }]
  bridge.backend = async (pathname) => {
    if (pathname === '/api/tasks') return tasks
    if (pathname === '/api/network/current') return { throughputKbps: 1000, rttMillis: 10, jitterMillis: 1, packetLossPercent: 0, connectionState: 'CONNECTED', quality: 'GOOD' }
    if (pathname === '/api/dashboard') return { queueSize: tasks.length }
    throw new Error('unexpected backend path: ' + pathname)
  }

  const senderQueue = await bridge.transferTasks()
  assert.deepEqual(senderQueue.map((task) => task.id), ['task-2', 'task-1'])
  assert.deepEqual(senderQueue.map((task) => task.fileName), ['stream.bin-frame-00002', 'stream.bin-frame-00001'])
  const senderPrimary = senderQueue.find((task) => task.id === 'task-1')
  assert.equal(senderPrimary.fileName, 'stream.bin-frame-00001')
  assert.equal(senderPrimary.progressPercent, 100)
  assert.equal(senderPrimary.state, 'COMPLETED')
  const dashboard = await bridge.transmissionDashboard({ skipReceiverRefresh: true, skipReceiverRateProbe: true })
  assert.equal(dashboard.progress.value, 50)
  assert.equal(dashboard.progress.chunkProgress, '1 / 2')
  assert.equal(dashboard.sender.fileName, 'stream.bin')
  assert.equal(dashboard.task.state, 'RUNNING')

  const originalFetch = globalThis.fetch
  let pushed = null
  globalThis.fetch = async (url, init = {}) => {
    if (String(url) === 'http://receiver.local/api/receiver/task-sync') {
      pushed = JSON.parse(init.body)
      return new Response(JSON.stringify({ code: 0, message: 'success', data: {} }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    }
    return originalFetch(url, init)
  }

  try {
    await bridge.pushReceiverTaskSync()
  } finally {
    globalThis.fetch = originalFetch
  }

  assert.equal(pushed.taskId, 'task-1')
  assert.equal(pushed.dashboards.transmission.progress.value, 50)
  assert.deepEqual(pushed.tasks.map((task) => task.id), senderQueue.map((task) => task.id))
  assert.deepEqual(pushed.tasks.map((task) => task.fileName), senderQueue.map((task) => task.fileName))
  const syncedPrimary = pushed.tasks.find((task) => task.id === 'task-1')
  assert.equal(syncedPrimary.progressPercent, senderPrimary.progressPercent)
  assert.equal(syncedPrimary.state, senderPrimary.state)
})

test('pre-transmission dashboard uses actual frame metadata for frame progress', async () => {
  const bridge = new IntegrationBridge({ backendUrl: 'http://127.0.0.1:1' })
  bridge.config = { fileId: 'pre-frame-file', mode: 'AUTO', algorithmId: 'ZSTD', level: '3', priority: '中' }
  bridge.currentTaskId = 'task-pre-frame-metadata'
  const task = {
    id: 'task-pre-frame-metadata',
    sourceId: 'source-1',
    fileName: 'data',
    packageKind: 'FILE',
    state: 'RUNNING',
    progressPercent: 40,
    originalBytes: 8000,
    compressedBytes: 4000,
    totalChunks: 80,
    completedChunks: 4,
    preTransmission: { enabled: true, frameCount: 5, completedFrameCount: 2 },
    chunks: Array.from({ length: 4 }, (_, index) => ({ index, originalBytes: 100, compressedBytes: 50 })),
    currentDecision: { algorithm: 'ZSTD', level: 3, estimatedCompressedRatio: 0.5 },
    priority: { priority: 'NORMAL' }
  }
  bridge.files = async () => [{ id: 'pre-frame-file', name: 'data', bytes: 8000, type: '预传输帧数据包' }]
  bridge.algorithms = async () => [{ id: 'ZSTD', name: 'ZSTD' }]
  bridge.sources = async () => [{ id: 'source-1', name: 'source', endpoint: 'http://source.local:9000', online: true }]
  bridge.backend = async (pathname) => {
    if (pathname === '/api/tasks/task-pre-frame-metadata') return task
    if (pathname === '/api/network/current') return { throughputKbps: 1000, rttMillis: 10, jitterMillis: 1, packetLossPercent: 0, connectionState: 'CONNECTED', quality: 'GOOD' }
    if (pathname === '/api/dashboard') return { queueSize: 1 }
    throw new Error('unexpected backend path: ' + pathname)
  }

  const dashboard = await bridge.transmissionDashboard({ skipReceiverRefresh: true, skipReceiverRateProbe: true })
  assert.equal(dashboard.progress.chunkProgress, '2 / 5')
  assert.equal(dashboard.receiver.chunkCount, 5)
})
test('completed dashboard reports actual chunk count when backend total count lags', async () => {
  const bridge = new IntegrationBridge({ backendUrl: 'http://127.0.0.1:1' })
  bridge.config = { fileId: 'chunk-file', mode: 'AUTO', algorithmId: 'ZSTD', level: '3', priority: '中' }
  bridge.currentTaskId = 'task-stale-chunks'
  const task = {
    id: 'task-stale-chunks',
    sourceId: 'source-1',
    fileName: 'chunks.bin',
    packageKind: 'FILE',
    state: 'COMPLETED',
    progressPercent: 100,
    originalBytes: 8000,
    compressedBytes: 4000,
    totalChunks: 80,
    completedChunks: 4,
    integrityPassed: true,
    currentDecision: { algorithm: 'ZSTD', level: 3, estimatedCompressedRatio: 0.5 },
    priority: { priority: 'NORMAL' },
    chunks: Array.from({ length: 4 }, (_, index) => ({ index, originalBytes: 100, compressedBytes: 50 }))
  }
  bridge.files = async () => [{ id: 'chunk-file', name: 'chunks.bin', bytes: 8000, type: 'BIN / 文件' }]
  bridge.algorithms = async () => [{ id: 'ZSTD', name: 'ZSTD' }]
  bridge.sources = async () => [{ id: 'source-1', name: 'source', endpoint: 'http://source.local:9000', online: true }]
  bridge.backend = async (pathname) => {
    if (pathname === '/api/tasks/task-stale-chunks') return task
    if (pathname === '/api/network/current') return { throughputKbps: 1000, rttMillis: 10, jitterMillis: 1, packetLossPercent: 0, connectionState: 'CONNECTED', quality: 'GOOD' }
    if (pathname === '/api/dashboard') return { queueSize: 0 }
    throw new Error('unexpected backend path: ' + pathname)
  }

  const dashboard = await bridge.transmissionDashboard({ skipReceiverRefresh: true, skipReceiverRateProbe: true })
  assert.equal(dashboard.progress.value, 100)
  assert.equal(dashboard.progress.chunkProgress, '4 / 4')
})
test('pre-transmission group delivery serializes frames under the primary task', async () => {
  const bridge = new IntegrationBridge({ receiverUrl: 'http://receiver.local', backendUrl: 'http://127.0.0.1:1' })
  const taskIds = ['task-1', 'task-2']
  const frameInfo = {
    groupId: 'pre-frame-group',
    packageName: 'stream.bin',
    packageKind: 'FILE',
    frameBytes: 11,
    totalBytes: 22,
    frameCount: 2,
    sourceFiles: [],
    frames: [
      { index: 1, name: 'frames/frame-00001.bin', bytes: 11, last: false },
      { index: 2, name: 'frames/frame-00002.bin', bytes: 11, last: true }
    ],
    taskIds
  }
  bridge.preTransmissionDeliveries.set('task-1', { ...frameInfo, frameIndex: 1, framePath: 'frames/frame-00001.bin', frameSize: 11 })
  bridge.preTransmissionDeliveries.set('task-2', { ...frameInfo, frameIndex: 2, framePath: 'frames/frame-00002.bin', frameSize: 11 })
  const completedTasks = new Map(taskIds.map((taskId) => [taskId, { id: taskId, fileName: `${taskId}.bin`, packageKind: 'FILE', state: 'COMPLETED', progressPercent: 100 }]))
  bridge.backend = async (pathname) => {
    const match = String(pathname).match(/^\/api\/tasks\/([^/]+)$/)
    if (match) return completedTasks.get(decodeURIComponent(match[1]))
    throw new Error('unexpected backend path: ' + pathname)
  }
  bridge.pushReceiverTaskSync = async () => false
  const deliveries = []
  bridge.deliverRestoredPackage = async (task, options = {}) => {
    deliveries.push({ taskId: task.id, options })
    bridge.remoteDelivery = {
      enabled: true,
      target: bridge.options.receiverUrl,
      state: options.final ? 'delivered' : 'sending',
      taskId: options.remoteTaskId,
      progress: options.final ? 100 : options.progressEnd
    }
  }

  await bridge.watchPreTransmissionGroupDelivery('task-1')

  assert.deepEqual(deliveries.map((item) => item.taskId), ['task-1', 'task-2'])
  assert.deepEqual(deliveries.map((item) => item.options.remoteTaskId), ['task-1', 'task-1'])
  assert.deepEqual(deliveries.map((item) => item.options.final), [false, true])
  assert.deepEqual(deliveries.map((item) => [item.options.progressStart, item.options.progressEnd]), [[0, 50], [50, 100]])
  assert.equal(bridge.remoteDelivery.state, 'delivered')
  assert.equal(bridge.remoteDelivery.taskId, 'task-1')
})
test('sender task content reassembles pre-transmission backend frames before download', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'sender-pre-frame-download-'))
  const framePayloads = new Map([
    ['task-frame-1', 'abcde'],
    ['task-frame-2', 'fghij']
  ])
  const backend = http.createServer((request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1')
    const downloadMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)\/download\/restored$/)
    if (downloadMatch) {
      const taskId = decodeURIComponent(downloadMatch[1])
      const content = framePayloads.get(taskId)
      if (!content) { response.writeHead(404); response.end(); return }
      const frameIndex = taskId.endsWith('2') ? 2 : 1
      const payload = createStoredZip([{ name: `frames/frame-${String(frameIndex).padStart(5, '0')}.bin`, content }])
      response.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Length': payload.length })
      response.end(payload)
      return
    }
    const taskMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)$/)
    if (taskMatch) {
      const taskId = decodeURIComponent(taskMatch[1])
      response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
      response.end(JSON.stringify({ id: taskId, fileName: `${taskId}.bin`, packageKind: 'FILE', state: 'COMPLETED', progressPercent: 100 }))
      return
    }
    response.writeHead(404)
    response.end()
  })
  await new Promise((resolve, reject) => {
    backend.once('error', reject)
    backend.listen(0, '127.0.0.1', resolve)
  })
  t.after(() => new Promise((resolve) => backend.close(resolve)))
  const backendAddress = backend.address()
  const backendUrl = `http://127.0.0.1:${backendAddress.port}`

  const bridge = new IntegrationBridge({ backendUrl, receivedDir: path.join(root, 'runtime', 'received') })
  const taskIds = ['task-frame-1', 'task-frame-2']
  const frameMeta = {
    groupId: 'upload:sender-pre-frame-group',
    packageName: 'large.bin',
    packageKind: 'FILE',
    frameBytes: 5,
    totalBytes: 10,
    frameCount: 2,
    taskIds,
    sourceFiles: [{ index: 0, name: 'large.bin', relativePath: 'large.bin', bytes: 10, contentType: 'application/octet-stream' }]
  }
  bridge.preTransmissionDeliveries.set('task-frame-1', { ...frameMeta, frameIndex: 1 })
  bridge.preTransmissionDeliveries.set('task-frame-2', { ...frameMeta, frameIndex: 2 })

  const server = http.createServer(createRequestHandler(bridge))
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  t.after(() => new Promise((resolve) => server.close(resolve)))
  const address = server.address()
  const base = `http://127.0.0.1:${address.port}`

  const directFile = await fetch(base + '/api/tasks/task-frame-1/content/file')
  assert.equal(directFile.status, 200)
  assert.equal(await directFile.text(), 'abcdefghij')
})
test('local chunked upload stores oversized files as pre-transmission frames', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'local-chunked-upload-'))
  const bridge = new IntegrationBridge({ uploadsDir: path.join(root, 'uploads'), backendUrl: 'http://127.0.0.1:1', preTransmissionFrameBytes: 5, localUploadChunkBytes: 4 })
  const server = http.createServer(createRequestHandler(bridge))
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  t.after(() => new Promise((resolve) => server.close(resolve)))
  const address = server.address()
  const base = `http://127.0.0.1:${address.port}`

  const startPayload = await fetch(`${base}/api/transfer/chunked/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      packageName: 'large.bin',
      packageKind: 'FILE',
      files: [{ name: 'large.bin', relativePath: 'large.bin', size: 12, type: 'application/octet-stream' }]
    })
  }).then((response) => response.json())
  assert.equal(startPayload.code, 0)
  assert.equal(startPayload.data.chunkBytes, 1024 * 1024)

  const uploadId = startPayload.data.uploadId
  for (const [offset, chunk] of [[0, 'abcd'], [4, 'efgh'], [8, 'ijkl']]) {
    const chunkPayload = await fetch(`${base}/api/transfer/chunked/chunk`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/octet-stream',
        'X-Upload-Id': uploadId,
        'X-File-Index': '0',
        'X-File-Offset': String(offset)
      },
      body: chunk
    }).then((response) => response.json())
    assert.equal(chunkPayload.code, 0)
  }

  const completePayload = await fetch(`${base}/api/transfer/chunked/complete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ uploadId })
  }).then((response) => response.json())

  assert.equal(completePayload.code, 0)
  assert.equal(completePayload.data.ingress.ingressMode, 'LOCAL_FILE_UPLOAD')
  assert.equal(completePayload.data.ingress.frameCount, 3)
  assert.equal(completePayload.data.file.preTransmission.frameCount, 3)
  assert.equal(bridge.config.fileId, uploadId)

  const stored = bridge.uploads.get(uploadId)
  assert.equal(stored.files.filter((item) => item.relativePath.startsWith('frames/')).length, 3)
  assert.equal(await readFile(stored.files[0].absolutePath, 'utf8'), 'abcde')
  assert.equal(await readFile(stored.files[1].absolutePath, 'utf8'), 'fghij')
  assert.equal(await readFile(stored.files[2].absolutePath, 'utf8'), 'kl')
})


function createMockRabbitMqClient() {
  const published = []
  const acks = []
  const nacks = []
  let consumer = null
  let chain = Promise.resolve()

  const producerChannel = {
    assertQueue: async () => {},
    sendToQueue(queue, content, options, callback) {
      const message = { queue, content: Buffer.from(content), properties: options || {} }
      published.push(message)
      chain = chain.then(async () => {
        callback?.(null)
        if (consumer) await consumer(message)
      })
      return true
    }
  }

  const consumerChannel = {
    assertQueue: async () => {},
    prefetch: async () => {},
    consume: async (_queue, handler) => {
      consumer = handler
      return { consumerTag: 'mock-consumer' }
    },
    ack: (message) => { acks.push(message) },
    nack: (message) => { nacks.push(message) }
  }

  return {
    published,
    acks,
    nacks,
    client: {
      connect: async () => ({
        on: () => {},
        createConfirmChannel: async () => producerChannel,
        createChannel: async () => consumerChannel
      })
    }
  }
}

test('rabbitmq ingress publishes persistent chunks, consumes them and ACKs before registering the package', async () => {
  const uploadsDir = await mkdtemp(path.join(tmpdir(), 'rabbitmq-ingress-'))
  const mock = createMockRabbitMqClient()
  const bridge = new IntegrationBridge({
    uploadsDir,
    backendUrl: 'http://127.0.0.1:1',
    amqpClient: mock.client,
    rabbitmqUrl: 'amqp://guest:guest@127.0.0.1:5672',
    rabbitmqQueue: 'datacompress.message.queue',
    rabbitmqChunkBytes: 64 * 1024,
    preTransmissionFrameBytes: 16 * 1024
  })

  const status = await bridge.rabbitMqStatus()
  assert.equal(status.connected, true)
  assert.equal(status.queue, 'datacompress.message.queue')

  const content = Buffer.alloc(70 * 1024, 0x61)
  const started = await bridge.beginRabbitMqIngest({
    packageName: 'rabbit-source.txt',
    files: [{ name: 'rabbit-source.txt', relativePath: 'rabbit-source.txt', size: content.length, type: 'text/plain' }]
  })

  await bridge.appendRabbitMqChunk(Object.assign([content.subarray(0, 10 * 1024), content.subarray(10 * 1024)], {
    headers: {
      'x-upload-id': started.uploadId,
      'x-file-offset': '0',
      'content-length': String(content.length),
      'content-type': 'text/plain'
    }
  }))
  const result = await bridge.completeRabbitMqIngest({ uploadId: started.uploadId, totalBytes: content.length })
  await new Promise((resolve) => setImmediate(resolve))

  assert.equal(result.ingress.ingressMode, 'MESSAGE_QUEUE_STREAM')
  assert.equal(result.ingress.sourceProtocol, 'RabbitMQ')
  assert.equal(result.ingress.topic, 'datacompress.message.queue')
  assert.equal(result.file.preTransmission.mode, 'MESSAGE_QUEUE_STREAM')
  assert.equal(result.file.preTransmission.sourceProtocol, 'RabbitMQ')

  assert.equal(mock.published.length, 4)
  assert.equal(mock.acks.length, 4)
  assert.equal(mock.nacks.length, 0)
  assert.deepEqual(mock.published.map((message) => message.properties.headers.type), ['start', 'chunk', 'chunk', 'complete'])
  assert.deepEqual(mock.published.filter((message) => message.properties.headers.type === 'chunk').map((message) => message.properties.headers.offset), [0, 10 * 1024])
  assert.ok(mock.published.every((message) => message.properties.persistent === true))

  const stored = bridge.uploads.get(started.uploadId)
  const manifestFile = stored.files.find((item) => item.relativePath === 'manifest.json')
  const manifest = JSON.parse(await readFile(manifestFile.absolutePath, 'utf8'))
  assert.equal(manifest.ingressMode, 'MESSAGE_QUEUE_STREAM')
  assert.equal(manifest.sourceProtocol, 'RabbitMQ')
  assert.equal(manifest.totalBytes, content.length)
  assert.equal(manifest.frames.length, Math.ceil(content.length / (16 * 1024)))

  const finalStatus = await bridge.rabbitMqStatus()
  assert.equal(finalStatus.publishedMessages, 4)
  assert.equal(finalStatus.consumedMessages, 4)
  assert.equal(finalStatus.ackedMessages, 4)
})

test('rabbitmq ingress accepts folder files and preserves source paths', async () => {
  const uploadsDir = await mkdtemp(path.join(tmpdir(), 'rabbitmq-folder-ingress-'))
  const mock = createMockRabbitMqClient()
  const bridge = new IntegrationBridge({
    uploadsDir,
    backendUrl: 'http://127.0.0.1:1',
    amqpClient: mock.client,
    rabbitmqUrl: 'amqp://guest:guest@127.0.0.1:5672',
    rabbitmqQueue: 'datacompress.message.queue',
    rabbitmqChunkBytes: 64 * 1024,
    preTransmissionFrameBytes: 5
  })

  const files = [
    { name: 'a.txt', relativePath: 'monitoring-folder/a.txt', type: 'text/plain', content: Buffer.from('alpha') },
    { name: 'b.csv', relativePath: 'monitoring-folder/nested/b.csv', type: 'text/csv', content: Buffer.from('beta!') }
  ]
  const totalBytes = files.reduce((sum, file) => sum + file.content.length, 0)
  const started = await bridge.beginRabbitMqIngest({
    packageName: 'monitoring-folder',
    packageKind: 'FOLDER',
    files: files.map((file) => ({
      name: file.name,
      relativePath: file.relativePath,
      size: file.content.length,
      type: file.type
    }))
  })

  for (const [fileIndex, file] of files.entries()) {
    await bridge.appendRabbitMqChunk(Object.assign([file.content], {
      headers: {
        'x-upload-id': started.uploadId,
        'x-file-index': String(fileIndex),
        'x-file-offset': '0',
        'content-length': String(file.content.length),
        'content-type': file.type
      }
    }))
  }

  const result = await bridge.completeRabbitMqIngest({ uploadId: started.uploadId, totalBytes })
  await new Promise((resolve) => setImmediate(resolve))

  assert.equal(result.ingress.packageName, 'monitoring-folder')
  assert.equal(result.ingress.packageKind, 'FOLDER')
  assert.equal(result.ingress.originalFileCount, 2)
  assert.deepEqual(result.ingress.sourceFiles.map((file) => file.relativePath), ['monitoring-folder/a.txt', 'monitoring-folder/nested/b.csv'])
  assert.deepEqual(mock.published.filter((message) => message.properties.headers.type === 'chunk').map((message) => message.properties.headers.fileIndex), [0, 1])

  const stored = bridge.uploads.get(started.uploadId)
  const manifestFile = stored.files.find((item) => item.relativePath === 'manifest.json')
  const manifest = JSON.parse(await readFile(manifestFile.absolutePath, 'utf8'))
  assert.equal(manifest.packageKind, 'FOLDER')
  assert.equal(manifest.originalFileCount, 2)
  assert.deepEqual(manifest.sourceFiles.map((file) => file.relativePath), ['monitoring-folder/a.txt', 'monitoring-folder/nested/b.csv'])
})
test('api callback ingress accepts Postman INGRESS_TOKEN header alias', async () => {
  const uploadsDir = await mkdtemp(path.join(tmpdir(), 'api-ingress-token-'))
  const bridge = new IntegrationBridge({ uploadsDir, backendUrl: 'http://127.0.0.1:1', ingressToken: 'test123456', preTransmissionFrameBytes: 1024 })

  const body = Buffer.from('postman token smoke')
  const result = await bridge.ingestStreamPackage(Object.assign([body], {
    url: '/api/ingress/api-callback?packageName=postman-test.txt&protocol=HTTP',
    headers: {
      'content-length': String(body.length),
      'content-type': 'application/octet-stream',
      'ingress_token': 'test123456'
    },
    socket: { remoteAddress: '172.20.10.2' }
  }), 'API')

  assert.equal(result.ingress.ingressMode, 'API_CALLBACK')
  assert.equal(result.ingress.sourceProtocol, 'HTTP')
  assert.equal(result.file.preTransmission.mode, 'API_CALLBACK')
})

test('message queue start accepts 531 files without RabbitMQ header manifest', async (t) => {
  const uploadsDir = await mkdtemp(path.join(tmpdir(), 'rabbitmq-large-manifest-'))
  const mock = createMockRabbitMqClient()
  const bridge = new IntegrationBridge({
    uploadsDir,
    backendUrl: 'http://127.0.0.1:1',
    amqpClient: mock.client,
    rabbitmqUrl: 'amqp://guest:guest@127.0.0.1:5672',
    rabbitmqQueue: 'datacompress.message.queue',
    rabbitmqChunkBytes: 64 * 1024,
    preTransmissionFrameBytes: 1024 * 1024
  })
  const server = http.createServer(createRequestHandler(bridge))
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  t.after(() => new Promise((resolve) => server.close(resolve)))
  const address = server.address()
  const base = `http://127.0.0.1:${address.port}`
  const files = Array.from({ length: 531 }, (_, index) => ({
    name: `sensor-${String(index + 1).padStart(3, '0')}.txt`,
    relativePath: `large-folder/${String(index + 1).padStart(3, '0')}-${'x'.repeat(2200)}.txt`,
    size: 1,
    type: 'text/plain'
  }))
  const requestBody = JSON.stringify({ packageName: 'large-folder', packageKind: 'FOLDER', totalBytes: files.length, files })
  assert.ok(Buffer.byteLength(requestBody, 'utf8') > 1024 * 1024)

  const payload = await fetch(`${base}/api/ingress/message-queue/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: requestBody
  }).then((response) => response.json())

  assert.equal(payload.code, 0)
  assert.equal(payload.data.fileCount, 531)
  await new Promise((resolve) => setImmediate(resolve))
  const startMessage = mock.published.find((message) => message.properties.headers.type === 'start')
  assert.ok(startMessage)
  assert.equal(startMessage.properties.headers.sourceFiles, undefined)
  const manifest = JSON.parse(startMessage.content.toString('utf8'))
  assert.equal(manifest.sourceFiles.length, 531)
  assert.equal(manifest.sourceFiles[0].relativePath.startsWith('large-folder/001-'), true)
})
test('api callback ingress keeps HTTP path and does not publish to RabbitMQ', async () => {
  const uploadsDir = await mkdtemp(path.join(tmpdir(), 'api-ingress-'))
  const bridge = new IntegrationBridge({ uploadsDir, backendUrl: 'http://127.0.0.1:1', preTransmissionFrameBytes: 1024 })
  let rabbitMqPublished = false
  bridge.publishRabbitMqMessage = async () => { rabbitMqPublished = true }

  const body = Buffer.from(JSON.stringify({ ok: true, value: 42 }))
  const result = await bridge.ingestStreamPackage(Object.assign([body], {
    url: '/api/ingress/api-callback?packageName=api-callback-data.json&protocol=HTTP',
    headers: {
      'content-length': String(body.length),
      'content-type': 'application/json',
      'x-package-name': 'api-callback-data.json',
      'x-source-protocol': 'HTTP',
      'x-source-name': 'BusinessSystem'
    },
    socket: { remoteAddress: '127.0.0.1' }
  }), 'API')

  assert.equal(rabbitMqPublished, false)
  assert.equal(result.ingress.ingressMode, 'API_CALLBACK')
  assert.equal(result.ingress.sourceProtocol, 'HTTP')
  assert.equal(result.file.preTransmission.mode, 'API_CALLBACK')
  assert.equal(result.file.preTransmission.sourceProtocol, 'HTTP')
})
