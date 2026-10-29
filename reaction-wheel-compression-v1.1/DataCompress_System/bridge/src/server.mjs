import http from 'node:http'
import https from 'node:https'
import { spawn } from 'node:child_process'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { randomUUID } from 'node:crypto'
import { networkInterfaces } from 'node:os'
import { inflateRawSync } from 'node:zlib'

const here = path.dirname(fileURLToPath(import.meta.url))
const integrationRoot = path.resolve(here, '..', '..')

const DEFAULTS = {
  host: process.env.BRIDGE_HOST || '0.0.0.0',
  port: Number(process.env.BRIDGE_PORT || 8080),
  backendUrl: (process.env.BACKEND_URL || 'http://127.0.0.1:8082').replace(/\/$/, ''),
  frontendDist: path.resolve(process.env.FRONTEND_DIST || path.join(integrationRoot, 'frontend', 'dist')),
  sampleDataDir: path.resolve(process.env.SAMPLE_DATA_DIR || path.join(integrationRoot, 'backend', 'sample-data')),
  uploadsDir: path.resolve(process.env.UPLOADS_DIR || path.join(integrationRoot, 'runtime', 'uploads')),
  receivedDir: path.resolve(process.env.RECEIVED_DIR || path.join(integrationRoot, 'runtime', 'received')),
  receiverUrl: (process.env.RECEIVER_URL || '').replace(/\/$/, ''),
  uploadLimitBytes: Number(process.env.UPLOAD_LIMIT_BYTES || 5 * 1024 * 1024 * 1024),
  preTransmissionFrameBytes: Number(process.env.PRETRANSMISSION_FRAME_BYTES || 512 * 1024 * 1024),
  localUploadChunkBytes: Number(process.env.LOCAL_UPLOAD_CHUNK_BYTES || 16 * 1024 * 1024),
  rabbitmqUrl: process.env.RABBITMQ_URL || 'amqp://guest:guest@127.0.0.1:5672',
  rabbitmqQueue: process.env.RABBITMQ_QUEUE || 'datacompress.message.queue',
  rabbitmqChunkBytes: Number(process.env.RABBITMQ_CHUNK_BYTES || 1024 * 1024),
  ingressToken: String(process.env.INGRESS_TOKEN || '').trim()
}

const MULTIPART_OVERHEAD_BYTES = 16 * 1024 * 1024
const MAX_PACKAGE_FILE_COUNT = Number(process.env.MAX_PACKAGE_FILE_COUNT || 600)
const MAX_PRE_TRANSMISSION_FRAME_COUNT = Math.max(1, Number(process.env.MAX_PRE_TRANSMISSION_FRAME_COUNT || 2000))
const DEFAULT_RECEIVER_PORT = Number(process.env.DEFAULT_RECEIVER_PORT || 8081)
const DEFAULT_RECEIVER_BOOTSTRAP_PORT = Number(process.env.DEFAULT_RECEIVER_BOOTSTRAP_PORT || 8080)
const RECEIVER_HEALTH_CHECK_INTERVAL_MS = Number(process.env.RECEIVER_HEALTH_CHECK_INTERVAL_MS || 1500)
const RECEIVER_HEALTH_TIMEOUT_MS = Number(process.env.RECEIVER_HEALTH_TIMEOUT_MS || 800)
const RECEIVER_HEALTH_FAILURE_LIMIT = Number(process.env.RECEIVER_HEALTH_FAILURE_LIMIT || 2)
const RECEIVER_RATE_PROBE_BYTES = Number(process.env.RECEIVER_RATE_PROBE_BYTES || 512 * 1024)
const RECEIVER_RATE_PROBE_INTERVAL_MS = Number(process.env.RECEIVER_RATE_PROBE_INTERVAL_MS || 2000)
const RECEIVER_RATE_PROBE_TIMEOUT_MS = Number(process.env.RECEIVER_RATE_PROBE_TIMEOUT_MS || 5000)
const RABBITMQ_INGEST_TIMEOUT_MS = Number(process.env.RABBITMQ_INGEST_TIMEOUT_MS || 120000)
const FAST_HOLT_WARMUP_FILE_NAME = 'fast-holt-warmup-test.txt'

function isFastHoltWarmupTask(task) {
  return String(task?.fileName || '').trim() === FAST_HOLT_WARMUP_FILE_NAME
}

const ACTIVE_STATES = new Set([
  'QUEUED', 'PROFILING', 'WAITING_NETWORK', 'TRANSMITTING', 'VERIFYING', 'CACHED', 'RETRYING'
])

const MIME_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.gif': 'image/gif',
  '.htm': 'text/html; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.webp': 'image/webp',
  '.xml': 'application/xml; charset=utf-8',
  '.zip': 'application/zip'
}

const PRIORITY_TO_BACKEND = { '低': 'NORMAL', '中': 'IMPORTANT', '高': 'CRITICAL' }
const PRIORITY_TO_FRONTEND = { NORMAL: '低', IMPORTANT: '中', CRITICAL: '高' }

export function openPathInSystem(targetPath) {
  const resolved = path.resolve(String(targetPath || ''))
  if (!resolved) return Promise.reject(new Error('要打开的本机路径为空'))
  const command = process.platform === 'win32' ? 'explorer.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open'
  return new Promise((resolve, reject) => {
    const child = spawn(command, [resolved], { detached: true, stdio: 'ignore', windowsHide: true })
    child.once('error', (error) => reject(new Error(`无法调用系统打开路径：${error.message}`)))
    child.once('spawn', () => { child.unref(); resolve({ command, targetPath: resolved }) })
  })
}

function isPathInside(baseDir, targetPath) {
  const relative = path.relative(path.resolve(baseDir), path.resolve(targetPath))
  return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative))
}

export function clamp(value, min, max) {
  const number = Number(value)
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : min
}

export function round(value, digits = 2) {
  const factor = 10 ** digits
  return Math.round((Number(value) || 0) * factor) / factor
}

export function formatBytes(bytes) {
  const value = Math.max(0, Number(bytes) || 0)
  if (value < 1024) return `${Math.round(value)} B`
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(2)} KB`
  if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(2)} MB`
  return `${(value / 1024 ** 3).toFixed(2)} GB`
}

export function formatRate(kbps) {
  const value = Math.max(0, Number(kbps) || 0)
  if (!value) return '—'
  return value >= 1000 ? `${(value / 1000).toFixed(2)} Mbps` : `${value.toFixed(2)} Kbps`
}

export function formatDuration(milliseconds) {
  const value = Math.max(0, Number(milliseconds) || 0)
  const seconds = Math.round(value / 1000)
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const remainder = seconds % 60
  return [hours, minutes, remainder].map((item) => String(item).padStart(2, '0')).join(':')
}

function formatDelayDuration(milliseconds) {
  const value = Math.max(0, Number(milliseconds) || 0)
  if (value < 1000) return round(value, 1) + ' ms'
  if (value < 60000) return (value / 1000).toFixed(value < 10000 ? 2 : 1) + ' s'
  return formatDuration(value)
}

export function mapTaskState(backendState) {
  if (!backendState) return { state: 'IDLE', text: '待发送' }
  if (backendState === 'COMPLETED') return { state: 'COMPLETED', text: '任务已完成' }
  if (backendState === 'FAILED') return { state: 'FAILED', text: '任务失败' }
  if (backendState === 'PAUSED') return { state: 'PAUSED', text: '任务已暂停' }
  if (backendState === 'CANCELLED') return { state: 'FAILED', text: '任务已取消' }
  const text = {
    QUEUED: '任务排队中',
    PROFILING: '正在建立压缩画像',
    WAITING_NETWORK: '等待网络恢复',
    TRANSMITTING: '链路传输中',
    VERIFYING: '正在校验完整性',
    CACHED: '链路波动，任务已缓存',
    RETRYING: '正在补传'
  }[backendState] || '任务处理中'
  return { state: 'RUNNING', text }
}

function fileTypeFor(fileName) {
  const extension = path.extname(fileName).toLowerCase()
  const labels = {
    '.csv': 'CSV / 数值时序',
    '.json': 'JSON / 结构化数据',
    '.jsonl': 'JSONL / 文本日志',
    '.log': 'LOG / 文本日志',
    '.png': 'PNG / 图像',
    '.jpg': 'JPEG / 图像',
    '.jpeg': 'JPEG / 图像',
    '.tar': 'TAR / 归档',
    '.txt': 'TXT / 文本',
    '.zip': 'ZIP / 二进制归档'
  }
  return labels[extension] || `${extension.slice(1).toUpperCase() || 'BIN'} / 文件`
}

function contentTypeFor(fileName) {
  return MIME_TYPES[path.extname(fileName).toLowerCase()] || 'application/octet-stream'
}

function safeFileName(fileName) {
  const base = path.basename(String(fileName || 'upload.bin')).replace(/[\\/:*?"<>|]/g, '_').trim()
  return base || 'upload.bin'
}

function safeRelativePath(fileName) {
  const normalized = String(fileName || 'upload.bin').replace(/\\/g, '/')
  const segments = normalized.split('/')
    .filter((segment) => segment && segment !== '.' && segment !== '..')
    .map((segment) => segment.replace(/[:*?"<>|]/g, '_').trim())
    .filter(Boolean)
  return segments.join('/') || 'upload.bin'
}

function headerValue(headers = {}, name) {
  const value = headers[String(name || '').toLowerCase()]
  return Array.isArray(value) ? value[0] : String(value || '').trim()
}

function normalizeIngressPackageName(value, fallback = 'ingress-data.bin') {
  const raw = String(value || '').trim()
  const name = raw ? safeFileName(raw) : safeFileName(fallback)
  return name.includes('.') ? name : `${name}.bin`
}

function paddedFrameIndex(index) {
  return String(index).padStart(5, '0')
}

function sourceFileBaseName(file, fallback = 'data.bin') {
  const relativePath = String(file?.relativePath || file?.name || fallback).replace(/\\/g, '/')
  const base = relativePath.split('/').filter(Boolean).pop() || fallback
  return safeFileName(base)
}

function preTransmissionSourceFileForFrame(info = {}, frameIndex = 1) {
  const sourceFiles = Array.isArray(info.sourceFiles) ? info.sourceFiles : []
  if (!sourceFiles.length) return null
  if (sourceFiles.length === 1) return sourceFiles[0]

  const frames = Array.isArray(info.frames) ? info.frames : []
  let frameStart = 0
  let frameBytes = 0
  for (const frame of frames) {
    const currentIndex = Math.floor(Number(frame?.index) || 0)
    const currentBytes = Math.max(0, Math.floor(Number(frame?.bytes) || 0))
    if (currentIndex === frameIndex) {
      frameBytes = currentBytes
      break
    }
    frameStart += currentBytes
  }
  if (!frameBytes) frameBytes = Math.max(0, Math.floor(Number(info.frameBytes) || 0))
  const frameMiddle = frameStart + Math.max(0, frameBytes - 1) / 2

  let fileStart = 0
  for (const [index, file] of sourceFiles.entries()) {
    const fileBytes = Math.max(0, Math.floor(Number(file?.bytes) || 0))
    const fileEnd = fileStart + fileBytes
    if (frameMiddle < fileEnd || index === sourceFiles.length - 1) return file
    fileStart = fileEnd
  }
  return sourceFiles[0]
}

function preTransmissionPackageDisplayName(info = {}, fallback = '预传输帧数据包') {
  const sourceFiles = Array.isArray(info.sourceFiles) ? info.sourceFiles : []
  const packageName = safeFileName(info.packageName || fallback)
  if (sourceFiles.length === 1) return sourceFileBaseName(sourceFiles[0], packageName)
  if (sourceFiles.length > 1) return `${packageName} / ${sourceFileBaseName(sourceFiles[0], packageName)} 等${sourceFiles.length}项`
  return packageName
}

function preTransmissionFrameTaskName(info = {}, frameIndex = 1, fallback = 'pre-transmission.bin') {
  const baseName = safeFileName(info.packageName || fallback || 'pre-transmission.bin')
  return `${baseName}-frame-${paddedFrameIndex(frameIndex)}`
}

function writeStreamChunk(stream, chunk) {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      stream.off('error', onError)
      stream.off('drain', onDrain)
    }
    const onError = (error) => { cleanup(); reject(error) }
    const onDrain = () => { cleanup(); resolve() }
    stream.once('error', onError)
    if (stream.write(chunk)) {
      cleanup()
      resolve()
    } else {
      stream.once('drain', onDrain)
    }
  })
}

function closeWriteStream(stream) {
  return new Promise((resolve, reject) => {
    stream.once('error', reject)
    stream.end(resolve)
  })
}

function isLocalRemoteAddress(address = '') {
  const value = String(address || '').replace(/^::ffff:/, '')
  return value === '127.0.0.1' || value === '::1' || value === 'localhost'
}
function localIPv4() {
  const candidates = []
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries || []) {
      if (entry && entry.family === 'IPv4' && !entry.internal && entry.address) candidates.push(entry.address)
    }
  }
  const privateAddress = candidates.find((address) => /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(address))
  return privateAddress || candidates[0] || '127.0.0.1'
}

function normalizeReceiverPort(value, fallback = DEFAULT_RECEIVER_PORT) {
  const port = Number(value || fallback)
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('接收端端口不正确')
  return port
}

export function normalizeReceiverAddress(value) {
  const raw = String(value || '').trim()
  const candidate = raw.replace(/^https?:\/\//i, '').replace(/\/+$/, '')
  const match = candidate.match(/^(\d{1,3}(?:\.\d{1,3}){3})(?::(\d{1,5}))?$/)
  if (!match) throw new Error('接收端地址格式不正确')
  const host = match[1]
  const octets = host.split('.').map(Number)
  if (octets.some((item) => item > 255)) throw new Error('接收端地址格式不正确')
  const port = normalizeReceiverPort(match[2], DEFAULT_RECEIVER_PORT)
  return { address: `${host}:${port}`, url: `http://${host}:${port}`, host, port }
}

function publicFileOption(item) {
  const { absolutePath, bytes, files, ...publicItem } = item
  return publicItem
}

function escapeHtml(value) { return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;') }
function archivePath(value) {
  const normalized = String(value || '').replace(/\\/g, '/').replace(/^\/+/, '')
  if (!normalized || normalized.split('/').some((part) => !part || part === '.' || part === '..')) throw new Error('任务文件路径不合法')
  return normalized
}
export function readZipEntries(payload, maxTotalBytes = Number.POSITIVE_INFINITY) {
  const buffer = Buffer.isBuffer(payload) ? payload : Buffer.from(payload)
  let end = -1
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 0xffff - 22); i--) if (buffer.readUInt32LE(i) === 0x06054b50) { end = i; break }
  if (end < 0) throw new Error('任务恢复文件不是有效的 ZIP 数据')
  const count = buffer.readUInt16LE(end + 10); let cursor = buffer.readUInt32LE(end + 16); const entries = []
  let totalBytes = 0
  for (let i = 0; i < count; i++) {
    if (buffer.readUInt32LE(cursor) !== 0x02014b50) throw new Error('ZIP 目录结构无效')
    const method = buffer.readUInt16LE(cursor + 10), compressedSize = buffer.readUInt32LE(cursor + 20), uncompressedSize = buffer.readUInt32LE(cursor + 24), nameLength = buffer.readUInt16LE(cursor + 28), extraLength = buffer.readUInt16LE(cursor + 30), commentLength = buffer.readUInt16LE(cursor + 32), localOffset = buffer.readUInt32LE(cursor + 42)
    const rawName = buffer.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8').replace(/\\/g, '/')
    cursor += 46 + nameLength + extraLength + commentLength
    if (rawName.endsWith('/')) continue
    const name = archivePath(rawName)
    totalBytes += uncompressedSize
    if (totalBytes > maxTotalBytes) throw new Error(`解压后文件总大小超过限制：${formatBytes(maxTotalBytes)}`)
    if (buffer.readUInt32LE(localOffset) !== 0x04034b50) throw new Error('ZIP 文件条目无效')
    const dataStart = localOffset + 30 + buffer.readUInt16LE(localOffset + 26) + buffer.readUInt16LE(localOffset + 28)
    const compressed = buffer.subarray(dataStart, dataStart + compressedSize)
    const bytes = method === 0 ? compressed : method === 8 ? inflateRawSync(compressed) : null
    if (!bytes) throw new Error('任务文件使用了不支持的压缩格式')
    if (bytes.length !== uncompressedSize) throw new Error('任务文件解压后的大小校验失败')
    entries.push({ path: name, bytes })
  }
  if (!entries.length) throw new Error('任务恢复文件中没有可打开的内容')
  return entries
}

function extractionDirectoryFor(packagePath) {
  const packageName = path.basename(packagePath).replace(/\.zip$/i, '')
  return path.join(path.dirname(packagePath), `${safeFileName(packageName)}-extracted`)
}

function chooseExtractedOpenTarget(extractionRoot, entries) {
  if (entries.length === 1) return path.join(extractionRoot, ...entries[0].path.split('/'))
  const firstSegments = [...new Set(entries.map((entry) => entry.path.split('/')[0]))]
  if (firstSegments.length === 1 && entries.every((entry) => entry.path.includes('/'))) {
    return path.join(extractionRoot, firstSegments[0])
  }
  return extractionRoot
}

function archiveEntrySize(entry) {
  return Math.max(0, Number(entry?.size ?? entry?.bytes?.length ?? 0))
}

function listDirectory(entries, directory) {
  const prefix = directory ? directory + '/' : '', visible = new Map()
  for (const entry of entries) {
    if (!entry.path.startsWith(prefix)) continue
    const remaining = entry.path.slice(prefix.length); if (!remaining) continue
    const slash = remaining.indexOf('/')
    if (slash >= 0) { const name = remaining.slice(0, slash); visible.set(prefix + name, { name, path: prefix + name, directory: true }) }
    else visible.set(entry.path, { name: remaining, path: entry.path, directory: false, size: archiveEntrySize(entry) })
  }
  if (directory && !visible.size) throw new Error('任务中不存在该目录')
  return [...visible.values()].sort((a, b) => Number(b.directory) - Number(a.directory) || a.name.localeCompare(b.name, 'zh-CN'))
}
async function backendTaskArchive(bridge, taskId) {
  const preTransmissionFrame = bridge.preTransmissionDeliveries?.get(String(taskId))
  if (preTransmissionFrame?.taskIds?.length) return bridge.backendPreTransmissionArchive(taskId, preTransmissionFrame)
  const [task, response] = await Promise.all([
    bridge.backend(`/api/tasks/${encodeURIComponent(taskId)}`),
    fetch(`${bridge.options.backendUrl}/api/tasks/${encodeURIComponent(taskId)}/download/restored`)
  ])
  if (!response.ok) throw new Error('任务文件尚未准备完成，请等待传输结束后再打开')
  return { task, entries: readZipEntries(Buffer.from(await response.arrayBuffer())) }
}

async function receivedTaskArchive(bridge, taskId) {
  const record = await bridge.ensureReceivedPackageExtracted(await bridge.resolveReceivedPackage(taskId))
  const entries = record.assembled
    ? await bridge.listReceivedFilesystemEntries(record.assembledRoot || record.extractedPath || path.dirname(record.openTargetPath || record.absolutePath))
    : readZipEntries(await readFile(record.absolutePath), bridge.options.uploadLimitBytes)
  const syncedTask = bridge.syncedTransferTasks.find((item) => String(item.id) === String(taskId)) || {}
  const packageKind = String(record.packageKind || syncedTask.packageKind || '').toUpperCase() || (entries.length > 1 ? 'FOLDER' : 'FILE')
  return {
    task: {
      ...syncedTask,
      id: String(taskId),
      fileName: syncedTask.fileName || record.fileName || path.basename(record.openTargetPath || record.absolutePath),
      packageKind
    },
    entries
  }
}

async function serveTaskContent(response, bridge, taskId, requestedPath, options = {}) {
  const source = options.source === 'receiver' ? await receivedTaskArchive(bridge, taskId) : await backendTaskArchive(bridge, taskId)
  const { task, entries } = source
  const routeBase = options.routeBase || `/api/tasks/${encodeURIComponent(taskId)}`
  if (String(task.packageKind || '').toUpperCase() === 'FOLDER' && !requestedPath) {
    response.writeHead(409, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
    response.end(`请先进入 <a href="${routeBase}/browse">打开文件夹</a> 并选择文件。`)
    return
  }
  const selected = requestedPath ? archivePath(requestedPath) : entries[0].path
  const entry = entries.find((item) => item.path === selected)
  if (!entry) throw new Error('任务中不存在指定文件')
  response.writeHead(200, {
    'Content-Type': contentTypeFor(entry.path),
    'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(path.basename(entry.path))}`,
    'Content-Length': archiveEntrySize(entry),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  })
  if (entry.absolutePath) {
    createReadStream(entry.absolutePath).once('error', () => response.destroy()).pipe(response)
    return
  }
  response.end(entry.bytes)
}

async function serveTaskBrowse(response, bridge, taskId, requestedDirectory, options = {}) {
  const source = options.source === 'receiver' ? await receivedTaskArchive(bridge, taskId) : await backendTaskArchive(bridge, taskId)
  const { task, entries } = source
  const routeBase = options.routeBase || `/api/tasks/${encodeURIComponent(taskId)}`
  const directory = requestedDirectory ? archivePath(requestedDirectory) : ''
  const rows = listDirectory(entries, directory).map((item) => {
    const href = item.directory
      ? `${routeBase}/browse?path=${encodeURIComponent(item.path)}`
      : `${routeBase}/content/file?path=${encodeURIComponent(item.path)}`
    return `<tr><td>${item.directory ? '▰' : '▤'} ${escapeHtml(item.name)}</td><td>${item.directory ? '—' : formatBytes(item.size)}</td><td><a${item.directory ? '' : ' target="_blank"'} href="${href}">${item.directory ? '打开目录' : '打开文件'}</a></td></tr>`
  }).join('')
  const parent = directory.includes('/') ? directory.slice(0, directory.lastIndexOf('/')) : ''
  const back = directory ? `<p><a href="${routeBase}/browse${parent ? '?path=' + encodeURIComponent(parent) : ''}">← 返回上级目录</a></p>` : ''
  const html = `<!doctype html><meta charset="utf-8"><title>任务存储目录</title><style>body{font:14px system-ui,'Microsoft YaHei';background:#f4f7fc;color:#183066;margin:0}.wrap{max-width:960px;margin:36px auto;background:white;border:1px solid #dfe8f7;border-radius:12px;padding:24px}table{width:100%;border-collapse:collapse}th,td{padding:12px;border-bottom:1px solid #e7edf7;text-align:left}th{background:#f3f7fd}a{color:#0868ef;font-weight:700;text-decoration:none}</style><main class="wrap"><h1>${escapeHtml(task.fileName || '任务文件夹')}</h1><p>传输任务接收目录 / ${escapeHtml([task.fileName, directory].filter(Boolean).join(' / '))}</p>${back}<table><thead><tr><th>名称</th><th>大小</th><th>操作</th></tr></thead><tbody>${rows}</tbody></table></main>`
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'" })
  response.end(html)
}

function getMultipartBoundary(contentType = '') {
  const match = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType)
  return match?.[1] || match?.[2] || ''
}

function parseContentDisposition(value = '') {
  const result = {}
  for (const segment of value.split(';')) {
    const [rawKey, ...rawValue] = segment.trim().split('=')
    if (!rawKey || !rawValue.length) continue
    result[rawKey.toLowerCase()] = rawValue.join('=').replace(/^"|"$/g, '')
  }
  return result
}

export function parseMultipartBody(buffer, contentType) {
  const boundary = getMultipartBoundary(contentType)
  if (!boundary) throw new Error('缺少 multipart boundary')

  const delimiter = Buffer.from(`--${boundary}`)
  const files = []
  const fields = {}
  let cursor = buffer.indexOf(delimiter)

  while (cursor !== -1) {
    cursor += delimiter.length
    if (buffer[cursor] === 45 && buffer[cursor + 1] === 45) break
    if (buffer[cursor] === 13 && buffer[cursor + 1] === 10) cursor += 2

    const next = buffer.indexOf(delimiter, cursor)
    if (next === -1) break

    let part = buffer.subarray(cursor, next)
    if (part.at(-2) === 13 && part.at(-1) === 10) part = part.subarray(0, -2)

    const headerEnd = part.indexOf(Buffer.from('\r\n\r\n'))
    if (headerEnd !== -1) {
      const headerText = part.subarray(0, headerEnd).toString('utf8')
      const body = part.subarray(headerEnd + 4)
      const headers = Object.fromEntries(headerText.split('\r\n').map((line) => {
        const index = line.indexOf(':')
        return index === -1 ? ['', ''] : [line.slice(0, index).trim().toLowerCase(), line.slice(index + 1).trim()]
      }).filter(([key]) => key))
      const disposition = parseContentDisposition(headers['content-disposition'])
      if (disposition.filename) {
        files.push({ name: disposition.name || 'file', filename: safeRelativePath(disposition.filename), contentType: headers['content-type'] || 'application/octet-stream', content: body })
      } else if (disposition.name) {
        fields[disposition.name] = body.toString('utf8')
      }
    }
    cursor = next
  }

  return { files, fields }
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

function escapeMultipartValue(value) {
  return String(value || '').replace(/"/g, '%22').replace(/[\r\n]/g, ' ')
}

function postMultipartWithProgress(targetUrl, { fields = {}, file, onProgress = () => {} }) {
  return new Promise((resolve, reject) => {
    const target = new URL(targetUrl)
    if (!['http:', 'https:'].includes(target.protocol)) {
      reject(new Error('远端接收端地址必须使用 http 或 https'))
      return
    }

    const boundary = `----integration-${randomUUID()}`
    const fileBuffer = Buffer.isBuffer(file.content) ? file.content : Buffer.from(file.content || [])
    const fieldBuffers = Object.entries(fields).map(([name, value]) => Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="${escapeMultipartValue(name)}"\r\n\r\n${String(value ?? '')}\r\n`,
      'utf8'
    ))
    const fileHeader = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="${escapeMultipartValue(file.name || 'file')}"; filename="${escapeMultipartValue(file.filename || 'package.zip')}"\r\nContent-Type: ${file.contentType || 'application/octet-stream'}\r\n\r\n`,
      'utf8'
    )
    const footer = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8')
    const contentLength = fieldBuffers.reduce((sum, item) => sum + item.length, 0) + fileHeader.length + fileBuffer.length + footer.length
    const transport = target.protocol === 'https:' ? https : http
    const request = transport.request(target, {
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': contentLength
      }
    }, (response) => {
      const chunks = []
      response.on('data', (chunk) => chunks.push(chunk))
      response.on('end', () => resolve({
        ok: response.statusCode >= 200 && response.statusCode < 300,
        status: response.statusCode || 0,
        text: Buffer.concat(chunks).toString('utf8')
      }))
    })

    request.on('error', reject)

    const writeBuffer = (buffer) => new Promise((resolveWrite, rejectWrite) => {
      if (!buffer.length) {
        resolveWrite()
        return
      }
      request.write(buffer, (error) => error ? rejectWrite(error) : resolveWrite())
    })

    ;(async () => {
      try {
        for (const fieldBuffer of fieldBuffers) await writeBuffer(fieldBuffer)
        await writeBuffer(fileHeader)

        let sentBytes = 0
        const totalBytes = fileBuffer.length
        const chunkSize = 64 * 1024
        if (totalBytes === 0) onProgress({ sentBytes: 0, totalBytes: 0, progress: 100 })
        for (let offset = 0; offset < fileBuffer.length; offset += chunkSize) {
          const chunk = fileBuffer.subarray(offset, Math.min(offset + chunkSize, fileBuffer.length))
          await writeBuffer(chunk)
          sentBytes += chunk.length
          onProgress({ sentBytes, totalBytes, progress: round(sentBytes * 100 / Math.max(totalBytes, 1), 1) })
        }

        await writeBuffer(footer)
        request.end()
      } catch (error) {
        request.destroy(error)
        reject(error)
      }
    })()
  })
}

function algorithmName(algorithms, id) {
  return algorithms.find((item) => item.name === id)?.name || id || 'AUTO'
}

function priorityText(task, configuredPriority) {
  return PRIORITY_TO_FRONTEND[task?.priority?.priority] || configuredPriority || '中'
}

function compressionNumbers(task) {
  const originalBytes = Math.max(0, Number(task?.originalBytes) || 0)
  const actualCompressedBytes = Math.max(0, Number(task?.compressedBytes) || 0)
  const estimatedRatio = clamp(task?.currentDecision?.estimatedCompressedRatio ?? 1, 0, 1)
  const compressedBytes = actualCompressedBytes || originalBytes * estimatedRatio
  const savingRate = originalBytes > 0 ? clamp(1 - compressedBytes / originalBytes, 0, 1) : 0
  return { originalBytes, compressedBytes, savingRate }
}

export function buildTaskSummary({ task, config, fileOption, algorithms = [] }) {
  const mapped = mapTaskState(task?.state)
  const numbers = compressionNumbers(task)
  const configuredAlgorithm = config?.algorithmId || 'ZSTD'
  const automaticPending = !task?.currentDecision && config?.mode === 'AUTO'
  const decisionAlgorithm = automaticPending ? 'AUTO' : (task?.currentDecision?.algorithm || configuredAlgorithm)
  const level = automaticPending ? '自动' : String(task?.currentDecision?.level ?? config?.level ?? '3')
  const originalBytes = task ? numbers.originalBytes : Number(fileOption?.bytes) || 0
  const idleEstimatedRatio = 0.65
  const compressedBytes = task ? numbers.compressedBytes : originalBytes * idleEstimatedRatio
  const savingRate = task ? numbers.savingRate : originalBytes ? 1 - idleEstimatedRatio : 0

  return {
    id: task?.id || '',
    state: mapped.state,
    stateText: mapped.text,
    fileName: task?.fileName || fileOption?.name || '未选择数据包',
    fileSize: formatBytes(originalBytes),
    fileType: fileOption?.type || task?.recognition?.format || '数据包待识别',
    algorithm: String(algorithmName(algorithms, decisionAlgorithm)).toUpperCase(),
    algorithmId: String(decisionAlgorithm).toUpperCase(),
    level,
    priority: priorityText(task, config?.priority),
    estimatedCompressedSize: formatBytes(compressedBytes),
    estimatedSaving: `${(savingRate * 100).toFixed(2)}%`,
    retryCount: Math.max(0, Number(task?.retryCount) || 0),
    retryExhausted: mapped.state === 'FAILED' && Math.max(0, Number(task?.retryCount) || 0) > 0,
    message: task?.message || '',
    editable: mapped.state !== 'RUNNING'
  }
}

function apiSuccess(data, message = 'success') {
  return { code: 0, message, data }
}

function apiError(message) {
  return { code: 1, message: String(message || '服务异常'), data: null }
}

function extractError(payload, fallback) {
  return payload?.message || payload?.error || fallback
}

async function parseBackendResponse(response) {
  const text = await response.text()
  let payload = null
  try {
    payload = text ? JSON.parse(text) : null
  } catch {
    payload = text
  }
  if (!response.ok) {
    throw new Error(extractError(payload, `后端服务请求失败：${response.status}`))
  }
  return payload
}

function sourceHost(source) {
  if (!source?.endpoint) return source?.name || '数据服务'
  try {
    return new URL(source.endpoint).hostname || source.endpoint
  } catch {
    return source.endpoint
  }
}

function sourcePort(source) {
  if (!source?.endpoint) return '—'
  try {
    const url = new URL(source.endpoint)
    return url.port || ({ http: '80', https: '443', mqtt: '1883', rtsp: '554' }[url.protocol.replace(':', '')] || '—')
  } catch {
    return '—'
  }
}

function average(values) {
  const numbers = values.map(Number).filter(Number.isFinite)
  return numbers.length ? numbers.reduce((sum, value) => sum + value, 0) / numbers.length : 0
}

export function calculatePredictionMetrics(points = []) {
  const valid = points.map((point) => ({
    actual: Number(point?.actualRateKbps),
    predicted: Number(point?.predictedRateKbps)
  })).filter((point) => Number.isFinite(point.actual)
    && point.actual > 0
    && Number.isFinite(point.predicted)
    && point.predicted >= 0)

  if (!valid.length) {
    return { sampleCount: 0, fitScorePercent: null, trendConsistencyPercent: null }
  }

  const fitScorePercent = average(valid.map((point) => {
    const maximum = Math.max(point.actual, point.predicted)
    return maximum > 0 ? Math.min(point.actual, point.predicted) * 100 / maximum : 100
  }))

  let matchedTrends = 0
  let trendPairs = 0
  for (let index = 1; index < valid.length; index += 1) {
    const actualChange = valid[index].actual - valid[index - 1].actual
    const predictedChange = valid[index].predicted - valid[index - 1].predicted
    const actualDirection = Math.sign(actualChange)
    const predictedDirection = Math.sign(predictedChange)
    if (actualDirection === predictedDirection) matchedTrends += 1
    trendPairs += 1
  }
  return {
    sampleCount: valid.length,
    fitScorePercent,
    trendConsistencyPercent: trendPairs ? matchedTrends * 100 / trendPairs : null
  }
}

function forecastModelDisplayName(modelName) {
  const raw = String(modelName || '').trim()
  const key = raw.toUpperCase()
  const names = {
    COMPACT_LSTM_MULTISCALE_GUARDED: '长短期记忆网络预测器',
    FAST_HOLT_WARMUP: '快速预热预测器',
    ROBUST_P20_TELEMETRY_FALLBACK: '稳健保守预测器',
    ROBUST_P20_MODEL_CIRCUIT_BREAKER: '模型保护预测器'
  }
  if (names[key]) return names[key]
  return raw && !/[闀绛闄姝妯淇熻]/.test(raw) ? raw : '长短期记忆网络预测器'
}

function forecastDegradationDisplayReason(reason) {
  const raw = String(reason || '').trim()
  const key = raw.toUpperCase()
  if (!raw || key === 'NONE' || key === 'HEALTHY') return '无异常'
  const lower = raw.toLowerCase()
  if (lower.includes('insufficient history')) return '历史样本不足'
  if (lower.includes('model unavailable')) return '模型不可用'
  if (lower.includes('telemetry')) return '遥测数据不足'
  if (lower.includes('unsafe ratio')) return raw.replace(/unsafe ratio/i, '不安全预测比例').replace(/\s*>\s*/, ' 超过 ')
  if (lower.includes('mape')) return raw.replace(/MAPE/i, '平均绝对百分比误差').replace(/\s*>\s*/, ' 超过 ')
  return raw
}

function forecastHealthDisplayText({ fastHoltWarmupTask = false, hasPredictionFeedback = false, networkForecast = null } = {}) {
  if (fastHoltWarmupTask) return '预热中，历史样本不足'
  if (!hasPredictionFeedback) return '等待传输反馈'
  if (networkForecast?.degraded) return `保护模式：${forecastDegradationDisplayReason(networkForecast?.degradationReason)}`
  return '正常'
}
function percentChange(before, after) {
  if (!(before > 0)) return 0
  return (before - after) * 100 / before
}

/**
 * 按每个分片的实际压缩率，对已记录的模型传输时间进行反事实估计：
 * T_uncompressed,i = T_compressed,i * originalBytes_i / compressedBytes_i
 *
 * modeledTransferMillis 已包含该分片执行时的速率及丢包修正，因此逐片估计
 * 能保留网络波动和分片压缩率差异。若个别分片指标不完整，则用有效分片
 * 的加权压缩率（或任务整体压缩率）估算未覆盖的传输时间。
 */
export function estimateUncompressedTransferMillis(
  chunks,
  fallbackTransferMillis = 0,
  fallbackOriginalBytes = 0,
  fallbackCompressedBytes = 0
) {
  const items = Array.isArray(chunks) ? chunks : []
  let estimatedMillis = 0
  let coveredTransferMillis = 0
  let validOriginalBytes = 0
  let validCompressedBytes = 0

  for (const item of items) {
    const modeledMillis = Math.max(0, Number(item?.modeledTransferMillis) || 0)
    if (!(modeledMillis > 0)) continue

    coveredTransferMillis += modeledMillis
    const originalBytes = Math.max(0, Number(item?.originalBytes) || 0)
    const compressedBytes = Math.max(0, Number(item?.compressedBytes) || 0)

    if (originalBytes > 0 && compressedBytes > 0) {
      estimatedMillis += modeledMillis * originalBytes / compressedBytes
      validOriginalBytes += originalBytes
      validCompressedBytes += compressedBytes
    } else {
      estimatedMillis += modeledMillis
    }
  }

  const taskTransferMillis = Math.max(0, Number(fallbackTransferMillis) || 0)
  const residualTransferMillis = Math.max(0, taskTransferMillis - coveredTransferMillis)
  if (residualTransferMillis > 0) {
    const overallOriginalBytes = Math.max(0, Number(fallbackOriginalBytes) || 0)
    const overallCompressedBytes = Math.max(0, Number(fallbackCompressedBytes) || 0)
    const fallbackRatio = validCompressedBytes > 0
      ? validOriginalBytes / validCompressedBytes
      : overallCompressedBytes > 0
        ? overallOriginalBytes / overallCompressedBytes
        : 1
    estimatedMillis += residualTransferMillis * Math.max(1, fallbackRatio)
  }

  return Math.max(0, estimatedMillis || taskTransferMillis)
}

function niceAxisMax(values, fallback = 10) {
  const max = Math.max(0, ...values.map(Number).filter(Number.isFinite))
  if (!max) return fallback
  const padded = max * 1.18
  const exponent = Math.floor(Math.log10(padded))
  const base = 10 ** exponent
  const normalized = padded / base
  const step = normalized <= 1.2 ? 1.2 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10
  return round(step * base, step < 2 ? 1 : 0)
}

function taskLiveThroughputKbps(task, fallback = 0) {
  const fallbackRate = Math.max(0, Number(fallback) || 0)
  const chunks = Array.isArray(task?.chunks) ? task.chunks : []
  const latest = chunks.length ? chunks[chunks.length - 1] : null
  if (!latest) return fallbackRate
  const modeledMillis = Math.max(0, Number(latest.modeledTransferMillis) || 0)
  const compressedBytes = Math.max(0, Number(latest.compressedBytes) || 0)
  const modeledRate = modeledMillis > 0 && compressedBytes > 0 ? compressedBytes * 8 / modeledMillis : 0
  const actualRate = Math.max(0, Number(latest.actualRateKbps) || 0)
  return modeledRate || actualRate || fallbackRate
}

function averageEffectiveThroughputKbps(task, processedBytes = 0, { remoteDelivery = null, remoteForCurrentTask = false, now = Date.now() } = {}) {
  const remoteState = String(remoteDelivery?.state || '')
  if (remoteForCurrentTask && ['sending', 'delivered'].includes(remoteState)) {
    const remoteBytes = Math.max(0, Number(remoteDelivery?.sentBytes || remoteDelivery?.totalBytes) || 0)
    const startedAtMillis = Number(remoteDelivery?.startedAtMillis) || 0
    const endedAtMillis = Number(remoteDelivery?.completedAtMillis || remoteDelivery?.updatedAtMillis || now) || 0
    const elapsedMillis = startedAtMillis && endedAtMillis > startedAtMillis ? endedAtMillis - startedAtMillis : 0
    if (remoteBytes > 0 && elapsedMillis > 0) return remoteBytes * 8 / elapsedMillis
  }

  const bytes = Math.max(0, Number(processedBytes) || Number(task?.compressedBytes) || 0)
  const startedAtMillis = Number(task?.startedAtMillis) || 0
  const completedAtMillis = Number(task?.completedAtMillis) || 0
  const state = String(task?.state || '').toUpperCase()
  const endedAtMillis = completedAtMillis || (ACTIVE_STATES.has(state) ? now : 0)
  const elapsedMillis = startedAtMillis && endedAtMillis > startedAtMillis ? endedAtMillis - startedAtMillis : 0
  return bytes > 0 && elapsedMillis > 0 ? bytes * 8 / elapsedMillis : 0
}
function stateStages(backendState, progressPercent = 0) {
  const progress = clamp(progressPercent, 0, 100)
  const names = ['文件压缩与封装', '网络数据传输', '接收与解压', '完整性校验']
  let index = {
    QUEUED: 0,
    PROFILING: 0,
    WAITING_NETWORK: 1,
    CACHED: 1,
    RETRYING: 1,
    TRANSMITTING: 1,
    VERIFYING: progress >= 99.9 ? 3 : 2,
    PAUSED: 1,
    COMPLETED: names.length,
    FAILED: -1,
    CANCELLED: -1
  }[backendState]
  return names.map((name, itemIndex) => ({
    name,
    status: index === names.length || itemIndex < index ? 'done' : itemIndex === index ? 'active' : 'wait'
  }))
}

function routeFlowSteps(backendState, progressPercent = 0) {
  const progress = clamp(progressPercent, 0, 100)
  const names = ['动态压缩处理', '分级发送 / 发送端', '传输网络', '接收端', '解压缩处理']
  let activeIndex = {
    QUEUED: 0,
    PROFILING: 0,
    WAITING_NETWORK: 2,
    CACHED: 2,
    RETRYING: 2,
    TRANSMITTING: 2,
    VERIFYING: progress >= 99.9 ? 4 : 3,
    PAUSED: 2,
    FAILED: 2,
    CANCELLED: 2
  }[backendState]

  if (backendState === 'COMPLETED') {
    return names.map((name) => ({ name, status: 'done', text: '已完成' }))
  }
  if (activeIndex === undefined) {
    return names.map((name) => ({ name, status: 'waiting', text: '未开始' }))
  }

  return names.map((name, index) => {
    const status = index < activeIndex ? 'done' : index === activeIndex ? 'active' : 'waiting'
    return { name, status, text: status === 'done' ? '已完成' : status === 'active' ? '进行中' : '未开始' }
  })
}

export function linkState(network) {
  const quality = String(network?.quality || '').toUpperCase()
  const connection = String(network?.connectionState || '').toUpperCase()
  const state = quality || connection
  const labels = {
    GOOD: '正常',
    CONNECTED: '正常',
    FLUCTUATING: '波动',
    UNSTABLE: '波动',
    CONGESTED: '拥塞',
    DISCONNECTED: '波动',
    RECOVERING: '恢复中'
  }
  const tone = {
    GOOD: 'green',
    CONNECTED: 'green',
    FLUCTUATING: 'orange',
    UNSTABLE: 'orange',
    CONGESTED: 'orange',
    DISCONNECTED: 'orange',
    RECOVERING: 'blue'
  }[state] || 'blue'

  if (labels[state]) return { value: labels[state], tone }
  const normalizeStatusText = (value) => String(value || '').replace(/中断|断开|离线/g, '波动')
  if (/[\u4e00-\u9fa5]/.test(String(network?.quality || ''))) return { value: normalizeStatusText(network.quality), tone }
  if (/[\u4e00-\u9fa5]/.test(String(network?.connectionState || ''))) return { value: normalizeStatusText(network.connectionState), tone }
  return { value: '未知', tone }
}

function elapsedLabel(milliseconds) {
  const seconds = Math.max(0, Math.round((Number(milliseconds) || 0) / 1000))
  return `+${seconds}s`
}

function timestampLabel(value) {
  const date = value ? new Date(value) : new Date()
  if (Number.isNaN(date.getTime())) return '--:--'
  return date.toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

export class IntegrationBridge {
  constructor(options = {}) {
    this.options = { ...DEFAULTS, ...options }
    this.currentTaskId = null
    this.hiddenTaskIds = new Set()
    this.config = { fileId: '', mode: 'AUTO', algorithmId: 'ZSTD', level: '3', priority: '中' }
    this.uploads = new Map()
    this.chunkedUploads = new Map()
    this.rabbitMqSessions = new Map()
    this.rabbitMqWaiters = new Map()
    this.rabbitMqCompleted = new Map()
    this.rabbitMqFailures = new Map()
    this.rabbitMqConsumerChain = Promise.resolve()
    this.rabbitMqConnection = null
    this.rabbitMqProducerChannel = null
    this.rabbitMqConsumerChannel = null
    this.rabbitMqConnecting = null
    this.rabbitMqConsumerActive = false
    this.rabbitMqConsumerTag = ''
    this.amqpClient = options.amqpClient || null
    this.rabbitMqStats = { connected: false, message: 'RabbitMQ未连接', publishedMessages: 0, consumedMessages: 0, ackedMessages: 0, consumedBytes: 0, lastError: '', checkedAtMillis: 0, lastPublishedAtMillis: 0, lastConsumedAtMillis: 0 }
    this.preTransmissionDeliveries = new Map()
    this.receivedFrameGroups = new Map()
    this.remoteDeliveries = new Set()
    this.effectSnapshots = new Map()
    this.syncedTransferTasks = []
    this.syncedTransferAtMillis = 0
    this.syncedTransmissionDashboard = null
    this.syncedEffectDashboard = null
    this.syncedDashboardAtMillis = 0
    this.lastReceiverSyncAtMillis = 0
    this.receivedPackages = new Map()
    this.receivedPackageIndexLoaded = false
    this.openPath = typeof options.openPath === 'function' ? options.openPath : openPathInSystem
    this.remoteHealth = {
      connected: Boolean(this.options.receiverUrl),
      lastCheckedAtMillis: 0,
      lastSuccessAtMillis: this.options.receiverUrl ? Date.now() : 0,
      failureCount: 0,
      message: this.options.receiverUrl ? '接收端在线' : '未连接远端接收端'
    }
    const probeBytes = Math.max(1, Math.min(Math.max(16 * 1024, RECEIVER_RATE_PROBE_BYTES), this.options.uploadLimitBytes))
    this.remoteRateProbeBuffer = Buffer.alloc(probeBytes, 0xa5)
    this.remoteRateSample = { throughputKbps: 0, updatedAtMillis: 0, bytes: 0, durationMillis: 0 }
    this.remoteDelivery = {
      enabled: Boolean(this.options.receiverUrl),
      target: this.options.receiverUrl,
      state: this.options.receiverUrl ? 'ready' : 'local',
      message: this.options.receiverUrl ? '远端接收端已配置，任务完成后会自动投递恢复包' : '使用本机接收恢复服务',
      progress: 0,
      sentBytes: 0,
      totalBytes: 0,
      throughputKbps: 0
    }
  }

  isReceiverDisplayOnly() {
    return !this.options.receiverUrl && Number(this.options.port) !== DEFAULT_RECEIVER_BOOTSTRAP_PORT
  }

  storeSyncedDashboards(payload = {}) {
    const updatedAtMillis = Number(payload.updatedAtMillis || Date.now())
    if (updatedAtMillis < this.syncedDashboardAtMillis) return false
    if (Object.prototype.hasOwnProperty.call(payload, 'transmission')) {
      this.syncedTransmissionDashboard = payload.transmission && typeof payload.transmission === 'object'
        ? payload.transmission
        : null
    }
    if (Object.prototype.hasOwnProperty.call(payload, 'effect')) {
      const effect = payload.effect && typeof payload.effect === 'object'
        ? payload.effect
        : null
      const effectTaskId = String(effect?.taskId || effect?.task?.id || '').trim()
      const transmissionTaskId = String(this.syncedTransmissionDashboard?.task?.id || '').trim()
      this.syncedEffectDashboard = effect && !effectTaskId && transmissionTaskId
        ? { ...effect, taskId: transmissionTaskId }
        : effect
    }
    this.syncedDashboardAtMillis = updatedAtMillis
    return true
  }

  remoteDeliveryMatchesTask(task) {
    const taskId = String(task?.id || '').trim()
    const remoteTaskId = String(this.remoteDelivery?.taskId || '').trim()
    if (!taskId || !remoteTaskId || !this.remoteDelivery?.enabled) return false
    if (remoteTaskId === taskId) return true
    const taskIds = this.preTransmissionTaskIdsFor(taskId)
    return taskIds.length > 1 && taskIds.includes(remoteTaskId)
  }

  remoteDeliveryFinishedForTask(task) {
    return !this.remoteDeliveryMatchesTask(task) || this.remoteDelivery.state === 'delivered'
  }

  preTransmissionFrameIndexFor(taskId) {
    const info = this.preTransmissionDeliveries.get(String(taskId || ''))
    const index = Math.floor(Number(info?.frameIndex) || 0)
    return index > 0 ? index : Number.MAX_SAFE_INTEGER
  }

  preTransmissionTaskIdsFor(taskId) {
    const id = String(taskId || '').trim()
    if (!id) return []
    const info = this.preTransmissionDeliveries.get(id)
    if (!info) return [id]
    const groupId = String(info.groupId || '')
    const listed = Array.isArray(info.taskIds) ? info.taskIds : []
    const grouped = groupId
      ? [...this.preTransmissionDeliveries.entries()]
        .filter(([, item]) => String(item?.groupId || '') === groupId)
        .map(([entryId]) => entryId)
      : []
    return [...new Set([...listed, ...grouped, id].map((item) => String(item || '').trim()).filter(Boolean))]
      .sort((left, right) => this.preTransmissionFrameIndexFor(left) - this.preTransmissionFrameIndexFor(right))
  }

  samePreTransmissionGroup(leftTaskId, rightTaskId) {
    const left = String(leftTaskId || '').trim()
    const right = String(rightTaskId || '').trim()
    if (!left || !right) return false
    if (left === right) return true
    const leftInfo = this.preTransmissionDeliveries.get(left)
    const rightInfo = this.preTransmissionDeliveries.get(right)
    return Boolean(leftInfo?.groupId && rightInfo?.groupId && String(leftInfo.groupId) === String(rightInfo.groupId))
  }

  preTransmissionFrameSizeFor(taskId, info, task) {
    const frameIndex = this.preTransmissionFrameIndexFor(taskId)
    const frame = Array.isArray(info?.frames)
      ? info.frames.find((item) => Math.floor(Number(item?.index) || 0) === frameIndex)
      : null
    return Math.max(
      1,
      Math.floor(Number(this.preTransmissionDeliveries.get(String(taskId || ''))?.frameSize) || 0),
      Math.floor(Number(frame?.bytes) || 0),
      Math.floor(Number(task?.originalBytes) || 0),
      Math.floor(Number(task?.compressedBytes) || 0)
    )
  }

  aggregatePreTransmissionTask(taskId, tasks = []) {
    const ids = this.preTransmissionTaskIdsFor(taskId)
    if (ids.length <= 1) return null
    const primaryId = ids[0]
    const primaryInfo = this.preTransmissionDeliveries.get(primaryId) || this.preTransmissionDeliveries.get(String(taskId || '')) || {}
    const byId = new Map((Array.isArray(tasks) ? tasks : []).map((task) => [String(task?.id || ''), task]))
    const groupTasks = ids.map((id) => byId.get(id)).filter(Boolean)
    if (!groupTasks.length) return null

    const frameCount = Math.max(1, Math.floor(Number(primaryInfo.frameCount) || ids.length))
    const completedFrameCount = ids.filter((id) => String(byId.get(id)?.state || '').toUpperCase() === 'COMPLETED').length
    const failed = groupTasks.find((task) => String(task?.state || '').toUpperCase() === 'FAILED')
    const cancelled = groupTasks.find((task) => String(task?.state || '').toUpperCase() === 'CANCELLED')
    const paused = groupTasks.find((task) => String(task?.state || '').toUpperCase() === 'PAUSED')
    const active = groupTasks.find((task) => ACTIVE_STATES.has(String(task?.state || '').toUpperCase()))
    const representative = active || groupTasks.find((task) => String(task?.state || '').toUpperCase() !== 'COMPLETED') || groupTasks[groupTasks.length - 1]

    let state = 'QUEUED'
    if (failed) state = 'FAILED'
    else if (cancelled) state = 'CANCELLED'
    else if (completedFrameCount >= frameCount && groupTasks.length >= frameCount) state = 'COMPLETED'
    else if (paused) state = 'PAUSED'
    else if (active || completedFrameCount > 0) state = 'TRANSMITTING'

    const weighted = ids.map((id) => {
      const task = byId.get(id)
      const info = this.preTransmissionDeliveries.get(id) || primaryInfo
      const size = this.preTransmissionFrameSizeFor(id, info, task)
      const taskState = String(task?.state || '').toUpperCase()
      const taskProgress = taskState === 'COMPLETED' ? 100 : clamp(Number(task?.progressPercent) || 0, 0, 100)
      return { size, done: size * taskProgress / 100 }
    })
    const totalWeight = weighted.reduce((sum, item) => sum + item.size, 0) || frameCount
    const doneWeight = weighted.reduce((sum, item) => sum + item.done, 0)
    const progressPercent = state === 'COMPLETED' ? 100 : round(clamp(doneWeight * 100 / Math.max(totalWeight, 1), 0, 99.9), 1)
    const positiveMin = (values) => {
      const filtered = values.map(Number).filter((value) => Number.isFinite(value) && value > 0)
      return filtered.length ? Math.min(...filtered) : 0
    }
    const positiveMax = (values) => {
      const filtered = values.map(Number).filter((value) => Number.isFinite(value) && value > 0)
      return filtered.length ? Math.max(...filtered) : 0
    }
    const originalBytes = Math.max(0, Number(primaryInfo.totalBytes) || weighted.reduce((sum, item) => sum + item.size, 0))
    const compressedBytes = groupTasks.reduce((sum, task) => sum + Math.max(0, Number(task?.compressedBytes) || 0), 0)
    const chunks = groupTasks.flatMap((task) => {
      const frameIndex = this.preTransmissionFrameIndexFor(task?.id)
      return (Array.isArray(task?.chunks) ? task.chunks : []).map((chunk) => ({ ...chunk, frameIndex }))
    }).slice(-80)
    const message = state === 'COMPLETED'
      ? `预传输帧全部完成：${completedFrameCount}/${frameCount}`
      : failed?.message || cancelled?.message || paused?.message || `预传输帧传输中：${completedFrameCount}/${frameCount}`

    return {
      ...representative,
      id: primaryId,
      fileName: preTransmissionPackageDisplayName(primaryInfo, String(representative?.fileName || '').replace(/-frame-\d+$/i, '') || '预传输帧数据包'),
      packageKind: String(primaryInfo.packageKind || representative?.packageKind || 'FILE').toUpperCase() === 'FOLDER' ? 'FOLDER' : 'FILE',
      itemCount: Math.max(1, Array.isArray(primaryInfo.sourceFiles) && primaryInfo.sourceFiles.length ? primaryInfo.sourceFiles.length : Number(representative?.itemCount) || 1),
      originalBytes,
      compressedBytes,
      progressPercent,
      state,
      currentDecision: representative?.currentDecision || groupTasks.find((task) => task?.currentDecision)?.currentDecision,
      totalChunks: frameCount,
      completedChunks: completedFrameCount,
      retryCount: groupTasks.reduce((sum, task) => sum + Math.max(0, Number(task?.retryCount) || 0), 0),
      queuedAtMillis: positiveMin(groupTasks.map((task) => task?.queuedAtMillis)),
      startedAtMillis: positiveMin(groupTasks.map((task) => task?.startedAtMillis || task?.queuedAtMillis)),
      completedAtMillis: state === 'COMPLETED' ? positiveMax(groupTasks.map((task) => task?.completedAtMillis)) : 0,
      totalCompressionMillis: groupTasks.reduce((sum, task) => sum + Math.max(0, Number(task?.totalCompressionMillis) || 0), 0),
      totalTransferMillis: groupTasks.reduce((sum, task) => sum + Math.max(0, Number(task?.totalTransferMillis) || 0), 0),
      totalDecompressionMillis: groupTasks.reduce((sum, task) => sum + Math.max(0, Number(task?.totalDecompressionMillis) || 0), 0),
      integrityPassed: state === 'COMPLETED' ? groupTasks.every((task) => task?.integrityPassed !== false) : true,
      message,
      chunks,
      preTransmission: {
        enabled: true,
        groupId: primaryInfo.groupId,
        frameCount,
        completedFrameCount,
        taskIds: ids
      }
    }
  }

  nextReceiverSyncAtMillis() {
    const now = Date.now()
    this.lastReceiverSyncAtMillis = Math.max(now, this.lastReceiverSyncAtMillis + 1)
    return this.lastReceiverSyncAtMillis
  }

  async backend(pathname, init = {}) {
    const response = await fetch(`${this.options.backendUrl}${pathname}`, {
      ...init,
      headers: { Accept: 'application/json', ...(init.headers || {}) }
    })
    return parseBackendResponse(response)
  }


  async probeReceiver(targetUrl = this.options.receiverUrl, timeoutMillis = RECEIVER_HEALTH_TIMEOUT_MS) {
    if (!targetUrl) throw new Error('未配置远端接收端')
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMillis)
    try {
      const response = await fetch(targetUrl + '/api/receiver/status', { signal: controller.signal, headers: { Accept: 'application/json' } })
      if (!response.ok) throw new Error('远端接收端不可访问')
      const payload = await response.json().catch(() => null)
      if (payload?.code !== 0 || payload?.data?.online === false) throw new Error('远端接收端未就绪')
      return payload?.data || {}
    } finally {
      clearTimeout(timer)
    }
  }

  async publishReceiverTelemetry(throughputKbps, durationMillis = 1) {
    const rate = Math.max(0, Number(throughputKbps) || 0)
    if (!rate) return
    try {
      await this.backend('/api/network/telemetry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          timestamp: new Date().toISOString(),
          throughputKbps: rate,
          rttMillis: Math.max(1, Number(durationMillis) || 1),
          jitterMillis: 0,
          packetLossPercent: 0,
          retransmissions: 0,
          connectionState: 'CONNECTED',
          quality: 'GOOD',
          queuedBytes: 0,
          cachedTasks: 0,
          cpuPercent: 0,
          memoryPercent: 0,
          externallyMeasured: true
        })
      })
    } catch {
      // The dashboard can still use the measured bridge-side rate if backend telemetry is unavailable.
    }
  }

  async restoreBackendSimulation() {
    try { await this.backend('/api/network/simulation?enabled=true', { method: 'POST' }) } catch {}
  }

  async measureReceiverThroughput({ force = false } = {}) {
    if (!this.options.receiverUrl || !this.remoteHealth.connected) return 0
    const now = Date.now()
    if (!force && now - Number(this.remoteRateSample.updatedAtMillis || 0) < RECEIVER_RATE_PROBE_INTERVAL_MS) {
      return Number(this.remoteRateSample.throughputKbps) || 0
    }

    const body = this.remoteRateProbeBuffer
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), RECEIVER_RATE_PROBE_TIMEOUT_MS)
    const startedAtMillis = Date.now()
    try {
      const response = await fetch(`${this.options.receiverUrl}/api/receiver/speed-probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': String(body.length) },
        body,
        signal: controller.signal
      })
      const durationMillis = Math.max(1, Date.now() - startedAtMillis)
      if (!response.ok) throw new Error(`接收端测速失败：${response.status}`)
      const payload = await response.json().catch(() => null)
      if (payload?.code !== 0) throw new Error(payload?.message || '接收端测速失败')
      const bytes = Math.max(0, Number(payload?.data?.bytes) || body.length)
      const throughputKbps = bytes * 8 / durationMillis
      this.remoteRateSample = { throughputKbps, updatedAtMillis: Date.now(), bytes, durationMillis }
      this.markReceiverConnected(this.options.receiverUrl)
      await this.publishReceiverTelemetry(throughputKbps, durationMillis)
      return throughputKbps
    } catch {
      try {
        await this.probeReceiver(this.options.receiverUrl, RECEIVER_HEALTH_TIMEOUT_MS)
        this.markReceiverConnected(this.options.receiverUrl)
      } catch (error) {
        const failureCount = Number(this.remoteHealth.failureCount || 0) + 1
        this.remoteHealth = {
          ...this.remoteHealth,
          connected: failureCount < RECEIVER_HEALTH_FAILURE_LIMIT,
          failureCount,
          message: error instanceof Error ? error.message : '接收端连接异常'
        }
        if (failureCount >= RECEIVER_HEALTH_FAILURE_LIMIT) await this.markReceiverDisconnected('接收端连接已断开，当前任务已暂停', { clearReceiverUrl: false })
      }
      return Number(this.remoteRateSample.throughputKbps) || 0
    } finally {
      clearTimeout(timer)
    }
  }

  markReceiverConnected(targetUrl = this.options.receiverUrl) {
    const now = Date.now()
    this.remoteHealth = {
      connected: true,
      lastCheckedAtMillis: now,
      lastSuccessAtMillis: now,
      failureCount: 0,
      message: '接收端在线'
    }
    if (!this.remoteDelivery.enabled || ['local', 'disconnected', 'failed'].includes(this.remoteDelivery.state)) {
      this.remoteDelivery = { enabled: true, target: targetUrl, state: 'ready', message: '远端接收端已连接，任务完成后会自动投递恢复包', progress: 0, sentBytes: 0, totalBytes: 0, throughputKbps: 0 }
    } else {
      this.remoteDelivery = { ...this.remoteDelivery, enabled: true, target: targetUrl }
    }
  }

  async pauseCurrentTaskForReceiverLoss() {
    try {
      const task = await this.currentTask()
      if (!task?.id || mapTaskState(task.state).state !== 'RUNNING') return null
      const paused = await this.backend(`/api/tasks/${encodeURIComponent(task.id)}/pause`, { method: 'POST' })
      this.currentTaskId = paused.id || task.id
      return paused
    } catch {
      return null
    }
  }

  async markReceiverDisconnected(reason = '接收端连接已断开，当前任务已暂停', { pauseTask = true, clearReceiverUrl = false } = {}) {
    const target = this.options.receiverUrl || this.remoteDelivery.target || ''
    if (clearReceiverUrl) this.options.receiverUrl = ''
    this.remoteHealth = {
      connected: false,
      lastCheckedAtMillis: Date.now(),
      lastSuccessAtMillis: this.remoteHealth.lastSuccessAtMillis || 0,
      failureCount: Math.max(1, this.remoteHealth.failureCount || 0),
      message: reason
    }
    this.remoteDelivery = {
      enabled: false,
      target,
      state: 'disconnected',
      message: reason,
      progress: 0,
      sentBytes: 0,
      totalBytes: 0,
      throughputKbps: 0,
      updatedAtMillis: Date.now()
    }
    this.remoteRateSample = { throughputKbps: 0, updatedAtMillis: 0, bytes: 0, durationMillis: 0 }
    await this.restoreBackendSimulation()
    const pausedTask = pauseTask ? await this.pauseCurrentTaskForReceiverLoss() : null
    return { success: true, paused: Boolean(pausedTask), task: pausedTask, message: pausedTask ? reason : '已断开远端接收端连接' }
  }

  async refreshReceiverLink({ force = false } = {}) {
    if (!this.options.receiverUrl) return false
    const now = Date.now()
    if (!force && now - Number(this.remoteHealth.lastCheckedAtMillis || 0) < RECEIVER_HEALTH_CHECK_INTERVAL_MS) {
      return Boolean(this.remoteHealth.connected)
    }
    const wasConnected = Boolean(this.remoteHealth.connected)
    this.remoteHealth = { ...this.remoteHealth, lastCheckedAtMillis: now }
    try {
      await this.probeReceiver(this.options.receiverUrl, RECEIVER_HEALTH_TIMEOUT_MS)
      this.markReceiverConnected(this.options.receiverUrl)
      if (!wasConnected) this.pushReceiverTaskSync().catch(() => {})
      return true
    } catch (error) {
      const failureCount = Number(this.remoteHealth.failureCount || 0) + 1
      const message = error instanceof Error ? error.message : '接收端连接异常'
      this.remoteHealth = { ...this.remoteHealth, connected: failureCount < RECEIVER_HEALTH_FAILURE_LIMIT, failureCount, message }
      if (failureCount >= RECEIVER_HEALTH_FAILURE_LIMIT) {
        await this.markReceiverDisconnected('接收端连接已断开，当前任务已暂停', { clearReceiverUrl: false })
        return false
      }
      return Boolean(this.remoteHealth.connected)
    }
  }

  async connectReceiver(address) {
    const target = normalizeReceiverAddress(address)
    try {
      await this.probeReceiver(target.url, 5000)
      this.options.receiverUrl = target.url
      this.markReceiverConnected(target.url)
      await this.measureReceiverThroughput({ force: true })
      await this.pushReceiverTaskSync()
      return { success: true, address: target.address, message: '连接成功，远端接收机：' + target.address }
    } catch (error) {
      if (error instanceof Error && ['接收端地址格式不正确', '接收端端口不正确'].includes(error.message)) throw error
      throw new Error('连接失败，请检查IP地址、网络、接收端服务是否启动')
    }
  }

  async disconnectReceiver() {
    const target = this.options.receiverUrl || this.remoteDelivery.target || ''
    const result = await this.markReceiverDisconnected('已断开远端接收端连接，当前任务已暂停', { pauseTask: true, clearReceiverUrl: true })
    await this.clearReceiverDisplay(target)
    return { success: true, paused: result.paused, message: result.message }
  }

  async clearReceiverDisplay(targetUrl) {
    const target = String(targetUrl || '').replace(/\/$/, '')
    if (!target) return
    const updatedAtMillis = this.nextReceiverSyncAtMillis()
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), Number(process.env.RECEIVER_SYNC_TIMEOUT_MS || 2500))
    try {
      await fetch(`${target}/api/receiver/task-sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tasks: [],
          replace: true,
          dashboards: { transmission: null, effect: null, updatedAtMillis },
          updatedAtMillis
        }),
        signal: controller.signal
      })
    } catch {
      // Best effort only; the sender still clears its local connection state.
    } finally {
      clearTimeout(timer)
    }
  }

  async files() {
    const items = []

    try {
      const entries = await readdir(this.options.sampleDataDir, { withFileTypes: true })
      for (const entry of entries) {
        if (!entry.isFile() || entry.name.startsWith('.')) continue
        const absolutePath = path.join(this.options.sampleDataDir, entry.name)
        const metadata = await stat(absolutePath)
        items.push({
          id: entry.name,
          name: entry.name,
          label: '',
          size: formatBytes(metadata.size),
          bytes: metadata.size,
          type: fileTypeFor(entry.name),
          description: '由系统网关提交给后端服务执行真实识别、压缩、传输与校验',
          absolutePath
        })
      }
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }

    for (const [id, item] of this.uploads) {
      try {
        if (Array.isArray(item.files) && item.files.length) {
          const metadata = await Promise.all(item.files.map((entry) => stat(entry.absolutePath)))
          const bytes = metadata.reduce((sum, entry) => sum + entry.size, 0)
          items.push({ ...item, bytes, size: formatBytes(bytes), itemCount: item.files.length })
        } else {
          const metadata = await stat(item.absolutePath)
          items.push({ ...item, bytes: metadata.size, size: formatBytes(metadata.size), itemCount: 1 })
        }
      } catch {
        this.uploads.delete(id)
      }
    }

    items.sort((a, b) => {
      const uploadOrder = Number(b.id.startsWith('upload:')) - Number(a.id.startsWith('upload:'))
      return uploadOrder || a.name.localeCompare(b.name, 'zh-CN')
    })
    if (!items.length) throw new Error('没有可用文件，请先选择本地文件，或把示例文件放入 backend/sample-data')
    if (!items.some((item) => item.id === this.config.fileId)) this.config.fileId = items[0].id
    return items
  }

  ingressTokenFromRequest(request) {
    return headerValue(request.headers, 'x-ingress-token')
      || headerValue(request.headers, 'ingress_token')
      || headerValue(request.headers, 'ingress-token')
  }

  assertIngressAllowed(request) {
    const token = String(this.options.ingressToken || '')
    if (token) {
      if (this.ingressTokenFromRequest(request) !== token) throw new Error('接入令牌无效')
      return
    }
    if (!isLocalRemoteAddress(request.socket?.remoteAddress)) {
      throw new Error('外部接入未启用，请配置接入令牌后再接入')
    }
  }

  rabbitMqQueueName() {
    return String(this.options.rabbitmqQueue || 'datacompress.message.queue').trim() || 'datacompress.message.queue'
  }

  rabbitMqChunkBytes() {
    const configured = Math.floor(Number(this.options.rabbitmqChunkBytes) || 1024 * 1024)
    return Math.max(64 * 1024, Math.min(configured, 16 * 1024 * 1024))
  }

  redactedRabbitMqUrl() {
    try {
      const parsed = new URL(this.options.rabbitmqUrl)
      const pathSuffix = parsed.pathname && parsed.pathname !== '/' ? parsed.pathname : ''
      return `${parsed.protocol}//${parsed.host}${pathSuffix}`
    } catch {
      return 'amqp://127.0.0.1:5672'
    }
  }

  markRabbitMqDisconnected(message = 'RabbitMQ未连接') {
    this.rabbitMqProducerChannel = null
    this.rabbitMqConsumerChannel = null
    this.rabbitMqConnection = null
    this.rabbitMqConsumerActive = false
    this.rabbitMqStats = {
      ...this.rabbitMqStats,
      connected: false,
      message,
      lastError: message,
      checkedAtMillis: Date.now()
    }
  }

  async loadAmqpClient() {
    if (this.amqpClient) return this.amqpClient
    try {
      const module = await import('amqplib')
      this.amqpClient = module.default || module
      return this.amqpClient
    } catch {
      throw new Error('RabbitMQ客户端 amqplib 未安装，请在 bridge 目录运行 npm install')
    }
  }

  async ensureRabbitMqConnection() {
    if (this.rabbitMqConnection && this.rabbitMqProducerChannel && this.rabbitMqConsumerChannel) return true
    if (this.rabbitMqConnecting) return this.rabbitMqConnecting
    this.rabbitMqConnecting = (async () => {
      const amqp = await this.loadAmqpClient()
      const queue = this.rabbitMqQueueName()
      const connection = await amqp.connect(this.options.rabbitmqUrl)
      connection.on?.('error', (error) => {
        this.rabbitMqStats.lastError = error instanceof Error ? error.message : String(error)
      })
      connection.on?.('close', () => this.markRabbitMqDisconnected('RabbitMQ连接已关闭'))

      const producerChannel = await connection.createConfirmChannel()
      await producerChannel.assertQueue(queue, { durable: true })
      const consumerChannel = typeof connection.createChannel === 'function'
        ? await connection.createChannel()
        : await connection.createConfirmChannel()
      await consumerChannel.assertQueue(queue, { durable: true })
      await consumerChannel.prefetch?.(1)

      this.rabbitMqConnection = connection
      this.rabbitMqProducerChannel = producerChannel
      this.rabbitMqConsumerChannel = consumerChannel
      this.rabbitMqStats = {
        ...this.rabbitMqStats,
        connected: true,
        message: 'RabbitMQ已连接',
        lastError: '',
        checkedAtMillis: Date.now()
      }
      await this.ensureRabbitMqConsumer()
      return true
    })().catch((error) => {
      const message = error instanceof Error ? error.message : String(error)
      const reason = message.startsWith('RabbitMQ') ? message : `RabbitMQ未连接：${message}`
      this.markRabbitMqDisconnected(reason)
      throw new Error(reason)
    }).finally(() => {
      this.rabbitMqConnecting = null
    })
    return this.rabbitMqConnecting
  }

  async ensureRabbitMqConsumer() {
    if (this.rabbitMqConsumerActive) return
    const channel = this.rabbitMqConsumerChannel
    if (!channel) throw new Error('RabbitMQ Consumer通道未初始化')
    const queue = this.rabbitMqQueueName()
    const result = await channel.consume(queue, (message) => {
      this.rabbitMqConsumerChain = this.rabbitMqConsumerChain
        .then(() => this.processRabbitMqDelivery(channel, message))
        .catch((error) => {
          const reason = error instanceof Error ? error.message : String(error)
          this.rabbitMqStats.lastError = reason
          this.rabbitMqStats.message = reason
        })
    }, { noAck: false })
    this.rabbitMqConsumerActive = true
    this.rabbitMqConsumerTag = result?.consumerTag || ''
  }

  async processRabbitMqDelivery(channel, message) {
    if (!message) return
    const headers = message.properties?.headers || {}
    const uploadId = String(headers.uploadId || headers['x-upload-id'] || '').trim()
    try {
      await this.handleRabbitMqMessage(message)
      channel.ack(message)
      this.rabbitMqStats.ackedMessages += 1
      this.rabbitMqStats.message = 'RabbitMQ已连接'
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      this.rabbitMqStats.lastError = reason
      this.rabbitMqStats.message = reason
      if (uploadId) {
        this.rabbitMqSessions.delete(uploadId)
        this.rejectRabbitMqIngest(uploadId, error)
      }
      try {
        if (typeof channel.nack === 'function') channel.nack(message, false, false)
        else channel.ack(message)
      } catch (ackError) {
        const ackReason = ackError instanceof Error ? ackError.message : String(ackError)
        this.rabbitMqStats.lastError = ackReason
        this.rabbitMqStats.message = ackReason
      }
    }
  }

  async publishRabbitMqMessage(type, uploadId, content = Buffer.alloc(0), headers = {}) {
    await this.ensureRabbitMqConnection()
    const channel = this.rabbitMqProducerChannel
    if (!channel) throw new Error('RabbitMQ Producer通道未初始化')
    const queue = this.rabbitMqQueueName()
    const body = Buffer.isBuffer(content) ? content : Buffer.from(content || [])
    const properties = {
      persistent: true,
      contentType: headers.contentType || 'application/octet-stream',
      messageId: headers.messageId || `${uploadId}:${type}:${Date.now()}:${this.rabbitMqStats.publishedMessages + 1}`,
      correlationId: uploadId,
      timestamp: Math.floor(Date.now() / 1000),
      headers: {
        ...headers,
        type,
        uploadId,
        queue,
        sourceProtocol: 'RabbitMQ'
      }
    }

    if (channel.sendToQueue.length >= 4) {
      await new Promise((resolve, reject) => {
        try {
          channel.sendToQueue(queue, body, properties, (error) => error ? reject(error) : resolve())
        } catch (error) {
          reject(error)
        }
      })
    } else {
      channel.sendToQueue(queue, body, properties)
      if (typeof channel.waitForConfirms === 'function') await channel.waitForConfirms()
    }
    this.rabbitMqStats.publishedMessages += 1
    this.rabbitMqStats.lastPublishedAtMillis = Date.now()
    return { queue, bytes: body.length, type, uploadId }
  }

  waitRabbitMqIngest(uploadId) {
    const failed = this.rabbitMqFailures.get(uploadId)
    if (failed) {
      this.rabbitMqFailures.delete(uploadId)
      return Promise.reject(failed)
    }
    const completed = this.rabbitMqCompleted.get(uploadId)
    if (completed) {
      this.rabbitMqCompleted.delete(uploadId)
      return Promise.resolve(completed)
    }
    const existing = this.rabbitMqWaiters.get(uploadId)
    if (existing) return existing.promise
    let waiter
    const promise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.rabbitMqWaiters.delete(uploadId)
        reject(new Error('RabbitMQ Consumer接收超时，请检查Broker和Consumer状态'))
      }, RABBITMQ_INGEST_TIMEOUT_MS)
      waiter = {
        promise: null,
        resolve: (value) => {
          clearTimeout(timer)
          this.rabbitMqWaiters.delete(uploadId)
          resolve(value)
        },
        reject: (error) => {
          clearTimeout(timer)
          this.rabbitMqWaiters.delete(uploadId)
          reject(error)
        }
      }
    })
    waiter.promise = promise
    this.rabbitMqWaiters.set(uploadId, waiter)
    return promise
  }

  resolveRabbitMqIngest(uploadId, result) {
    this.rabbitMqFailures.delete(uploadId)
    const waiter = this.rabbitMqWaiters.get(uploadId)
    if (waiter) waiter.resolve(result)
    else this.rabbitMqCompleted.set(uploadId, result)
  }

  rejectRabbitMqIngest(uploadId, error) {
    const normalized = error instanceof Error ? error : new Error(String(error))
    const waiter = this.rabbitMqWaiters.get(uploadId)
    if (waiter) waiter.reject(normalized)
    else this.rabbitMqFailures.set(uploadId, normalized)
  }

  async beginRabbitMqIngest(payload = {}) {
    await this.ensureRabbitMqConnection()
    const inputFiles = Array.isArray(payload.files) ? payload.files : []
    if (!inputFiles.length) throw new Error('请选择要发送到RabbitMQ的文件')
    if (inputFiles.length > MAX_PACKAGE_FILE_COUNT) throw new Error(`文件夹最多支持 ${MAX_PACKAGE_FILE_COUNT} 个文件`)

    const normalizedFiles = inputFiles.map((file, index) => {
      const relativePath = safeRelativePath(file?.relativePath || file?.name || `file-${index + 1}.bin`)
      const bytes = Math.max(0, Math.floor(Number(file?.size) || 0))
      return {
        index,
        name: safeFileName(file?.name || path.basename(relativePath) || `file-${index + 1}.bin`),
        relativePath,
        contentType: String(file?.type || contentTypeFor(relativePath)),
        bytes,
        receivedBytes: 0
      }
    })
    const totalBytes = normalizedFiles.reduce((sum, file) => sum + file.bytes, 0)
    if (!totalBytes) throw new Error('接入数据为空')
    if (totalBytes > this.options.uploadLimitBytes) throw new Error(`数据包超过 ${formatBytes(this.options.uploadLimitBytes)} 限制`)
    const frameBytes = this.normalizedPreTransmissionFrameBytes(payload.frameBytes)
    const maxFrames = MAX_PRE_TRANSMISSION_FRAME_COUNT
    const estimatedFrames = Math.ceil(totalBytes / frameBytes)
    if (estimatedFrames > maxFrames) throw new Error(`预传输帧数量超过 ${maxFrames} 个限制`)

    const uploadId = `rabbitmq:${randomUUID()}`
    const packageKind = String(payload.packageKind || '').toUpperCase() === 'FOLDER' || normalizedFiles.length > 1 ? 'FOLDER' : 'FILE'
    const fallbackPackageName = packageKind === 'FOLDER'
      ? (normalizedFiles[0].relativePath.split('/')[0] || 'message-queue-folder')
      : (normalizedFiles[0].name || 'message-queue-stream.bin')
    const packageName = packageKind === 'FOLDER'
      ? safeFileName(payload.packageName || fallbackPackageName)
      : normalizeIngressPackageName(payload.packageName || fallbackPackageName, 'message-queue-stream.bin')
    const chunkBytes = this.rabbitMqChunkBytes()
    const sourceFiles = normalizedFiles.map((file) => ({
      index: file.index,
      name: file.name,
      relativePath: file.relativePath,
      size: file.bytes,
      bytes: file.bytes,
      type: file.contentType,
      contentType: file.contentType
    }))
    await this.publishRabbitMqMessage('start', uploadId, Buffer.from(JSON.stringify({ sourceFiles }), 'utf8'), {
      packageName,
      packageKind,
      fileName: normalizedFiles[0].name,
      relativePath: normalizedFiles[0].relativePath,
      contentType: normalizedFiles[0].contentType,
      originalFileCount: normalizedFiles.length,
      totalBytes,
      frameBytes,
      chunkBytes,
      sourceName: 'RabbitMQ Broker'
    })
    return {
      success: true,
      uploadId,
      queue: this.rabbitMqQueueName(),
      chunkBytes,
      frameBytes,
      totalBytes,
      fileCount: normalizedFiles.length,
      message: 'RabbitMQ接入会话已创建，请继续发送文件或文件夹分块'
    }
  }
  async appendRabbitMqChunk(request) {
    const uploadId = headerValue(request.headers, 'x-upload-id')
    if (!uploadId) throw new Error('RabbitMQ上传会话不能为空')
    const declaredOffset = Math.max(0, Math.floor(Number(headerValue(request.headers, 'x-file-offset')) || 0))
    const fileIndexHeader = headerValue(request.headers, 'x-file-index')
    const hasFileIndex = fileIndexHeader !== ''
    const fileIndex = Math.max(0, Math.floor(Number(fileIndexHeader) || 0))
    const chunkLimit = this.rabbitMqChunkBytes() + 64 * 1024
    const contentLength = Number(request.headers['content-length'] || 0)
    if (contentLength > chunkLimit) throw new Error(`RabbitMQ分块超过 ${formatBytes(chunkLimit)} 限制`)

    let requestBytes = 0
    for await (const raw of request) {
      const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw)
      const requestChunkOffset = requestBytes
      requestBytes += chunk.length
      if (requestBytes > chunkLimit) throw new Error(`RabbitMQ分块超过 ${formatBytes(chunkLimit)} 限制`)
      let offset = 0
      while (offset < chunk.length) {
        const length = Math.min(this.rabbitMqChunkBytes(), chunk.length - offset)
        const part = chunk.subarray(offset, offset + length)
        const partOffset = declaredOffset + requestChunkOffset + offset
        const chunkHeaders = {
          offset: partOffset,
          bytes: part.length,
          contentType: headerValue(request.headers, 'content-type') || 'application/octet-stream'
        }
        if (hasFileIndex) {
          chunkHeaders.fileIndex = fileIndex
          chunkHeaders.fileOffset = partOffset
        }
        await this.publishRabbitMqMessage('chunk', uploadId, part, chunkHeaders)
        offset += length
      }
    }
    return {
      success: true,
      uploadId,
      publishedBytes: requestBytes,
      message: 'RabbitMQ文件分块已发布'
    }
  }
  async completeRabbitMqIngest(payload = {}) {
    const uploadId = String(payload.uploadId || '').trim()
    if (!uploadId) throw new Error('RabbitMQ上传会话不能为空')
    const waitForConsumer = this.waitRabbitMqIngest(uploadId)
    waitForConsumer.catch(() => {})
    await this.publishRabbitMqMessage('complete', uploadId, Buffer.alloc(0), {
      totalBytes: Math.max(0, Math.floor(Number(payload.totalBytes) || 0)),
      sourceName: 'RabbitMQ Broker'
    })
    return await waitForConsumer
  }

  async ingestRabbitMqStreamPackage(request) {
    this.assertIngressAllowed(request)
    await this.ensureRabbitMqConnection()
    const requestUrl = new URL(request.url || '/', 'http://localhost')
    const uploadId = `rabbitmq:${randomUUID()}`
    const frameBytes = this.preTransmissionFrameBytes(requestUrl, request)
    const contentLength = Math.max(0, Number(request.headers['content-length'] || 0))
    const maxPayloadBytes = Math.min(this.options.uploadLimitBytes, frameBytes * MAX_PRE_TRANSMISSION_FRAME_COUNT)
    if (contentLength > maxPayloadBytes) throw new Error(`接入数据超过 ${formatBytes(maxPayloadBytes)} 限制`)
    const packageName = normalizeIngressPackageName(requestUrl.searchParams.get('packageName') || headerValue(request.headers, 'x-package-name'), 'message-queue-stream.bin')
    await this.publishRabbitMqMessage('start', uploadId, Buffer.alloc(0), {
      packageName,
      packageKind: 'FILE',
      fileName: packageName,
      relativePath: packageName,
      contentType: headerValue(request.headers, 'content-type') || contentTypeFor(packageName),
      totalBytes: contentLength,
      frameBytes,
      chunkBytes: this.rabbitMqChunkBytes(),
      sourceName: 'RabbitMQ Broker'
    })

    let totalBytes = 0
    for await (const raw of request) {
      const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw)
      totalBytes += chunk.length
      if (totalBytes > maxPayloadBytes) throw new Error(`接入数据超过 ${formatBytes(maxPayloadBytes)} 限制`)
      let offset = 0
      while (offset < chunk.length) {
        const length = Math.min(this.rabbitMqChunkBytes(), chunk.length - offset)
        await this.publishRabbitMqMessage('chunk', uploadId, chunk.subarray(offset, offset + length), {
          offset: totalBytes - chunk.length + offset,
          bytes: length,
          contentType: headerValue(request.headers, 'content-type') || 'application/octet-stream'
        })
        offset += length
      }
    }
    const waitForConsumer = this.waitRabbitMqIngest(uploadId)
    waitForConsumer.catch(() => {})
    await this.publishRabbitMqMessage('complete', uploadId, Buffer.alloc(0), { totalBytes, sourceName: 'RabbitMQ Broker' })
    return await waitForConsumer
  }

  async handleRabbitMqMessage(message) {
    const headers = message.properties?.headers || {}
    const type = String(headers.type || '').trim()
    const uploadId = String(headers.uploadId || '').trim()
    if (!type || !uploadId) throw new Error('RabbitMQ消息缺少类型或上传会话')
    if (type === 'start') return this.startRabbitMqConsumerSession(uploadId, headers, message.content)
    if (type === 'chunk') return this.appendRabbitMqConsumerChunk(uploadId, headers, message.content)
    if (type === 'complete') return this.completeRabbitMqConsumerSession(uploadId, headers)
    throw new Error(`不支持的RabbitMQ消息类型：${type}`)
  }

  async startRabbitMqConsumerSession(uploadId, headers = {}, content = Buffer.alloc(0)) {
    await mkdir(this.options.uploadsDir, { recursive: true })
    const id = uploadId
    const groupDir = path.join(this.options.uploadsDir, safeFileName(uploadId.replace(/^rabbitmq:/, '')))
    await mkdir(path.join(groupDir, 'frames'), { recursive: true })
    const headerPackageKind = String(headers.packageKind || '').toUpperCase()
    const packageName = headerPackageKind === 'FOLDER'
      ? safeFileName(headers.packageName || 'message-queue-folder')
      : normalizeIngressPackageName(headers.packageName, 'message-queue-stream.bin')
    const totalBytes = Math.max(0, Math.floor(Number(headers.totalBytes) || 0))
    const frameBytes = this.normalizedPreTransmissionFrameBytes(headers.frameBytes)
    const files = this.rabbitMqSourceFilesFromHeaders(headers, packageName, totalBytes, content)
    const packageKind = headerPackageKind === 'FOLDER' || files.length > 1 ? 'FOLDER' : 'FILE'
    const session = {
      id,
      uploadId,
      groupDir,
      packageName,
      packageKind,
      files,
      frameBytes,
      totalBytes,
      receivedBytes: 0,
      frames: [],
      startedAt: new Date().toISOString()
    }
    this.rabbitMqSessions.set(uploadId, session)
    this.rabbitMqStats.consumedMessages += 1
    this.rabbitMqStats.lastConsumedAtMillis = Date.now()
    return session
  }

  rabbitMqSourceFilesFromHeaders(headers = {}, packageName = 'message-queue-stream.bin', totalBytes = 0, content = Buffer.alloc(0)) {
    let parsed = []
    const contentBuffer = Buffer.isBuffer(content) ? content : Buffer.from(content || [])
    const raw = contentBuffer.length ? contentBuffer : (headers.sourceFiles || headers.sourceFilesJson || headers.files)
    if (raw) {
      try {
        const text = Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw)
        const value = JSON.parse(text)
        if (Array.isArray(value)) parsed = value
        else if (Array.isArray(value?.sourceFiles)) parsed = value.sourceFiles
      } catch {
        parsed = []
      }
    }

    const files = parsed.slice(0, MAX_PACKAGE_FILE_COUNT).map((file, index) => {
      const relativePath = safeRelativePath(file?.relativePath || file?.name || `file-${index + 1}.bin`)
      const bytes = Math.max(0, Math.floor(Number(file?.bytes) || Number(file?.size) || 0))
      return {
        index: Number.isInteger(Number(file?.index)) ? Math.max(0, Math.floor(Number(file.index))) : index,
        name: safeFileName(file?.name || path.basename(relativePath) || `file-${index + 1}.bin`),
        relativePath,
        contentType: String(file?.contentType || file?.type || contentTypeFor(relativePath)),
        bytes,
        receivedBytes: 0
      }
    })

    if (files.length) return files.sort((a, b) => a.index - b.index).map((file, index) => ({ ...file, index }))
    return [{
      index: 0,
      name: safeFileName(headers.fileName || packageName),
      relativePath: safeRelativePath(headers.relativePath || headers.fileName || packageName),
      contentType: String(headers.contentType || contentTypeFor(packageName)),
      bytes: Math.max(0, Math.floor(Number(totalBytes) || 0)),
      receivedBytes: 0
    }]
  }
  async appendRabbitMqConsumerChunk(uploadId, headers = {}, content = Buffer.alloc(0)) {
    const session = this.rabbitMqSessions.get(uploadId)
    if (!session) throw new Error('RabbitMQ Consumer尚未收到开始消息')
    const chunk = Buffer.isBuffer(content) ? content : Buffer.from(content || [])
    if (!chunk.length) return session

    const hasFileIndex = headers.fileIndex !== undefined || headers['x-file-index'] !== undefined
    if (hasFileIndex) {
      const fileIndex = Math.floor(Number(headers.fileIndex ?? headers['x-file-index']))
      if (!Number.isInteger(fileIndex) || fileIndex < 0 || fileIndex >= session.files.length) throw new Error('RabbitMQ文件分块序号无效')
      const file = session.files[fileIndex]
      const fileOffset = Math.max(0, Math.floor(Number(headers.fileOffset ?? headers['x-file-offset'] ?? headers.offset) || 0))
      if (fileOffset !== file.receivedBytes) throw new Error('RabbitMQ文件分块顺序不一致')
      const earlierPending = session.files.slice(0, fileIndex).find((item) => item.receivedBytes !== item.bytes)
      if (earlierPending) throw new Error('RabbitMQ文件夹分块顺序不一致')
      if (file.bytes > 0 && file.receivedBytes + chunk.length > file.bytes) throw new Error('RabbitMQ文件分块超过声明大小')
      await this.appendFrameBuffer(session, chunk)
      file.receivedBytes += chunk.length
    } else {
      const offset = Math.max(0, Math.floor(Number(headers.offset) || 0))
      if (offset !== session.receivedBytes) throw new Error('RabbitMQ分块顺序不一致')
      const file = session.files[0]
      if (file.bytes > 0 && file.receivedBytes + chunk.length > file.bytes) throw new Error('RabbitMQ分块超过声明大小')
      await this.appendFrameBuffer(session, chunk)
      file.receivedBytes += chunk.length
    }

    if (session.totalBytes > 0 && session.receivedBytes > session.totalBytes) throw new Error('RabbitMQ分块超过声明大小')
    this.rabbitMqStats.consumedMessages += 1
    this.rabbitMqStats.consumedBytes += chunk.length
    this.rabbitMqStats.lastConsumedAtMillis = Date.now()
    return session
  }
  async completeRabbitMqConsumerSession(uploadId, headers = {}) {
    const session = this.rabbitMqSessions.get(uploadId)
    if (!session) throw new Error('RabbitMQ Consumer尚未收到开始消息')
    const declaredTotalBytes = Math.max(0, Math.floor(Number(headers.totalBytes) || 0))
    if (declaredTotalBytes > 0) session.totalBytes = declaredTotalBytes
    if (session.files.length === 1 && session.files[0].bytes === 0 && session.receivedBytes > 0) {
      session.files[0].bytes = session.receivedBytes
    }
    if (session.totalBytes > 0 && session.receivedBytes !== session.totalBytes) throw new Error('RabbitMQ Consumer接收数据不完整')
    const pending = session.files.find((file) => file.receivedBytes !== file.bytes)
    if (pending) throw new Error(`RabbitMQ文件尚未接收完成：${pending.relativePath}`)
    const result = await this.registerRabbitMqStoredPackage(session)
    this.rabbitMqSessions.delete(uploadId)
    this.rabbitMqStats.consumedMessages += 1
    this.rabbitMqStats.lastConsumedAtMillis = Date.now()
    this.resolveRabbitMqIngest(uploadId, result)
    return result
  }
  async registerRabbitMqStoredPackage(session) {
    const metadata = {
      version: 'pre-transmission-frame-v1',
      ingressMode: 'MESSAGE_QUEUE_STREAM',
      sourceProtocol: 'RabbitMQ',
      sourceName: 'RabbitMQ Broker',
      topic: this.rabbitMqQueueName(),
      messageId: session.uploadId,
      frameBytes: session.frameBytes,
      totalBytes: session.receivedBytes,
      frameCount: session.frames.length,
      packageName: session.packageName,
      packageKind: session.packageKind,
      originalFileCount: session.files.length,
      startedAt: session.startedAt,
      receivedAt: new Date().toISOString(),
      sourceFiles: session.files.map((file) => ({ index: file.index, name: file.name, relativePath: file.relativePath, bytes: file.bytes, contentType: file.contentType })),
      frames: session.frames.map((frame, index) => ({ index: index + 1, name: frame.relativePath, bytes: frame.bytes, last: index === session.frames.length - 1 }))
    }
    const manifestPath = path.join(session.groupDir, 'manifest.json')
    const manifestContent = JSON.stringify(metadata, null, 2)
    await writeFile(manifestPath, manifestContent, 'utf8')
    const storedFiles = [
      ...session.frames.map(({ frameIndex, ...frame }) => frame),
      { absolutePath: manifestPath, relativePath: 'manifest.json', contentType: 'application/json', bytes: Buffer.byteLength(manifestContent) }
    ]
    return {
      ...this.registerStoredPackage({
        id: session.id,
        packageName: session.packageName,
        packageKind: 'FOLDER',
        storedFiles,
        label: '消息队列流式传输',
        type: '预传输帧数据包',
        description: '文件或文件夹分块经RabbitMQ Broker接入后封装为预传输帧，再提交给后端服务执行压缩任务',
        preTransmission: {
          enabled: true,
          mode: metadata.ingressMode,
          sourceProtocol: metadata.sourceProtocol,
          queue: metadata.topic,
          frameBytes: session.frameBytes,
          totalBytes: session.receivedBytes,
          frameCount: session.frames.length
        },
        message: `RabbitMQ Consumer接收成功：${session.packageName}（${session.packageKind === 'FOLDER' ? `${session.files.length} 项，` : ''}${session.frames.length} 帧，${formatBytes(session.receivedBytes)}）`
      }),
      ingress: metadata,
      rabbitmq: {
        queue: this.rabbitMqQueueName(),
        publishedMessages: this.rabbitMqStats.publishedMessages,
        consumedMessages: this.rabbitMqStats.consumedMessages,
        ackedMessages: this.rabbitMqStats.ackedMessages
      }
    }
  }

  async rabbitMqStatus() {
    try {
      await this.ensureRabbitMqConnection()
      return {
        connected: true,
        status: '已连接',
        message: 'RabbitMQ已连接',
        queue: this.rabbitMqQueueName(),
        url: this.redactedRabbitMqUrl(),
        publishedMessages: this.rabbitMqStats.publishedMessages,
        consumedMessages: this.rabbitMqStats.consumedMessages,
        ackedMessages: this.rabbitMqStats.ackedMessages,
        consumedBytes: this.rabbitMqStats.consumedBytes,
        lastPublishedAtMillis: this.rabbitMqStats.lastPublishedAtMillis || 0,
        lastConsumedAtMillis: this.rabbitMqStats.lastConsumedAtMillis || 0
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return {
        connected: false,
        status: '未连接',
        message,
        queue: this.rabbitMqQueueName(),
        url: this.redactedRabbitMqUrl(),
        publishedMessages: this.rabbitMqStats.publishedMessages,
        consumedMessages: this.rabbitMqStats.consumedMessages,
        ackedMessages: this.rabbitMqStats.ackedMessages,
        consumedBytes: this.rabbitMqStats.consumedBytes,
        lastPublishedAtMillis: this.rabbitMqStats.lastPublishedAtMillis || 0,
        lastConsumedAtMillis: this.rabbitMqStats.lastConsumedAtMillis || 0
      }
    }
  }

  registerStoredPackage({ id = `upload:${randomUUID()}`, packageName, packageKind = 'FILE', storedFiles = [], label, type, description, preTransmission = null, message = '' }) {
    if (!storedFiles.length) throw new Error('接入数据为空')
    const normalizedKind = packageKind === 'FOLDER' || storedFiles.length > 1 ? 'FOLDER' : 'FILE'
    const totalBytes = storedFiles.reduce((sum, item) => sum + (Number(item.bytes) || 0), 0)
    const item = {
      id,
      name: packageName,
      label: label || (normalizedKind === 'FOLDER' ? '本地文件夹数据包' : '本地文件数据包'),
      size: formatBytes(totalBytes),
      bytes: totalBytes,
      itemCount: storedFiles.length,
      packageKind: normalizedKind,
      type: type || (normalizedKind === 'FOLDER' ? '文件夹数据包' : '文件数据包'),
      description: description || '由系统网关接入后暂存，再提交给后端服务执行真实任务',
      absolutePath: storedFiles[0].absolutePath,
      files: storedFiles,
      preTransmission: preTransmission || undefined
    }
    this.uploads.set(id, item)
    this.config.fileId = id
    this.currentTaskId = null
    this.hiddenTaskIds.clear()
    return {
      success: true,
      message: message || `已选择${normalizedKind === 'FOLDER' ? '文件夹' : '文件'}数据包：${packageName}（${storedFiles.length} 项）`,
      file: publicFileOption(item),
      currentConfig: { ...this.config, state: 'IDLE', stateText: '待发送' }
    }
  }

  preTransmissionFrameBytes(requestUrl, request) {
    const requested = Number(requestUrl.searchParams.get('frameBytes') || headerValue(request.headers, 'x-frame-bytes'))
    return this.normalizedPreTransmissionFrameBytes(requested)
  }

  normalizedPreTransmissionFrameBytes(value) {
    const configured = Math.max(1, Math.floor(Number(this.options.preTransmissionFrameBytes) || 1))
    const requested = Math.floor(Number(value) || 0)
    return Math.max(1, Math.min(requested > 0 ? requested : configured, configured))
  }

  async writePreTransmissionFrames(request, groupDir, frameBytes) {
    const maxFrames = MAX_PRE_TRANSMISSION_FRAME_COUNT
    const frames = []
    let current = null
    let currentFile = null
    let totalBytes = 0

    const openFrame = async () => {
      if (frames.length >= maxFrames) throw new Error(`预传输帧数量超过 ${maxFrames} 个限制`)
      const index = frames.length + 1
      const relativePath = `frames/frame-${paddedFrameIndex(index)}.bin`
      const absolutePath = path.join(groupDir, ...relativePath.split('/'))
      await mkdir(path.dirname(absolutePath), { recursive: true })
      current = createWriteStream(absolutePath)
      currentFile = { absolutePath, relativePath, contentType: 'application/octet-stream', bytes: 0, frameIndex: index }
    }

    const closeFrame = async () => {
      if (!current) return
      await closeWriteStream(current)
      frames.push(currentFile)
      current = null
      currentFile = null
    }

    for await (const raw of request) {
      const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw)
      let offset = 0
      while (offset < chunk.length) {
        if (!current) await openFrame()
        const remaining = frameBytes - currentFile.bytes
        const length = Math.min(remaining, chunk.length - offset)
        const part = chunk.subarray(offset, offset + length)
        await writeStreamChunk(current, part)
        currentFile.bytes += length
        totalBytes += length
        offset += length
        if (currentFile.bytes >= frameBytes) await closeFrame()
      }
    }
    await closeFrame()
    if (!totalBytes) throw new Error('接入数据为空')
    return { frames, totalBytes }
  }

  async beginChunkedUpload(payload = {}) {
    const inputFiles = Array.isArray(payload.files) ? payload.files : []
    if (!inputFiles.length) throw new Error('请选择要发送的文件或文件夹')
    if (inputFiles.length > MAX_PACKAGE_FILE_COUNT) throw new Error(`文件夹最多支持 ${MAX_PACKAGE_FILE_COUNT} 个文件`)

    const normalizedFiles = inputFiles.map((file, index) => {
      const relativePath = safeRelativePath(file?.relativePath || file?.name || `file-${index + 1}.bin`)
      const bytes = Math.max(0, Math.floor(Number(file?.size) || 0))
      return {
        index,
        name: safeFileName(file?.name || path.basename(relativePath) || `file-${index + 1}.bin`),
        relativePath,
        contentType: String(file?.type || contentTypeFor(relativePath)),
        bytes,
        receivedBytes: 0
      }
    })
    const totalBytes = normalizedFiles.reduce((sum, file) => sum + file.bytes, 0)
    if (!totalBytes) throw new Error('接入数据为空')
    if (totalBytes > this.options.uploadLimitBytes) throw new Error(`数据包超过 ${formatBytes(this.options.uploadLimitBytes)} 限制`)

    const frameBytes = this.normalizedPreTransmissionFrameBytes(payload.frameBytes)
    const maxFrames = MAX_PRE_TRANSMISSION_FRAME_COUNT
    const estimatedFrames = Math.ceil(totalBytes / frameBytes)
    if (estimatedFrames > maxFrames) throw new Error(`预传输帧数量超过 ${maxFrames} 个限制`)

    await mkdir(this.options.uploadsDir, { recursive: true })
    const id = `upload:${randomUUID()}`
    const groupDir = path.join(this.options.uploadsDir, id.slice(7))
    await mkdir(path.join(groupDir, 'frames'), { recursive: true })

    const packageKind = String(payload.packageKind || '').toUpperCase() === 'FOLDER' || normalizedFiles.length > 1 ? 'FOLDER' : 'FILE'
    const packageName = safeFileName(payload.packageName || normalizedFiles[0].name || 'upload.bin')
    const session = {
      id,
      groupDir,
      packageName,
      packageKind,
      files: normalizedFiles,
      frameBytes,
      totalBytes,
      receivedBytes: 0,
      frames: [],
      startedAt: new Date().toISOString()
    }
    this.chunkedUploads.set(id, session)
    return {
      success: true,
      uploadId: id,
      chunkBytes: Math.max(1024 * 1024, Math.floor(Number(this.options.localUploadChunkBytes) || 16 * 1024 * 1024)),
      frameBytes,
      totalBytes,
      fileCount: normalizedFiles.length,
      message: '已创建本地大文件上传会话'
    }
  }

  async appendFrameBuffer(session, chunk) {
    const maxFrames = MAX_PRE_TRANSMISSION_FRAME_COUNT
    let offset = 0
    while (offset < chunk.length) {
      let frame = session.frames[session.frames.length - 1]
      if (!frame || frame.bytes >= session.frameBytes) {
        if (session.frames.length >= maxFrames) throw new Error(`预传输帧数量超过 ${maxFrames} 个限制`)
        const index = session.frames.length + 1
        const relativePath = `frames/frame-${paddedFrameIndex(index)}.bin`
        const absolutePath = path.join(session.groupDir, ...relativePath.split('/'))
        await mkdir(path.dirname(absolutePath), { recursive: true })
        frame = { absolutePath, relativePath, contentType: 'application/octet-stream', bytes: 0, frameIndex: index }
        session.frames.push(frame)
      }
      const remaining = session.frameBytes - frame.bytes
      const length = Math.min(remaining, chunk.length - offset)
      const stream = createWriteStream(frame.absolutePath, { flags: 'a' })
      await writeStreamChunk(stream, chunk.subarray(offset, offset + length))
      await closeWriteStream(stream)
      frame.bytes += length
      session.receivedBytes += length
      offset += length
    }
  }

  async appendChunkedUpload(request) {
    const uploadId = headerValue(request.headers, 'x-upload-id')
    const session = this.chunkedUploads.get(uploadId)
    if (!session) throw new Error('上传会话不存在或已完成，请重新选择文件')
    const fileIndex = Number(headerValue(request.headers, 'x-file-index'))
    if (!Number.isInteger(fileIndex) || fileIndex < 0 || fileIndex >= session.files.length) throw new Error('上传分块文件序号无效')
    const file = session.files[fileIndex]
    const expectedOffset = Number(headerValue(request.headers, 'x-file-offset'))
    if (Number.isFinite(expectedOffset) && expectedOffset !== file.receivedBytes) throw new Error('上传分块顺序不一致，请重新选择文件')

    const chunkLimit = Math.max(1024 * 1024, Math.floor(Number(this.options.localUploadChunkBytes) || 16 * 1024 * 1024)) + 64 * 1024
    const contentLength = Number(request.headers['content-length'] || 0)
    if (contentLength > chunkLimit) throw new Error(`上传分块超过 ${formatBytes(chunkLimit)} 限制`)

    let chunkBytes = 0
    for await (const raw of request) {
      const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw)
      chunkBytes += chunk.length
      if (chunkBytes > chunkLimit) throw new Error(`上传分块超过 ${formatBytes(chunkLimit)} 限制`)
      if (file.receivedBytes + chunk.length > file.bytes) throw new Error('上传分块超过文件声明大小，请重新选择文件')
      await this.appendFrameBuffer(session, chunk)
      file.receivedBytes += chunk.length
    }
    return {
      success: true,
      uploadId,
      receivedBytes: session.receivedBytes,
      totalBytes: session.totalBytes,
      progressPercent: round(session.receivedBytes / Math.max(1, session.totalBytes) * 100, 1),
      fileIndex,
      fileReceivedBytes: file.receivedBytes,
      frameCount: session.frames.length
    }
  }

  async completeChunkedUpload(payload = {}) {
    const uploadId = String(payload.uploadId || '').trim()
    const session = this.chunkedUploads.get(uploadId)
    if (!session) throw new Error('上传会话不存在或已完成，请重新选择文件')
    const pending = session.files.find((file) => file.receivedBytes !== file.bytes)
    if (pending) throw new Error(`文件尚未上传完成：${pending.relativePath}`)
    if (session.receivedBytes !== session.totalBytes || !session.frames.length) throw new Error('上传数据尚未完整接收')

    const metadata = {
      version: 'pre-transmission-frame-v1',
      ingressMode: 'LOCAL_FILE_UPLOAD',
      sourceProtocol: 'Browser',
      sourceName: 'LocalFilePicker',
      frameBytes: session.frameBytes,
      totalBytes: session.totalBytes,
      frameCount: session.frames.length,
      packageName: session.packageName,
      packageKind: session.packageKind,
      originalFileCount: session.files.length,
      startedAt: session.startedAt,
      receivedAt: new Date().toISOString(),
      sourceFiles: session.files.map((file) => ({ index: file.index, name: file.name, relativePath: file.relativePath, bytes: file.bytes, contentType: file.contentType })),
      frames: session.frames.map((frame, index) => ({ index: index + 1, name: frame.relativePath, bytes: frame.bytes, last: index === session.frames.length - 1 }))
    }
    const manifestPath = path.join(session.groupDir, 'manifest.json')
    const manifestContent = JSON.stringify(metadata, null, 2)
    await writeFile(manifestPath, manifestContent, 'utf8')
    const storedFiles = [
      ...session.frames.map(({ frameIndex, ...frame }) => frame),
      { absolutePath: manifestPath, relativePath: 'manifest.json', contentType: 'application/json', bytes: Buffer.byteLength(manifestContent) }
    ]
    this.chunkedUploads.delete(uploadId)
    const result = this.registerStoredPackage({
      id: uploadId,
      packageName: session.packageName,
      packageKind: 'FOLDER',
      storedFiles,
      label: session.packageKind === 'FOLDER' ? '本地文件夹数据包' : '本地文件数据包',
      type: '预传输帧数据包',
      description: '浏览器选择后由系统网关按预传输帧暂存，再提交给后端服务执行真实任务',
      preTransmission: { enabled: true, mode: metadata.ingressMode, frameBytes: session.frameBytes, totalBytes: session.totalBytes, frameCount: session.frames.length },
      message: `已选择${session.packageKind === 'FOLDER' ? '文件夹' : '文件'}数据包：${session.packageName}（${session.frames.length} 帧，${formatBytes(session.totalBytes)}）`
    })
    return { ...result, ingress: metadata }
  }
  async ingestStreamPackage(request, mode) {
    this.assertIngressAllowed(request)
    const requestUrl = new URL(request.url || '/', 'http://localhost')
    const queueMode = mode === 'QUEUE'
    const frameBytes = this.preTransmissionFrameBytes(requestUrl, request)
    const contentLength = Number(request.headers['content-length'] || 0)
    const maxPayloadBytes = Math.min(this.options.uploadLimitBytes, frameBytes * MAX_PRE_TRANSMISSION_FRAME_COUNT)
    if (contentLength > maxPayloadBytes) throw new Error(`接入数据超过 ${formatBytes(maxPayloadBytes)} 限制`)

    await mkdir(this.options.uploadsDir, { recursive: true })
    const id = `upload:${randomUUID()}`
    const groupDir = path.join(this.options.uploadsDir, id.slice(7))
    await mkdir(groupDir, { recursive: true })

    const fallbackName = queueMode ? 'message-queue-stream.bin' : 'api-callback-data.bin'
    const packageName = normalizeIngressPackageName(requestUrl.searchParams.get('packageName') || headerValue(request.headers, 'x-package-name'), fallbackName)
    const { frames, totalBytes } = await this.writePreTransmissionFrames(request, groupDir, frameBytes)
    if (totalBytes > this.options.uploadLimitBytes) throw new Error(`接入数据超过 ${formatBytes(this.options.uploadLimitBytes)} 限制`)
    const metadata = {
      version: 'pre-transmission-frame-v1',
      ingressMode: queueMode ? 'MESSAGE_QUEUE_STREAM' : 'API_CALLBACK',
      sourceProtocol: requestUrl.searchParams.get('protocol') || headerValue(request.headers, 'x-source-protocol') || (queueMode ? 'Kafka/RabbitMQ/RocketMQ' : 'HTTP/WebService'),
      sourceName: requestUrl.searchParams.get('sourceName') || headerValue(request.headers, 'x-source-name') || (queueMode ? 'MessageQueue' : 'BusinessSystem'),
      topic: requestUrl.searchParams.get('topic') || headerValue(request.headers, 'x-topic') || '',
      messageId: requestUrl.searchParams.get('messageId') || headerValue(request.headers, 'x-message-id') || '',
      frameBytes,
      totalBytes,
      frameCount: frames.length,
      packageName,
      receivedAt: new Date().toISOString(),
      frames: frames.map((frame, index) => ({ index: index + 1, name: frame.relativePath, bytes: frame.bytes, last: index === frames.length - 1 }))
    }
    const manifestPath = path.join(groupDir, 'manifest.json')
    const manifestContent = JSON.stringify(metadata, null, 2)
    await writeFile(manifestPath, manifestContent, 'utf8')
    const storedFiles = [
      ...frames.map(({ frameIndex, ...frame }) => frame),
      { absolutePath: manifestPath, relativePath: 'manifest.json', contentType: 'application/json', bytes: Buffer.byteLength(manifestContent) }
    ]
    const channelName = queueMode ? '消息队列流式传输' : 'API/接口数据服务接入'
    const result = this.registerStoredPackage({
      id,
      packageName,
      packageKind: 'FOLDER',
      storedFiles,
      label: channelName,
      type: '预传输帧数据包',
      description: `${channelName}接入后封装为预传输帧，再提交给后端服务执行压缩任务`,
      preTransmission: { enabled: true, mode: metadata.ingressMode, sourceProtocol: metadata.sourceProtocol, frameBytes, totalBytes, frameCount: frames.length },
      message: `已接入${channelName}数据：${packageName}（${frames.length} 帧，${formatBytes(totalBytes)}）`
    })
    return { ...result, ingress: metadata }
  }
  async uploadFile(request) {
    const contentLength = Number(request.headers['content-length'] || 0)
    const requestLimit = this.options.uploadLimitBytes + MULTIPART_OVERHEAD_BYTES
    if (contentLength > requestLimit) throw new Error('接收包超过 ' + formatBytes(this.options.uploadLimitBytes) + ' 限制')
    const buffer = await readRequestBody(request, requestLimit)
    const parsed = parseMultipartBody(buffer, request.headers['content-type'])
    const uploads = parsed.files.filter((item) => ['file', 'files'].includes(item.name))
    if (!uploads.length) throw new Error('请选择要发送的文件或文件夹')
    if (uploads.length > MAX_PACKAGE_FILE_COUNT) throw new Error(`文件夹最多支持 ${MAX_PACKAGE_FILE_COUNT} 个文件`)
    const totalBytes = uploads.reduce((sum, item) => sum + item.content.length, 0)
    if (totalBytes > this.options.uploadLimitBytes) throw new Error(`数据包超过 ${formatBytes(this.options.uploadLimitBytes)} 限制`)

    await mkdir(this.options.uploadsDir, { recursive: true })
    const id = `upload:${randomUUID()}`
    const groupDir = path.join(this.options.uploadsDir, id.slice(7))
    await mkdir(groupDir, { recursive: true })

    const storedFiles = []
    for (const upload of uploads) {
      const relativePath = safeRelativePath(upload.filename)
      const absolutePath = path.join(groupDir, ...relativePath.split('/'))
      await mkdir(path.dirname(absolutePath), { recursive: true })
      await writeFile(absolutePath, upload.content)
      storedFiles.push({
        absolutePath,
        relativePath,
        contentType: upload.contentType,
        bytes: upload.content.length
      })
    }

    const packageKind = parsed.fields.packageKind === 'FOLDER' || uploads.length > 1 ? 'FOLDER' : 'FILE'
    const packageName = safeFileName(parsed.fields.packageName || uploads[0].filename)
    return this.registerStoredPackage({
      id,
      packageName,
      packageKind,
      storedFiles,
      label: packageKind === 'FOLDER' ? '本地文件夹数据包' : '本地文件数据包',
      type: packageKind === 'FOLDER' ? '文件夹数据包' : '文件数据包',
      description: '浏览器选择后由系统网关按一个数据包暂存，再提交给后端服务执行真实任务',
      message: `已选择${packageKind === 'FOLDER' ? '文件夹' : '文件'}数据包：${packageName}（${storedFiles.length} 项）`
    })
  }

  async algorithms() {
    const values = await this.backend('/api/algorithms')
    return values.map((item) => ({
      ...item,
      id: item.name,
      compressionRate: '动态',
      description: item.supportsLevel
        ? `系统内置算法，支持等级 ${item.minLevel}–${item.maxLevel}`
        : '系统内置算法，不使用压缩等级'
    }))
  }

  async sources() {
    return this.backend('/api/sources')
  }

  async currentTask() {
    if (!this.currentTaskId || this.hiddenTaskIds.has(String(this.currentTaskId))) return this.latestBackendTask()
    const currentId = String(this.currentTaskId)
    const groupIds = this.preTransmissionTaskIdsFor(currentId)
    if (groupIds.length > 1) {
      const tasks = await this.backend('/api/tasks')
      const aggregate = this.aggregatePreTransmissionTask(currentId, tasks)
      if (aggregate && !this.hiddenTaskIds.has(String(aggregate.id || ''))) return aggregate
    }
    try {
      const task = await this.backend(`/api/tasks/${encodeURIComponent(currentId)}`)
      return this.hiddenTaskIds.has(String(task?.id || '')) ? this.latestBackendTask() : task
    } catch (error) {
      if (/不存在|404/.test(error.message)) this.currentTaskId = null
      throw error
    }
  }

  async latestBackendTask() {
    const tasks = await this.backend('/api/tasks')
    if (!Array.isArray(tasks) || !tasks.length) return null
    const visibleTasks = tasks.filter((task) => !this.hiddenTaskIds.has(String(task?.id || '')))
    if (!visibleTasks.length) return null
    const latest = visibleTasks.slice().sort((a, b) => {
      const aTime = Number(a.completedAtMillis || a.startedAtMillis || a.queuedAtMillis || 0)
      const bTime = Number(b.completedAtMillis || b.startedAtMillis || b.queuedAtMillis || 0)
      return bTime - aTime
    })[0]
    return this.aggregatePreTransmissionTask(latest?.id, visibleTasks) || latest
  }
  async taskOptions() {
    const [files, algorithms, task] = await Promise.all([
      this.files(),
      this.algorithms(),
      this.currentTask()
    ])
    if (!algorithms.some((item) => item.id === this.config.algorithmId)) {
      this.config.algorithmId = algorithms.find((item) => item.id === 'ZSTD')?.id || algorithms[0]?.id || 'NONE'
    }
    const mapped = mapTaskState(task?.state)
    return {
      fileOptions: files.map(publicFileOption),
      algorithmOptions: algorithms.map(({ supportsLevel, minLevel, maxLevel, defaultLevel, realtimeLevels, ...item }) => item),
      levelOptions: ['1', '2', '3', '4', '5', '6', '7', '8', '9'],
      priorityOptions: ['低', '中', '高'],
      currentConfig: { ...this.config, state: mapped.state, stateText: mapped.text },
      editable: mapped.state !== 'RUNNING'
    }
  }

  async updateConfiguration(nextConfig) {
    const task = await this.currentTask()
    if (mapTaskState(task?.state).state === 'RUNNING') {
      return { success: false, message: '任务服务正在执行，完成后才能修改配置', currentConfig: { ...this.config } }
    }

    const [files, algorithms] = await Promise.all([this.files(), this.algorithms()])
    const selectedFile = files.find((item) => item.id === nextConfig?.fileId)
    const mode = String(nextConfig?.mode || 'AUTO').toUpperCase()
    const fallbackAlgorithm = algorithms.find((item) => item.id === 'ZSTD') || algorithms[0]
    const selectedAlgorithm = algorithms.find((item) => item.id === nextConfig?.algorithmId) || fallbackAlgorithm
    const level = String(nextConfig?.level || selectedAlgorithm?.defaultLevel || '3')
    const priority = String(nextConfig?.priority || '')

    if (!selectedFile || !PRIORITY_TO_BACKEND[priority] || !['AUTO', 'MANUAL'].includes(mode)) {
      return { success: false, message: '配置参数无效，请重新选择文件、控制模式和优先级', currentConfig: { ...this.config } }
    }

    if (mode === 'MANUAL') {
      if (!selectedAlgorithm) {
        return { success: false, message: '手动控制模式必须选择压缩算法', currentConfig: { ...this.config } }
      }
      const numericLevel = Number(level)
      if (!Number.isInteger(numericLevel)
        || (selectedAlgorithm.supportsLevel && (numericLevel < selectedAlgorithm.minLevel || numericLevel > selectedAlgorithm.maxLevel))) {
        return {
          success: false,
          message: selectedAlgorithm.supportsLevel
            ? `${selectedAlgorithm.id} 支持的压缩等级为 ${selectedAlgorithm.minLevel}–${selectedAlgorithm.maxLevel}`
            : `${selectedAlgorithm.id} 不使用压缩等级，请保留默认值`,
          currentConfig: { ...this.config }
        }
      }
    }

    this.config = {
      fileId: selectedFile.id,
      mode,
      algorithmId: selectedAlgorithm?.id || 'ZSTD',
      level,
      priority
    }
    this.currentTaskId = null
    this.hiddenTaskIds.clear()
    const message = mode === 'AUTO' ? '已切换为自动控制' : '已切换为手动控制'
    return { success: true, message, currentConfig: { ...this.config, state: 'IDLE', stateText: '待发送' } }
  }

  async submitBackendTask({ packageFiles, packageName, packageKind, source, selectedAlgorithm, manual }) {
    const form = new FormData()
    for (const packageFile of packageFiles) {
      const fileBuffer = await readFile(packageFile.absolutePath)
      form.append('files', new Blob([fileBuffer], { type: packageFile.contentType || contentTypeFor(packageFile.relativePath) }), packageFile.relativePath)
    }
    form.append('packageName', packageName)
    form.append('packageKind', packageKind || (packageFiles.length > 1 ? 'FOLDER' : 'FILE'))
    form.append('sourceId', source.id)
    form.append('businessScene', source.businessScene || '综合监测')
    form.append('priority', PRIORITY_TO_BACKEND[this.config.priority])
    form.append('mode', this.config.mode)
    if (manual) {
      form.append('algorithm', selectedAlgorithm.id)
      form.append('level', this.config.level)
    }
    return this.backend('/api/tasks', { method: 'POST', body: form })
  }
  async startTransfer() {
    const existingTask = await this.currentTask()
    const existingState = mapTaskState(existingTask?.state).state
    if (existingState === 'RUNNING') {
      return { success: true, running: true, message: '任务服务正在执行中' }
    }
    if (existingState === 'PAUSED' && existingTask?.id) {
      if (this.options.receiverUrl && !await this.refreshReceiverLink({ force: true })) {
        return { success: false, running: false, message: '接收端尚未恢复，请先确认接收端在线后继续发送' }
      }
      const resumed = await this.backend(`/api/tasks/${encodeURIComponent(existingTask.id)}/resume`, { method: 'POST' })
      this.currentTaskId = resumed.id || existingTask.id
      this.hiddenTaskIds.delete(String(this.currentTaskId))
      this.queueDeliveryForTask(this.currentTaskId)
      await this.pushReceiverTaskSync(resumed)
      return { success: true, running: true, message: '任务已继续发送' }
    }
    if (existingState === 'COMPLETED' && existingTask?.id && this.options.receiverUrl && !this.remoteDeliveryFinishedForTask(existingTask)) {
      if (!await this.refreshReceiverLink({ force: true })) {
        return { success: false, running: false, message: '接收端尚未恢复，请先确认接收端在线后重新投递' }
      }
      this.currentTaskId = existingTask.id
      this.hiddenTaskIds.delete(String(existingTask.id))
      if (String(this.remoteDelivery.state || '') === 'failed') this.remoteDeliveries.delete(String(existingTask.id))
      this.queueDeliveryForTask(existingTask.id)
      await this.pushReceiverTaskSync(existingTask)
      return { success: true, running: true, message: '正在重新投递到接收端' }
    }

    const [files, algorithms, sources] = await Promise.all([this.files(), this.algorithms(), this.sources()])
    const selectedFile = files.find((item) => item.id === this.config.fileId)
    const selectedAlgorithm = algorithms.find((item) => item.id === this.config.algorithmId)
    const source = sources.find((item) => item.online) || sources[0]
    const manual = this.config.mode === 'MANUAL'
    if (!selectedFile || !source || (manual && !selectedAlgorithm)) throw new Error('没有可用的文件、算法或数据服务')

    if (this.options.receiverUrl && !await this.refreshReceiverLink({ force: true })) {
      throw new Error('接收端未连接，请先确认接收端在线后再开始发送')
    }

    const packageFiles = Array.isArray(selectedFile.files) && selectedFile.files.length
      ? selectedFile.files
      : [{ absolutePath: selectedFile.absolutePath, relativePath: selectedFile.name, contentType: contentTypeFor(selectedFile.name) }]
    const frameFiles = selectedFile.preTransmission?.enabled
      ? packageFiles.filter((item) => String(item.relativePath || '').replace(/\\/g, '/').startsWith('frames/'))
      : []
    if (frameFiles.length) {
      const submitted = []
      const manifestFile = packageFiles.find((item) => String(item.relativePath || '').replace(/\\/g, '/') === 'manifest.json')
      let manifest = null
      if (manifestFile?.absolutePath) {
        try { manifest = JSON.parse(await readFile(manifestFile.absolutePath, 'utf8')) } catch {}
      }
      const manifestSourceFiles = Array.isArray(manifest?.sourceFiles) ? manifest.sourceFiles : []
      const sourceFiles = manifestSourceFiles.map((file, index) => ({
        index: Number.isInteger(Number(file?.index)) ? Number(file.index) : index,
        name: safeFileName(file?.name || file?.relativePath || `file-${index + 1}.bin`),
        relativePath: safeRelativePath(file?.relativePath || file?.name || `file-${index + 1}.bin`),
        bytes: Math.max(0, Math.floor(Number(file?.bytes) || 0)),
        contentType: String(file?.contentType || contentTypeFor(file?.relativePath || file?.name || 'upload.bin'))
      })).filter((file) => file.relativePath)
      const frameCount = Math.max(frameFiles.length, Math.floor(Number(manifest?.frameCount || selectedFile.preTransmission?.frameCount || frameFiles.length)))
      const frameBytes = this.normalizedPreTransmissionFrameBytes(manifest?.frameBytes || selectedFile.preTransmission?.frameBytes)
      const totalBytes = Math.max(0, Math.floor(Number(manifest?.totalBytes || selectedFile.preTransmission?.totalBytes || frameFiles.reduce((sum, item) => sum + (Number(item.bytes) || 0), 0))))
      const packageName = safeFileName(manifest?.packageName || selectedFile.name || 'pre-transmission.bin')
      const packageKind = String(manifest?.packageKind || '').toUpperCase() === 'FOLDER' || sourceFiles.length > 1 ? 'FOLDER' : 'FILE'
      const baseFrameInfo = {
        groupId: selectedFile.id,
        packageName,
        packageKind,
        mode: manifest?.ingressMode || selectedFile.preTransmission?.mode || 'PRE_TRANSMISSION',
        sourceProtocol: manifest?.sourceProtocol || selectedFile.preTransmission?.sourceProtocol || '',
        frameBytes,
        totalBytes,
        frameCount,
        sourceFiles,
        frames: Array.isArray(manifest?.frames) ? manifest.frames : frameFiles.map((file, index) => ({ index: index + 1, name: file.relativePath, bytes: Number(file.bytes) || 0, last: index === frameFiles.length - 1 }))
      }
      for (const [index, frameFile] of frameFiles.entries()) {
        const frameTask = await this.submitBackendTask({
          packageFiles: [frameFile],
          packageName: preTransmissionFrameTaskName(baseFrameInfo, index + 1, selectedFile.name),
          packageKind: 'FILE',
          source,
          selectedAlgorithm,
          manual
        })
        submitted.push(frameTask)
        this.preTransmissionDeliveries.set(String(frameTask.id), {
          ...baseFrameInfo,
          frameIndex: index + 1,
          framePath: frameFile.relativePath,
          frameSize: Number(frameFile.bytes) || 0
        })
        this.hiddenTaskIds.delete(String(frameTask.id))
      }
      const submittedTaskIds = submitted.map((item) => String(item.id)).filter(Boolean)
      for (const submittedTask of submitted) {
        const stored = this.preTransmissionDeliveries.get(String(submittedTask.id))
        if (stored) this.preTransmissionDeliveries.set(String(submittedTask.id), { ...stored, taskIds: submittedTaskIds })
      }
      this.currentTaskId = submitted[0]?.id || submitted[submitted.length - 1]?.id || null
      if (this.currentTaskId) this.queueDeliveryForTask(this.currentTaskId)
      await this.pushReceiverTaskSync()
      return { success: true, running: Boolean(submitted.length), message: `预传输帧已提交到后端服务：${submitted.length} 帧` }
    }

    const task = await this.submitBackendTask({
      packageFiles,
      packageName: selectedFile.name,
      packageKind: selectedFile.packageKind || (packageFiles.length > 1 ? 'FOLDER' : 'FILE'),
      source,
      selectedAlgorithm,
      manual
    })
    this.currentTaskId = task.id
    this.hiddenTaskIds.delete(String(task.id))
    this.queueRemoteDelivery(task.id)
    this.pushReceiverTaskSync(task)
    return { success: true, running: true, message: `任务已提交到后端服务：${task.id}` }
  }

  normalizeTransferTasks(tasks = []) {
    return (Array.isArray(tasks) ? tasks : []).map((task, index) => {
      const itemCount = Math.max(1, Number(task?.itemCount) || 1)
      const packageKind = String(task?.packageKind || (itemCount > 1 ? 'FOLDER' : 'FILE')).toUpperCase() === 'FOLDER' ? 'FOLDER' : 'FILE'
      const progressPercent = clamp(Number(task?.progressPercent ?? (task?.state === 'COMPLETED' ? 100 : 0)), 0, 100)
      return {
        ...task,
        id: String(task?.id || task?.taskId || `synced-${index + 1}`),
        fileName: String(task?.fileName || '\u672a\u547d\u540d\u4efb\u52a1'),
        packageKind,
        itemCount,
        progressPercent
      }
    }).sort((a, b) => {
      const aTime = Number(a.completedAtMillis || a.updatedAtMillis || a.startedAtMillis || a.queuedAtMillis || 0)
      const bTime = Number(b.completedAtMillis || b.updatedAtMillis || b.startedAtMillis || b.queuedAtMillis || 0)
      return bTime - aTime
    })
  }

  compactTaskForSync(task) {
    const normalized = this.normalizeTransferTasks([task])[0]
    if (!normalized) return null
    const { chunks, networkCurve, adjustments, ...compact } = normalized
    if (compact.recognition && typeof compact.recognition === 'object') {
      compact.recognition = {
        modality: compact.recognition.modality,
        format: compact.recognition.format,
        mimeType: compact.recognition.mimeType,
        alreadyCompressed: compact.recognition.alreadyCompressed,
        compressibilityScore: compact.recognition.compressibilityScore,
        strategyTag: compact.recognition.strategyTag,
        confidence: compact.recognition.confidence,
        reason: compact.recognition.reason
      }
    }
    if (compact.priority && typeof compact.priority === 'object') {
      compact.priority = {
        priority: compact.priority.priority,
        priorityValue: compact.priority.priorityValue,
        reason: compact.priority.reason
      }
    }
    if (compact.currentDecision && typeof compact.currentDecision === 'object') {
      compact.currentDecision = {
        preprocess: compact.currentDecision.preprocess,
        algorithm: compact.currentDecision.algorithm,
        level: compact.currentDecision.level,
        chunkSizeBytes: compact.currentDecision.chunkSizeBytes,
        cache: compact.currentDecision.cache,
        batch: compact.currentDecision.batch,
        sendOrder: compact.currentDecision.sendOrder,
        estimatedCompressionMillis: compact.currentDecision.estimatedCompressionMillis,
        estimatedTransferMillis: compact.currentDecision.estimatedTransferMillis,
        estimatedDecompressionMillis: compact.currentDecision.estimatedDecompressionMillis,
        estimatedTotalMillis: compact.currentDecision.estimatedTotalMillis,
        estimatedCompressedRatio: compact.currentDecision.estimatedCompressedRatio,
        reason: compact.currentDecision.reason
      }
    }
    return compact
  }

  transferTaskProgressOverride(task) {
    if (!this.remoteDelivery?.enabled || !this.remoteDeliveryMatchesTask(task)) return null
    const remoteState = String(this.remoteDelivery.state || '')
    const taskState = String(task?.state || '').toUpperCase()
    if (remoteState === 'delivered' && taskState === 'COMPLETED') return { progressPercent: 100, state: 'COMPLETED' }
    if (remoteState === 'failed' && taskState === 'COMPLETED') {
      const backendProgress = clamp(Number(task?.progressPercent) || 100, 0, 100) * 0.9
      return { progressPercent: round(Math.min(99, Math.max(90, backendProgress)), 1), state: 'TRANSMITTING' }
    }
    if (remoteState === 'delivered' || remoteState === 'failed') return null

    const backendProgress = taskState === 'COMPLETED'
      ? 90
      : clamp(Number(task?.progressPercent) || 0, 0, 100) * 0.9
    const deliveryProgress = remoteState === 'sending'
      ? clamp(Number(this.remoteDelivery.progress) || 0, 0, 100) * 0.1
      : 0
    const progressPercent = round(Math.min(99, backendProgress + deliveryProgress), 1)
    return taskState === 'COMPLETED'
      ? { progressPercent, state: 'TRANSMITTING' }
      : { progressPercent }
  }

  displayTransferTasks(tasks = []) {
    return this.normalizeTransferTasks(tasks).map((task) => {
      const override = this.transferTaskProgressOverride(task)
      return override ? { ...task, ...override } : task
    })
  }

  compactTasksForReceiverSync(tasks = [], currentTask = null, transmission = null) {
    const dashboardTaskId = String(transmission?.task?.id || currentTask?.id || '')
    const dashboardState = String(transmission?.task?.state || '').toUpperCase()
    const dashboardProgress = Number(transmission?.progress?.value)
    return this.displayTransferTasks(tasks).map((item) => {
      const compact = this.compactTaskForSync(item)
      if (!compact) return null
      const groupedPreTransmissionFrame = this.preTransmissionTaskIdsFor(compact.id).length > 1
      if (!groupedPreTransmissionFrame && dashboardTaskId && String(compact.id) === dashboardTaskId && Number.isFinite(dashboardProgress)) {
        compact.progressPercent = round(clamp(dashboardProgress, 0, 100), 1)
        if (dashboardState === 'RUNNING' && compact.progressPercent < 100 && String(compact.state || '').toUpperCase() === 'COMPLETED') {
          compact.state = 'TRANSMITTING'
        }
      }
      return compact
    }).filter(Boolean)
  }

  markReceivedTaskComplete(taskSnapshot = {}, { updatedAtMillis = 0 } = {}) {
    const taskId = String(taskSnapshot?.id || taskSnapshot?.taskId || '').trim()
    if (!taskId) return false
    const existing = this.syncedTransferTasks.find((item) => String(item?.id || '') === taskId) || {}
    const deliveredAtMillis = Math.max(Number(updatedAtMillis) || 0, this.syncedTransferAtMillis, this.syncedDashboardAtMillis) + 1
    const completedAtMillis = Math.max(Number(taskSnapshot?.completedAtMillis || 0), Number(existing.completedAtMillis || 0), Date.now())
    const task = this.normalizeTransferTasks([{ ...existing, ...taskSnapshot, id: taskId, state: 'COMPLETED', progressPercent: 100, completedAtMillis }])[0]
    if (!task) return false
    this.storeSyncedTransferTasks([task], { replace: false, updatedAtMillis: deliveredAtMillis })

    const dashboard = this.syncedTransmissionDashboard
    const dashboardTaskId = String(dashboard?.task?.id || '')
    if (dashboard && (!dashboardTaskId || dashboardTaskId === taskId)) {
      const nextDashboard = {
        ...dashboard,
        task: {
          ...(dashboard.task || {}),
          id: taskId,
          fileName: task.fileName || dashboard.task?.fileName,
          state: 'COMPLETED',
          stateText: '\u4efb\u52a1\u5df2\u5b8c\u6210',
          editable: true
        },
        progress: {
          ...(dashboard.progress || {}),
          value: 100,
          state: '\u8fdc\u7aef\u5df2\u63a5\u6536',
          transferRate: dashboard.progress?.transferRate || '\u5b8c\u6210',
          stages: stateStages('COMPLETED', 100)
        },
        route: dashboard.route ? { ...dashboard.route, status: '\u8fdc\u7aef\u5df2\u63a5\u6536' } : dashboard.route
      }
      this.storeSyncedDashboards({ transmission: nextDashboard, effect: this.syncedEffectDashboard, updatedAtMillis: deliveredAtMillis })
    }
    return true
  }

  storeSyncedTransferTasks(tasks = [], { replace = true, updatedAtMillis = Date.now() } = {}) {
    const normalized = this.normalizeTransferTasks(tasks)
    if (replace) {
      this.syncedTransferTasks = normalized
    } else {
      const merged = new Map(this.syncedTransferTasks.map((task) => [task.id, task]))
      for (const task of normalized) merged.set(task.id, { ...(merged.get(task.id) || {}), ...task })
      this.syncedTransferTasks = this.normalizeTransferTasks([...merged.values()])
    }
    this.syncedTransferAtMillis = Number(updatedAtMillis) || Date.now()
    return this.syncedTransferTasks
  }

  async pushReceiverTaskSync(task = null) {
    const targetUrl = this.options.receiverUrl
    if (!targetUrl) return
    try {
      let tasks = []
      try {
        tasks = await this.transferTasks({ display: false })
      } catch {
        if (task) tasks = [task]
      }
      if (task?.id && !tasks.some((item) => item.id === task.id)) tasks = [task, ...tasks]
      const visibleTasks = tasks.filter((item) => !this.hiddenTaskIds.has(String(item?.id || '')))

      let transmission = null
      let effect = null
      try { transmission = await this.transmissionDashboard({ skipReceiverRefresh: true, skipReceiverRateProbe: true }) } catch {}
      const explicitTaskVisible = task?.id && !this.hiddenTaskIds.has(String(task.id))
      const currentTask = explicitTaskVisible ? task : visibleTasks.find((item) => item.id === this.currentTaskId) || visibleTasks[0] || null
      if (String(currentTask?.state || '').toUpperCase() === 'COMPLETED' && this.remoteDeliveryFinishedForTask(currentTask)) {
        try { effect = await this.effectDashboard() } catch {}
      } else {
        effect = {
          hasEvaluation: false,
          message: '任务完成后将同步展示压缩前后时间对比。',
          task: transmission?.task || null
        }
      }
      const effectTaskId = String(effect?.taskId || effect?.task?.id || '').trim()
      const currentTaskId = String(currentTask?.id || transmission?.task?.id || '').trim()
      if (effect && currentTaskId && !effectTaskId) effect = { ...effect, taskId: currentTaskId }

      const updatedAtMillis = this.nextReceiverSyncAtMillis()
      const body = JSON.stringify({
        tasks: this.compactTasksForReceiverSync(visibleTasks, currentTask, transmission),
        taskId: transmission?.task?.id || task?.id || this.currentTaskId || '',
        replace: true,
        dashboards: { transmission, effect, updatedAtMillis },
        updatedAtMillis
      })
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), Number(process.env.RECEIVER_SYNC_TIMEOUT_MS || 2500))
      try {
        const syncResponse = await fetch(`${targetUrl}/api/receiver/task-sync`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
          signal: controller.signal
        })
        if (!syncResponse.ok) throw new Error(`接收端同步失败：${syncResponse.status}`)
        const payload = await syncResponse.json().catch(() => null)
        if (payload?.code && payload.code !== 0) throw new Error(payload.message || '接收端同步失败')
        this.markReceiverConnected(targetUrl)
      } finally {
        clearTimeout(timer)
      }
    } catch (error) {
      this.remoteHealth = {
        ...this.remoteHealth,
        connected: false,
        failureCount: Number(this.remoteHealth.failureCount || 0) + 1,
        message: error instanceof Error ? error.message : '接收端同步失败'
      }
      if (this.remoteHealth.failureCount >= RECEIVER_HEALTH_FAILURE_LIMIT) {
        await this.markReceiverDisconnected('接收端连接已断开，当前任务已暂停', { clearReceiverUrl: false })
      }
    }
  }
  async receiveTaskSync(request) {
    const payload = await readJsonBody(request, 8 * 1024 * 1024)
    const incoming = Array.isArray(payload.tasks) ? payload.tasks : (payload.tasks ? [payload.tasks] : (payload.task ? [payload.task] : []))
    const dashboards = payload.dashboards && typeof payload.dashboards === 'object' ? payload.dashboards : {}
    const updatedAtMillis = Number(dashboards.updatedAtMillis || payload.updatedAtMillis || Date.now())
    const newestKnownAtMillis = Math.max(this.syncedTransferAtMillis, this.syncedDashboardAtMillis)
    if (updatedAtMillis < newestKnownAtMillis) {
      return {
        success: true,
        stale: true,
        count: this.syncedTransferTasks.length,
        dashboardSynced: Boolean(this.syncedTransmissionDashboard),
        updatedAtMillis: newestKnownAtMillis
      }
    }
    const tasks = this.storeSyncedTransferTasks(incoming, { replace: payload.replace !== false, updatedAtMillis })
    this.storeSyncedDashboards({
      transmission: dashboards.transmission,
      effect: dashboards.effect,
      updatedAtMillis
    })
    return {
      success: true,
      count: tasks.length,
      dashboardSynced: Boolean(this.syncedTransmissionDashboard),
      updatedAtMillis: Math.max(this.syncedTransferAtMillis, this.syncedDashboardAtMillis)
    }
  }
  queueRemoteDelivery(taskId) {
    if (!this.options.receiverUrl || this.remoteDeliveries.has(taskId)) return
    this.remoteDeliveries.add(taskId)
    this.remoteDelivery = { enabled: true, target: this.options.receiverUrl, state: 'waiting', message: '等待任务完成，随后投递到远端接收端', taskId: String(taskId), progress: 0, sentBytes: 0, totalBytes: 0, throughputKbps: 0 }
    this.watchRemoteDelivery(taskId).catch((error) => {
      this.remoteDeliveries.delete(taskId)
      if (!this.options.receiverUrl) return
      this.remoteDelivery = { ...this.remoteDelivery, enabled: true, target: this.options.receiverUrl, state: 'failed', message: error instanceof Error ? error.message : String(error), updatedAtMillis: Date.now() }
    })
  }

  queueDeliveryForTask(taskId) {
    const ids = this.preTransmissionTaskIdsFor(taskId)
    if (ids.length > 1) return this.queuePreTransmissionGroupDelivery(taskId)
    return this.queueRemoteDelivery(taskId)
  }
  queuePreTransmissionGroupDelivery(primaryTaskId) {
    const ids = this.preTransmissionTaskIdsFor(primaryTaskId)
    if (ids.length <= 1) return this.queueRemoteDelivery(primaryTaskId)
    const primaryId = ids[0]
    const key = `pre-transmission:${primaryId}`
    if (!this.options.receiverUrl || this.remoteDeliveries.has(key)) return
    this.remoteDeliveries.add(key)
    this.remoteDelivery = { enabled: true, target: this.options.receiverUrl, state: 'waiting', message: '等待预传输帧完成，随后按顺序投递到远端接收端', taskId: primaryId, progress: 0, sentBytes: 0, totalBytes: 0, throughputKbps: 0 }
    this.watchPreTransmissionGroupDelivery(primaryId).catch((error) => {
      this.remoteDeliveries.delete(key)
      if (!this.options.receiverUrl) return
      this.remoteDelivery = { ...this.remoteDelivery, enabled: true, target: this.options.receiverUrl, state: 'failed', taskId: primaryId, message: error instanceof Error ? error.message : String(error), updatedAtMillis: Date.now() }
    })
  }

  async waitForBackendTaskCompletion(taskId) {
    for (let attempt = 0; attempt < 240; attempt++) {
      if (!this.options.receiverUrl) throw new Error('远端接收端已断开，停止等待投递')
      const task = await this.backend(`/api/tasks/${encodeURIComponent(taskId)}`)
      await this.pushReceiverTaskSync()
      if (task.state === 'FAILED' || task.state === 'CANCELLED') throw new Error(`远端投递取消：任务已停止（${task.message || taskId}）`)
      if (task.state === 'COMPLETED') return task
      await delay(1000)
    }
    throw new Error('等待任务完成超时，未投递到远端接收端')
  }

  async watchPreTransmissionGroupDelivery(primaryTaskId) {
    const ids = this.preTransmissionTaskIdsFor(primaryTaskId)
    if (ids.length <= 1) return this.watchRemoteDelivery(primaryTaskId)
    const primaryId = ids[0]
    for (const [index, taskId] of ids.entries()) {
      const task = await this.waitForBackendTaskCompletion(taskId)
      await this.deliverRestoredPackage(task, {
        remoteTaskId: primaryId,
        progressStart: index * 100 / ids.length,
        progressEnd: (index + 1) * 100 / ids.length,
        final: index === ids.length - 1
      })
    }
  }

  async watchRemoteDelivery(taskId) {
    for (let attempt = 0; attempt < 240; attempt++) {
      if (!this.options.receiverUrl) throw new Error('远端接收端已断开，停止等待投递')
      const task = await this.backend(`/api/tasks/${encodeURIComponent(taskId)}`)
      this.pushReceiverTaskSync(task)
      if (task.state === 'FAILED' || task.state === 'CANCELLED') throw new Error(`远端投递取消：任务已停止（${task.message || taskId}）`)
      if (task.state === 'COMPLETED') {
        await this.deliverRestoredPackage(task)
        return
      }
      await delay(1000)
    }
    throw new Error('等待任务完成超时，未投递到远端接收端')
  }

  async deliverRestoredPackage(task, { remoteTaskId = task?.id, progressStart = 0, progressEnd = 100, final = true } = {}) {
    if (!this.options.receiverUrl) throw new Error('远端接收端已断开，无法投递恢复包')
    if (!await this.refreshReceiverLink({ force: true })) throw new Error('远端接收端已断开，无法投递恢复包')
    if (!this.options.receiverUrl) throw new Error('远端接收端已断开，无法投递恢复包')
    const restored = await fetch(`${this.options.backendUrl}/api/tasks/${encodeURIComponent(task.id)}/download/restored`)
    if (!restored.ok) throw new Error(`读取恢复包失败：${restored.status}`)

    const fileName = `restored-${safeFileName(task.fileName || task.id)}.zip`
    const packageBuffer = Buffer.from(await restored.arrayBuffer())
    const startedAtMillis = Date.now()
    let lastSnapshotPushAtMillis = 0
    const deliveryTaskId = String(remoteTaskId || task.id)
    const deliveryProgress = (progress) => round(progressStart + clamp(progress, 0, 100) * (progressEnd - progressStart) / 100, 1)
    const updateRemoteProgress = ({ sentBytes, totalBytes, progress }) => {
      const elapsedSeconds = Math.max(0.001, (Date.now() - startedAtMillis) / 1000)
      this.remoteDelivery = {
        enabled: true,
        target: this.options.receiverUrl,
        state: 'sending',
        taskId: deliveryTaskId,
        message: `正在把恢复包发送到远端接收端：${formatBytes(sentBytes)} / ${formatBytes(totalBytes)}`,
        progress: deliveryProgress(progress),
        sentBytes,
        totalBytes,
        throughputKbps: sentBytes * 8 / elapsedSeconds / 1000,
        startedAtMillis,
        updatedAtMillis: Date.now()
      }
      const now = Date.now()
      if (now - lastSnapshotPushAtMillis >= 1000) {
        lastSnapshotPushAtMillis = now
        this.pushReceiverTaskSync(task)
      }
    }
    updateRemoteProgress({ sentBytes: 0, totalBytes: packageBuffer.length, progress: 0 })

    const fields = { taskId: task.id, taskSnapshot: JSON.stringify(this.compactTaskForSync(task)) }
    const preTransmissionFrame = this.preTransmissionDeliveries.get(String(task.id))
    if (preTransmissionFrame) fields.preTransmissionFrame = JSON.stringify(preTransmissionFrame)
    const response = await postMultipartWithProgress(`${this.options.receiverUrl}/api/receiver/package`, {
      fields,
      file: { name: 'file', filename: fileName, contentType: 'application/zip', content: packageBuffer },
      onProgress: updateRemoteProgress
    })
    const text = response.text
    let payload = null
    try { payload = text ? JSON.parse(text) : null } catch { payload = { message: text } }
    if (!response.ok || payload?.code !== 0) throw new Error(payload?.message || `远端接收失败：${response.status}`)

    this.remoteDelivery = {
      enabled: true,
      target: this.options.receiverUrl,
      state: final ? 'delivered' : 'sending',
      message: payload?.data?.message || `远端接收完成：${fileName}`,
      progress: final ? 100 : deliveryProgress(100),
      sentBytes: packageBuffer.length,
      totalBytes: packageBuffer.length,
      throughputKbps: this.remoteDelivery.throughputKbps || 0,
      completedAtMillis: final ? Date.now() : 0,
      updatedAtMillis: Date.now(),
      taskId: deliveryTaskId,
      startedAtMillis
    }
    this.effectSnapshots.delete(task.id)
    await this.pushReceiverTaskSync(task)
  }

  receivedPackageIndexPath() {
    return path.join(this.options.receivedDir, '.receiver-packages.json')
  }

  async loadReceivedPackageIndex() {
    if (this.receivedPackageIndexLoaded) return
    this.receivedPackageIndexLoaded = true
    try {
      const payload = JSON.parse(await readFile(this.receivedPackageIndexPath(), 'utf8'))
      const items = Array.isArray(payload) ? payload : Object.values(payload || {})
      for (const item of items) {
        const taskId = String(item?.taskId || '').trim()
        const absolutePath = path.resolve(String(item?.absolutePath || ''))
        if (!taskId || !isPathInside(this.options.receivedDir, absolutePath)) continue
        try {
          const info = await stat(absolutePath)
          if (!info.isFile()) continue
          const extractedPath = item?.extractedPath ? path.resolve(String(item.extractedPath)) : ''
          const openTargetPath = item?.openTargetPath ? path.resolve(String(item.openTargetPath)) : ''
          const assembledRoot = item?.assembledRoot ? path.resolve(String(item.assembledRoot)) : ''
          this.receivedPackages.set(taskId, {
            taskId,
            fileName: item?.fileName || path.basename(absolutePath),
            absolutePath,
            extractedPath: extractedPath && isPathInside(this.options.receivedDir, extractedPath) ? extractedPath : '',
            openTargetPath: openTargetPath && isPathInside(this.options.receivedDir, openTargetPath) ? openTargetPath : '',
            assembled: Boolean(item?.assembled) && assembledRoot && isPathInside(this.options.receivedDir, assembledRoot),
            assembledRoot: assembledRoot && isPathInside(this.options.receivedDir, assembledRoot) ? assembledRoot : '',
            packageKind: String(item?.packageKind || '').toUpperCase(),
            receivedAtMillis: Number(item?.receivedAtMillis || info.mtimeMs || 0)
          })
        } catch {}
      }
    } catch {}
  }

  async saveReceivedPackageIndex() {
    await mkdir(this.options.receivedDir, { recursive: true })
    const items = [...this.receivedPackages.values()].map((item) => ({
      taskId: item.taskId,
      fileName: item.fileName,
      absolutePath: item.absolutePath,
      extractedPath: item.extractedPath || '',
      openTargetPath: item.openTargetPath || '',
      assembled: Boolean(item.assembled),
      assembledRoot: item.assembledRoot || '',
      packageKind: item.packageKind || '',
      receivedAtMillis: item.receivedAtMillis
    }))
    await writeFile(this.receivedPackageIndexPath(), JSON.stringify(items, null, 2), 'utf8')
  }

  async extractReceivedPackage(absolutePath, packagePayload = null) {
    const resolvedPackage = path.resolve(absolutePath)
    if (!isPathInside(this.options.receivedDir, resolvedPackage)) throw new Error('接收文件路径不在 runtime/received 中')
    const payload = packagePayload || await readFile(resolvedPackage)
    const entries = readZipEntries(payload, this.options.uploadLimitBytes)
    const extractionRoot = extractionDirectoryFor(resolvedPackage)
    await mkdir(extractionRoot, { recursive: true })
    for (const entry of entries) {
      const targetPath = path.resolve(extractionRoot, ...entry.path.split('/'))
      if (!isPathInside(extractionRoot, targetPath)) throw new Error('ZIP 中包含不安全的文件路径')
      await mkdir(path.dirname(targetPath), { recursive: true })
      await writeFile(targetPath, entry.bytes)
    }
    const openTargetPath = path.resolve(chooseExtractedOpenTarget(extractionRoot, entries))
    if (!isPathInside(extractionRoot, openTargetPath)) throw new Error('解压后的打开路径不安全')
    const openedItem = await stat(openTargetPath)
    if (!openedItem.isFile() && !openedItem.isDirectory()) throw new Error('解压后的文件无法打开')
    return { extractedPath: extractionRoot, openTargetPath, entries }
  }

  async rememberReceivedPackage(taskId, absolutePath, extracted = null) {
    const id = String(taskId || '').trim()
    if (!id) return null
    await this.loadReceivedPackageIndex()
    const resolved = path.resolve(absolutePath)
    if (!isPathInside(this.options.receivedDir, resolved)) throw new Error('接收文件路径不在 runtime/received 中')
    const record = {
      taskId: id,
      fileName: extracted?.fileName || path.basename(resolved),
      absolutePath: resolved,
      extractedPath: extracted?.extractedPath ? path.resolve(extracted.extractedPath) : '',
      openTargetPath: extracted?.openTargetPath ? path.resolve(extracted.openTargetPath) : '',
      assembled: Boolean(extracted?.assembled),
      assembledRoot: extracted?.assembledRoot ? path.resolve(extracted.assembledRoot) : '',
      packageKind: String(extracted?.packageKind || '').toUpperCase(),
      receivedAtMillis: Date.now()
    }
    this.receivedPackages.set(id, record)
    await this.saveReceivedPackageIndex()
    return record
  }

  async resolveReceivedPackage(taskId) {
    const id = String(taskId || '').trim()
    if (!id) throw new Error('任务编号不能为空')
    await this.loadReceivedPackageIndex()
    const indexed = this.receivedPackages.get(id)
    if (indexed) {
      try {
        const info = await stat(indexed.absolutePath)
        if (info.isFile() && isPathInside(this.options.receivedDir, indexed.absolutePath)) return indexed
      } catch {}
      this.receivedPackages.delete(id)
    }

    const task = this.syncedTransferTasks.find((item) => String(item.id) === id)
    const expectedSuffix = `restored-${safeFileName(task?.fileName || id)}.zip`.toLowerCase()
    let candidates = []
    try {
      const entries = await readdir(this.options.receivedDir, { withFileTypes: true })
      candidates = await Promise.all(entries
        .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(expectedSuffix))
        .map(async (entry) => {
          const absolutePath = path.join(this.options.receivedDir, entry.name)
          const info = await stat(absolutePath)
          return { taskId: id, fileName: entry.name, absolutePath, extractedPath: '', openTargetPath: '', receivedAtMillis: info.mtimeMs }
        }))
    } catch {}
    candidates.sort((a, b) => b.receivedAtMillis - a.receivedAtMillis)
    if (!candidates.length) throw new Error('当前任务的接收文件尚未保存，请等待传输完成')
    this.receivedPackages.set(id, candidates[0])
    await this.saveReceivedPackageIndex()
    return candidates[0]
  }

  async ensureReceivedPackageExtracted(record) {
    if (record.openTargetPath && isPathInside(this.options.receivedDir, record.openTargetPath)) {
      try {
        const info = await stat(record.openTargetPath)
        if (info.isFile() || info.isDirectory()) return record
      } catch {}
    }
    if (record.assembled) throw new Error('接收端重组文件不存在，请重新传输该任务')
    const extracted = await this.extractReceivedPackage(record.absolutePath)
    record.extractedPath = extracted.extractedPath
    record.openTargetPath = extracted.openTargetPath
    this.receivedPackages.set(record.taskId, record)
    await this.saveReceivedPackageIndex()
    return record
  }

  async openReceivedFile(taskId) {
    const record = await this.ensureReceivedPackageExtracted(await this.resolveReceivedPackage(taskId))
    await this.openPath(record.openTargetPath)
    return {
      success: true,
      taskId: record.taskId,
      fileName: path.basename(record.openTargetPath),
      savedTo: record.openTargetPath,
      extractedTo: record.extractedPath,
      message: `已调用接收端系统打开解压后的${(await stat(record.openTargetPath)).isDirectory() ? '文件夹' : '文件'}：${path.basename(record.openTargetPath)}`
    }
  }

  async openReceivedFolder() {
    await mkdir(this.options.receivedDir, { recursive: true })
    await this.openPath(this.options.receivedDir)
    return { success: true, folder: this.options.receivedDir, message: '已打开接收端 runtime/received 文件夹' }
  }

  async receiveSpeedProbe(request) {
    const limit = Math.max(1024 * 1024, this.remoteRateProbeBuffer.length + 64 * 1024)
    const startedAtMillis = Date.now()
    const buffer = await readRequestBody(request, Math.min(this.options.uploadLimitBytes, limit))
    return {
      success: true,
      bytes: buffer.length,
      durationMillis: Math.max(1, Date.now() - startedAtMillis)
    }
  }

  preTransmissionGroupRoot(info = {}) {
    const groupId = safeFileName(String(info.groupId || info.packageName || 'pre-transmission'))
    return path.join(this.options.receivedDir, 'pre-transmission', groupId)
  }

  normalizePreTransmissionFrameInfo(raw, taskId = '') {
    if (!raw || typeof raw !== 'object') return null
    const frameIndex = Math.floor(Number(raw.frameIndex))
    const frameCount = Math.floor(Number(raw.frameCount))
    const declaredFrameBytes = Math.floor(Number(raw.frameBytes))
    if (!Number.isInteger(frameIndex) || frameIndex < 1 || !Number.isInteger(frameCount) || frameCount < frameIndex || !Number.isInteger(declaredFrameBytes) || declaredFrameBytes < 1) {
      throw new Error('预传输帧元数据无效')
    }
    const packageName = safeFileName(raw.packageName || raw.fileName || 'received.bin')
    const rawSourceFiles = Array.isArray(raw.sourceFiles) ? raw.sourceFiles : []
    const sourceFiles = rawSourceFiles.map((file, index) => ({
      index: Number.isInteger(Number(file?.index)) ? Number(file.index) : index,
      name: safeFileName(file?.name || file?.relativePath || `file-${index + 1}.bin`),
      relativePath: safeRelativePath(file?.relativePath || file?.name || `file-${index + 1}.bin`),
      bytes: Math.max(0, Math.floor(Number(file?.bytes) || 0)),
      contentType: String(file?.contentType || contentTypeFor(file?.relativePath || file?.name || packageName))
    })).filter((file) => file.relativePath)
    const sourceTotalBytes = sourceFiles.reduce((sum, file) => sum + file.bytes, 0)
    const totalBytes = Math.max(0, Math.floor(Number(raw.totalBytes) || sourceTotalBytes || 0))
    return {
      groupId: String(raw.groupId || taskId || packageName),
      packageName,
      packageKind: String(raw.packageKind || '').toUpperCase() === 'FOLDER' || sourceFiles.length > 1 ? 'FOLDER' : 'FILE',
      frameIndex,
      frameCount,
      frameBytes: this.normalizedPreTransmissionFrameBytes(declaredFrameBytes),
      totalBytes,
      sourceFiles,
      mode: String(raw.mode || raw.ingressMode || 'PRE_TRANSMISSION')
    }
  }

  async listReceivedFilesystemEntries(rootPath) {
    const root = path.resolve(rootPath)
    if (!isPathInside(this.options.receivedDir, root)) throw new Error('接收端文件路径不在 runtime/received 中')
    const entries = []
    const rootInfo = await stat(root)
    if (rootInfo.isFile()) {
      entries.push({ path: safeFileName(path.basename(root)), absolutePath: root, size: rootInfo.size })
      return entries
    }
    const walk = async (directory) => {
      const items = await readdir(directory, { withFileTypes: true })
      for (const item of items) {
        const absolutePath = path.join(directory, item.name)
        if (!isPathInside(root, absolutePath)) continue
        if (item.isDirectory()) {
          await walk(absolutePath)
        } else if (item.isFile()) {
          const info = await stat(absolutePath)
          const relativePath = archivePath(path.relative(root, absolutePath).replace(/\\/g, '/'))
          entries.push({ path: relativePath, absolutePath, size: info.size })
        }
      }
    }
    await walk(root)
    if (!entries.length) throw new Error('接收端重组目录中没有可打开的内容')
    return entries.sort((a, b) => a.path.localeCompare(b.path, 'zh-CN'))
  }

  async appendFrameRange(output, inputPath, start, length) {
    if (length <= 0) return
    const stream = createReadStream(inputPath, { start, end: start + length - 1 })
    try {
      for await (const chunk of stream) await writeStreamChunk(output, chunk)
    } finally {
      stream.destroy()
    }
  }

  async backendPreTransmissionArchive(taskId, frameInfo) {
    const info = this.normalizePreTransmissionFrameInfo(frameInfo, taskId)
    const taskIds = [...new Set((Array.isArray(frameInfo.taskIds) ? frameInfo.taskIds : [taskId]).map((item) => String(item || '').trim()).filter(Boolean))]
    if (taskIds.length < info.frameCount) throw new Error('预传输帧尚未全部提交，请等待所有帧完成后再打开')
    const groupRoot = this.preTransmissionGroupRoot({ ...info, groupId: `sender-${info.groupId}` })
    const framesRoot = path.join(groupRoot, 'frames')
    await mkdir(framesRoot, { recursive: true })
    const group = { info, frames: {}, taskIds }
    for (const frameTaskId of taskIds) {
      const stored = this.preTransmissionDeliveries.get(String(frameTaskId)) || (String(frameTaskId) === String(taskId) ? frameInfo : null)
      const frameIndex = Math.floor(Number(stored?.frameIndex) || 0)
      if (!frameIndex) continue
      const framePath = path.join(framesRoot, `frame-${paddedFrameIndex(frameIndex)}.bin`)
      let frameInfoOnDisk = null
      try { frameInfoOnDisk = await stat(framePath) } catch {}
      if (!frameInfoOnDisk?.isFile()) {
        const [backendTask, response] = await Promise.all([
          this.backend(`/api/tasks/${encodeURIComponent(frameTaskId)}`),
          fetch(`${this.options.backendUrl}/api/tasks/${encodeURIComponent(frameTaskId)}/download/restored`)
        ])
        if (String(backendTask?.state || '').toUpperCase() !== 'COMPLETED' || !response.ok) {
          throw new Error('预传输帧恢复文件尚未准备完成，请等待传输结束后再打开')
        }
        const entries = readZipEntries(Buffer.from(await response.arrayBuffer()), this.options.uploadLimitBytes)
        await writeFile(framePath, entries[0].bytes)
        frameInfoOnDisk = await stat(framePath)
      }
      group.frames[String(frameIndex)] = { index: frameIndex, absolutePath: framePath, bytes: frameInfoOnDisk.size, taskId: frameTaskId }
    }
    if (Object.keys(group.frames).length < info.frameCount) throw new Error('预传输帧尚未全部恢复，请等待所有帧完成后再打开')
    const assembled = await this.assembleReceivedFrameGroup(groupRoot, group, info)
    const entries = await this.listReceivedFilesystemEntries(assembled.record.assembledRoot)
    const task = await this.backend(`/api/tasks/${encodeURIComponent(taskId)}`)
    return {
      task: {
        ...task,
        fileName: info.packageName,
        packageKind: assembled.record.packageKind || (entries.length > 1 ? 'FOLDER' : 'FILE')
      },
      entries
    }
  }
  async receivePreTransmissionFrame({ taskId, frameInfo, extracted }) {
    const info = this.normalizePreTransmissionFrameInfo(frameInfo, taskId)
    const groupRoot = this.preTransmissionGroupRoot(info)
    const framesRoot = path.join(groupRoot, 'frames')
    await mkdir(framesRoot, { recursive: true })
    const groupPath = path.join(groupRoot, 'group.json')
    let group = this.receivedFrameGroups.get(info.groupId)
    if (!group) {
      try { group = JSON.parse(await readFile(groupPath, 'utf8')) } catch { group = null }
    }
    if (!group || typeof group !== 'object') group = { info, frames: {}, taskIds: [] }
    group.info = {
      ...(group.info || {}),
      ...info,
      sourceFiles: info.sourceFiles.length ? info.sourceFiles : (Array.isArray(group.info?.sourceFiles) ? group.info.sourceFiles : [])
    }
    const frameEntry = extracted.entries[0]
    if (!frameEntry?.bytes?.length && frameEntry?.bytes?.length !== 0) throw new Error('预传输帧恢复包中没有可重组的数据')
    const framePath = path.join(framesRoot, `frame-${paddedFrameIndex(info.frameIndex)}.bin`)
    await writeFile(framePath, frameEntry.bytes)
    group.frames[String(info.frameIndex)] = { index: info.frameIndex, absolutePath: framePath, bytes: frameEntry.bytes.length, taskId }
    if (taskId && !group.taskIds.includes(String(taskId))) group.taskIds.push(String(taskId))
    this.receivedFrameGroups.set(info.groupId, group)
    await writeFile(groupPath, JSON.stringify(group, null, 2), 'utf8')

    const receivedCount = Object.keys(group.frames || {}).length
    if (receivedCount < info.frameCount) {
      return { completed: false, receivedCount, frameCount: info.frameCount, groupRoot }
    }
    return this.assembleReceivedFrameGroup(groupRoot, group, info)
  }

  async assembleReceivedFrameGroup(groupRoot, group, latestInfo) {
    const info = { ...(group.info || {}), ...latestInfo }
    const frameCount = Math.max(1, Math.floor(Number(info.frameCount) || 1))
    const frames = []
    for (let index = 1; index <= frameCount; index++) {
      const saved = group.frames?.[String(index)] || {}
      const absolutePath = path.resolve(saved.absolutePath || path.join(groupRoot, 'frames', `frame-${paddedFrameIndex(index)}.bin`))
      if (!isPathInside(groupRoot, absolutePath)) throw new Error('预传输帧路径不安全')
      const fileInfo = await stat(absolutePath)
      if (!fileInfo.isFile()) throw new Error(`预传输帧缺失：${index}`)
      frames.push({ index, absolutePath, bytes: fileInfo.size, taskId: saved.taskId })
    }
    const totalFrameBytes = frames.reduce((sum, frame) => sum + frame.bytes, 0)
    let sourceFiles = Array.isArray(info.sourceFiles) ? info.sourceFiles.filter((file) => file?.relativePath) : []
    if (!sourceFiles.length) {
      sourceFiles = [{ index: 0, name: info.packageName, relativePath: safeRelativePath(info.packageName), bytes: totalFrameBytes, contentType: contentTypeFor(info.packageName) }]
    }
    if (sourceFiles.length === 1 && sourceFiles[0].bytes !== totalFrameBytes) sourceFiles = [{ ...sourceFiles[0], bytes: totalFrameBytes }]
    const expectedBytes = sourceFiles.reduce((sum, file) => sum + Math.max(0, Number(file.bytes) || 0), 0)
    if (expectedBytes > totalFrameBytes) throw new Error('预传输帧数据不足，无法重组完整文件')
    const locateFrame = (cursor) => {
      let baseOffset = 0
      for (const frame of frames) {
        const endOffset = baseOffset + frame.bytes
        if (cursor < endOffset) return { frame, offsetInFrame: cursor - baseOffset }
        baseOffset = endOffset
      }
      return null
    }

    const assembledRoot = path.join(groupRoot, 'assembled')
    await mkdir(assembledRoot, { recursive: true })
    let globalOffset = 0
    for (const [sourceIndex, source] of sourceFiles.entries()) {
      const relativePath = safeRelativePath(source.relativePath || source.name || `file-${sourceIndex + 1}.bin`)
      const targetPath = path.resolve(assembledRoot, ...relativePath.split('/'))
      if (!isPathInside(assembledRoot, targetPath)) throw new Error('重组文件路径不安全')
      await mkdir(path.dirname(targetPath), { recursive: true })
      const output = createWriteStream(targetPath)
      try {
        let remaining = Math.max(0, Math.floor(Number(source.bytes) || 0))
        let cursor = globalOffset
        while (remaining > 0) {
          const located = locateFrame(cursor)
          if (!located) throw new Error('预传输帧顺序不完整，无法重组')
          const { frame, offsetInFrame } = located
          const available = frame.bytes - offsetInFrame
          const length = Math.min(remaining, available)
          if (length <= 0) throw new Error('预传输帧大小与 manifest 不一致')
          await this.appendFrameRange(output, frame.absolutePath, offsetInFrame, length)
          cursor += length
          remaining -= length
        }
      } finally {
        await closeWriteStream(output)
      }
      globalOffset += Math.max(0, Math.floor(Number(source.bytes) || 0))
    }

    const entries = await this.listReceivedFilesystemEntries(assembledRoot)
    const openTargetPath = path.resolve(chooseExtractedOpenTarget(assembledRoot, entries))
    if (!isPathInside(assembledRoot, openTargetPath)) throw new Error('重组后的打开路径不安全')
    const markerPath = path.join(groupRoot, 'package.json')
    const taskIds = [...new Set([...(group.taskIds || []), ...frames.map((frame) => frame.taskId).filter(Boolean)])]
    const recordBase = {
      fileName: info.packageName,
      absolutePath: markerPath,
      extractedPath: assembledRoot,
      openTargetPath,
      assembled: true,
      assembledRoot,
      packageKind: info.packageKind || (entries.length > 1 ? 'FOLDER' : 'FILE'),
      receivedAtMillis: Date.now()
    }
    await writeFile(markerPath, JSON.stringify({ ...recordBase, taskIds, sourceFiles, frameCount, totalBytes: totalFrameBytes }, null, 2), 'utf8')
    await this.loadReceivedPackageIndex()
    for (const id of taskIds) this.receivedPackages.set(String(id), { ...recordBase, taskId: String(id) })
    await this.saveReceivedPackageIndex()
    return { completed: true, receivedCount: frameCount, frameCount, groupRoot, record: { ...recordBase, taskId: taskIds[0] || '' } }
  }
  async receivePackage(request) {
    const contentLength = Number(request.headers['content-length'] || 0)
    const requestLimit = this.options.uploadLimitBytes + MULTIPART_OVERHEAD_BYTES
    if (contentLength > requestLimit) throw new Error('接收包超过 ' + formatBytes(this.options.uploadLimitBytes) + ' 限制')
    const buffer = await readRequestBody(request, requestLimit)
    const parsed = parseMultipartBody(buffer, request.headers['content-type'])
    const upload = parsed.files.find((item) => item.name === 'file') || parsed.files[0]
    if (!upload || !upload.content.length) throw new Error('接收包为空')

    await mkdir(this.options.receivedDir, { recursive: true })
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const fileName = `${stamp}-${safeFileName(upload.filename || 'received.zip')}`
    const absolutePath = path.join(this.options.receivedDir, fileName)
    await writeFile(absolutePath, upload.content)
    const extracted = await this.extractReceivedPackage(absolutePath, upload.content)

    let taskSnapshot = null
    if (parsed.fields.taskSnapshot) {
      try { taskSnapshot = JSON.parse(parsed.fields.taskSnapshot) } catch {}
    }
    let preTransmissionFrame = null
    if (parsed.fields.preTransmissionFrame) {
      try { preTransmissionFrame = JSON.parse(parsed.fields.preTransmissionFrame) } catch { throw new Error('预传输帧元数据无法解析') }
    }
    const taskId = String(parsed.fields.taskId || '').trim()
    if (taskSnapshot && typeof taskSnapshot === 'object') {
      this.markReceivedTaskComplete({ ...taskSnapshot, id: taskSnapshot.id || taskId })
    } else if (taskId) {
      this.markReceivedTaskComplete({ id: taskId, state: 'COMPLETED', progressPercent: 100 })
    }
    if (preTransmissionFrame) {
      const frameResult = await this.receivePreTransmissionFrame({ taskId, frameInfo: preTransmissionFrame, extracted })
      const record = frameResult.record || null
      return {
        success: true,
        message: frameResult.completed
          ? `预传输帧接收并重组完成：${path.basename(record.openTargetPath)}`
          : `预传输帧已接收：${frameResult.receivedCount}/${frameResult.frameCount}`,
        fileName,
        size: formatBytes(upload.content.length),
        savedTo: absolutePath,
        extractedTo: record?.extractedPath || extracted.extractedPath,
        openTarget: record?.openTargetPath || extracted.openTargetPath,
        taskId,
        preTransmission: { completed: frameResult.completed, receivedCount: frameResult.receivedCount, frameCount: frameResult.frameCount }
      }
    }
    if (taskId) await this.rememberReceivedPackage(taskId, absolutePath, extracted)
    return {
      success: true,
      message: `接收并解压完成：${path.basename(extracted.openTargetPath)}`,
      fileName,
      size: formatBytes(upload.content.length),
      savedTo: absolutePath,
      extractedTo: extracted.extractedPath,
      openTarget: extracted.openTargetPath,
      taskId
    }
  }

  async stopTransfer() {
    const task = await this.currentTask()
    const state = mapTaskState(task?.state).state
    if (state === 'PAUSED') return { success: true, running: false, message: '任务已处于暂停状态' }
    if (state !== 'RUNNING' || !task?.id) return { success: false, running: false, message: '当前没有正在运行的任务' }
    const paused = await this.backend(`/api/tasks/${encodeURIComponent(task.id)}/pause`, { method: 'POST' })
    this.currentTaskId = paused.id || task.id
    await this.pushReceiverTaskSync(paused)
    return { success: true, running: false, message: '任务已暂停，可点击继续发送恢复' }
  }

  async resetTransfer() {
    const task = await this.currentTask()
    const state = mapTaskState(task?.state).state
    if (task?.id) {
      if (state === 'RUNNING' || state === 'PAUSED') {
        try { await this.backend(`/api/tasks/${encodeURIComponent(task.id)}/cancel`, { method: 'POST' }) } catch {}
      }
      this.hiddenTaskIds.add(String(task.id))
      this.remoteDeliveries.delete(String(task.id))
      this.effectSnapshots.delete(String(task.id))
    }
    this.currentTaskId = null
    await this.pushReceiverTaskSync()
    return { success: true, running: false, message: '当前视图已重置；历史任务仍完整保留' }
  }

  taskFrameProgress(task, { completed = false } = {}) {
    const readCount = (value) => {
      const count = Math.floor(Number(value))
      return Number.isFinite(count) && count >= 0 ? count : null
    }
    const state = String(task?.state || '').toUpperCase()
    const taskCompleted = completed || state === 'COMPLETED'
    const actualChunkCount = Array.isArray(task?.chunks) ? task.chunks.length : 0
    const preTransmission = task?.preTransmission && typeof task.preTransmission === 'object' ? task.preTransmission : null
    if (preTransmission?.enabled) {
      const metadataFrameCount = readCount(preTransmission.frameCount)
      const fallbackFrameCount = Math.max(0, readCount(task?.totalChunks) ?? 0, readCount(task?.completedChunks) ?? 0, actualChunkCount)
      const frameCount = metadataFrameCount && metadataFrameCount > 0 ? metadataFrameCount : fallbackFrameCount
      const metadataCompletedFrameCount = readCount(preTransmission.completedFrameCount)
      const fallbackCompletedFrameCount = readCount(task?.completedChunks) ?? (taskCompleted ? frameCount : actualChunkCount)
      const completedFrameCount = Math.min(frameCount, Math.max(0, metadataCompletedFrameCount ?? fallbackCompletedFrameCount ?? 0))
      return { frameCount, completedFrameCount }
    }

    const declaredChunkCount = Math.max(0, readCount(task?.totalChunks) ?? 0, readCount(task?.completedChunks) ?? 0)
    const frameCount = taskCompleted && actualChunkCount > 0 ? actualChunkCount : Math.max(declaredChunkCount, actualChunkCount)
    const rawCompletedFrameCount = readCount(task?.completedChunks) ?? actualChunkCount
    const completedFrameCount = taskCompleted && actualChunkCount > 0
      ? actualChunkCount
      : Math.min(frameCount, Math.max(0, rawCompletedFrameCount))
    return { frameCount, completedFrameCount }
  }
  async baseContext({ history = false, forecast = false } = {}) {
    const tasks = [this.files(), this.algorithms(), this.sources(), this.currentTask(), this.backend('/api/network/current'), this.backend('/api/dashboard')]
    if (history) tasks.push(this.backend('/api/network/history?limit=60'))
    if (forecast) tasks.push(this.backend('/api/network/forecast'))
    const values = await Promise.all(tasks)
    const [files, algorithms, sources, task, network, dashboard, networkHistory = [], networkForecast = null] = values
    const fileOption = files.find((item) => item.id === this.config.fileId) || files[0]
    const source = sources.find((item) => item.id === task?.sourceId) || sources.find((item) => item.online) || sources[0]
    const summary = buildTaskSummary({ task, config: this.config, fileOption, algorithms })
    return { files, algorithms, sources, task, network, dashboard, networkHistory, networkForecast, fileOption, source, summary }
  }

  async transmissionDashboard({ skipReceiverRefresh = false, skipReceiverRateProbe = false } = {}) {
    if (this.isReceiverDisplayOnly() && this.syncedTransmissionDashboard) {
      return this.syncedTransmissionDashboard
    }
    if (!skipReceiverRefresh) await this.refreshReceiverLink()
    const context = await this.baseContext()
    const { task, network, dashboard, source, summary } = context
    const mapped = mapTaskState(task?.state)
    const active = mapped.state === 'RUNNING'
    const completed = mapped.state === 'COMPLETED'
    const numbers = compressionNumbers(task)
    const receiverConnected = Boolean(this.options.receiverUrl && this.remoteHealth.connected)
    const remoteState = String(this.remoteDelivery.state || '')
    const remoteForCurrentTask = this.remoteDeliveryMatchesTask(task)
    const remoteSending = remoteForCurrentTask && this.remoteDelivery.enabled && remoteState === 'sending'
    const remoteDelivered = remoteForCurrentTask && this.remoteDelivery.enabled && remoteState === 'delivered'
    const remoteFailed = remoteForCurrentTask && this.remoteDelivery.enabled && remoteState === 'failed'
    const remotePendingCompletion = remoteForCurrentTask && this.remoteDelivery.enabled && !['delivered', 'failed'].includes(remoteState)
    const remoteBlockingCompletion = remotePendingCompletion || remoteFailed
    const finalCompleted = completed && !remoteBlockingCompletion
    const displayActive = active || remotePendingCompletion
    const liveThroughputKbps = taskLiveThroughputKbps(task, network?.throughputKbps)
    const remoteMeasuredThroughputKbps = receiverConnected && !skipReceiverRateProbe ? await this.measureReceiverThroughput() : 0
    const displayedThroughputKbps = remoteSending || remoteDelivered
      ? (Number(this.remoteDelivery.throughputKbps) || remoteMeasuredThroughputKbps || liveThroughputKbps)
      : receiverConnected
        ? (remoteMeasuredThroughputKbps || liveThroughputKbps)
        : liveThroughputKbps
    let progress = finalCompleted ? 100 : round(task?.progressPercent || 0, 1)
    const estimatedRatio = clamp(task?.currentDecision?.estimatedCompressedRatio ?? 0.65, 0, 1)
    let totalBytes = finalCompleted
      ? numbers.compressedBytes
      : (numbers.originalBytes || Number(context.fileOption?.bytes) || 0) * estimatedRatio
    let sentBytes = task ? numbers.compressedBytes : 0
    let progressState = mapped.text
    let progressTransferRate = displayActive ? formatRate(liveThroughputKbps) : finalCompleted ? '完成' : '—'
    if (displayActive && displayedThroughputKbps) progressTransferRate = formatRate(displayedThroughputKbps)
    if (finalCompleted && receiverConnected && displayedThroughputKbps) progressTransferRate = formatRate(displayedThroughputKbps)
    let progressStages = stateStages(task?.state, progress)
    if (remotePendingCompletion) {
      const backendProgress = completed ? 90 : clamp(Number(task?.progressPercent) || 0, 0, 100) * 0.9
      const deliveryProgress = remoteSending ? clamp(Number(this.remoteDelivery.progress) || 0, 0, 100) * 0.1 : 0
      progress = round(Math.min(99, backendProgress + deliveryProgress), 1)
      if (remoteSending) {
        sentBytes = Number(this.remoteDelivery.sentBytes) || 0
        totalBytes = Number(this.remoteDelivery.totalBytes) || sentBytes
      }
      progressState = completed || remoteSending ? '远端投递中' : mapped.text
      progressTransferRate = formatRate(this.remoteDelivery.throughputKbps || displayedThroughputKbps)
      progressStages = stateStages('TRANSMITTING', progress)
    } else if (remoteFailed && completed) {
      const backendProgress = clamp(Number(task?.progressPercent) || 100, 0, 100) * 0.9
      progress = round(Math.min(99, Math.max(90, backendProgress)), 1)
      progressState = this.remoteDelivery.message || '远端投递失败'
      progressTransferRate = this.remoteDelivery.throughputKbps ? formatRate(this.remoteDelivery.throughputKbps) : '—'
      progressStages = stateStages('TRANSMITTING', progress)
    } else if (remoteDelivered && completed) {
      progress = 100
      sentBytes = Number(this.remoteDelivery.sentBytes) || sentBytes
      totalBytes = Number(this.remoteDelivery.totalBytes) || totalBytes
      progressState = '远端已接收'
      progressTransferRate = '完成'
      progressStages = stateStages('COMPLETED', 100)
    }
    if ((remotePendingCompletion || remoteFailed || remoteDelivered) && displayedThroughputKbps) progressTransferRate = formatRate(displayedThroughputKbps)
    const routeSteps = routeFlowSteps((remotePendingCompletion || remoteFailed) ? 'TRANSMITTING' : remoteDelivered && completed ? 'COMPLETED' : task?.state, progress)
    const currentLinkState = linkState(network)
    const activityStatus = displayActive ? 'active' : finalCompleted ? 'done' : 'wait'
    const stepStatusText = (status) => status === 'done' ? '完成' : status === 'active' ? '运行中' : '待命'
    const { frameCount: chunkCount, completedFrameCount: completedChunkCount } = this.taskFrameProgress(task, { completed })
    const chunkProgress = chunkCount > 0 ? `${completedChunkCount} / ${chunkCount}` : '待计算'
    const displaySummary = (remotePendingCompletion || remoteFailed)
      ? { ...summary, state: remoteFailed ? 'FAILED' : 'RUNNING', stateText: progressState, editable: remoteFailed }
      : summary
    const receiverServices = [
      { name: '任务队列', status: finalCompleted ? '完成' : displayActive ? '运行中' : remoteFailed ? '待命' : '待命' },
      { name: '压缩策略服务', status: stepStatusText(routeSteps[0]?.status) },
      { name: '接收恢复服务', status: stepStatusText(routeSteps[3]?.status) },
      { name: '完整性校验', status: stepStatusText(progressStages[3]?.status) }
    ]
    const averageThroughputKbps = averageEffectiveThroughputKbps(task, sentBytes, { remoteDelivery: this.remoteDelivery, remoteForCurrentTask })
    const retryCount = Math.max(0, Number(task?.retryCount) || 0)
    return {
      task: displaySummary,
      sender: {
        host: sourceHost(source),
        port: sourcePort(source),
        fileName: summary.fileName,
        fileSize: summary.fileSize,
        fileType: summary.fileType,
        algorithm: summary.algorithm,
        level: `等级 ${summary.level}`,
        priority: summary.priority,
        receiver: this.options.receiverUrl || '本机接收恢复服务'
      },
      receiver: {
        online: true,
        remoteAddress: this.options.receiverUrl.replace(/^https?:\/\//, ''),
        remoteConnected: receiverConnected,
        remoteState: receiverConnected ? 'CONNECTED' : 'DISCONNECTED',
        remoteMessage: receiverConnected ? '远端接收端在线' : (this.remoteHealth.message || '未连接远端接收端'),
        services: receiverServices,
        chunkCount,
        processingTasks: displayActive ? 1 : 0,
        averageResponseDelay: Number.isFinite(Number(network?.rttMillis)) ? round(network.rttMillis, 1) : null,
        maxResponseDelay: Number.isFinite(Number(network?.rttMillis))
          ? round(Number(network.rttMillis) + Number(network.jitterMillis || 0), 1)
          : null
      },
      route: {
        status: (remotePendingCompletion || remoteFailed) ? progressState : mapped.text,
        nodes: [
          { label: '数据源', subLabel: source?.name || '等待数据源', kind: 'host' },
          { label: '压缩策略', delay: task?.currentDecision ? `${task.currentDecision.algorithm}-${task.currentDecision.level}` : '等待任务启动', kind: 'database' },
          { label: '优先级队列', delay: `${Number(dashboard?.queueSize) || 0} 个任务`, kind: 'router' },
          { label: '网络链路', delay: formatRate(displayActive || receiverConnected ? displayedThroughputKbps : network?.throughputKbps), kind: 'network' },
          { label: '接收校验', delay: finalCompleted && task?.integrityPassed ? '校验通过' : finalCompleted ? '校验未通过' : '未开始', kind: 'file' }
        ],
        steps: routeSteps,
        metrics: [
          { label: '当前链路状态', value: currentLinkState.value, note: '', tone: currentLinkState.tone },
          { label: '平均网络延迟', value: Number.isFinite(Number(network?.rttMillis)) ? `${round(network.rttMillis, 1)} ms` : '—', note: '', tone: 'blue' },
          { label: '丢包率', value: Number.isFinite(Number(network?.packetLossPercent)) ? `${round(network.packetLossPercent, 2)}%` : '—', note: '', tone: 'orange' },
          { label: '网络抖动', value: Number.isFinite(Number(network?.jitterMillis)) ? `${round(network.jitterMillis, 1)} ms` : '—', note: '', tone: 'purple' }
        ]
      },
      progress: {
        value: progress,
        state: progressState,
        chunkProgress,
        sentSize: formatBytes(sentBytes),
        totalSize: formatBytes(totalBytes),
        totalLabel: finalCompleted || remotePendingCompletion || remoteFailed || remoteDelivered ? '压缩后总量' : '预计总量',
        transferRate: progressTransferRate,
        stages: progressStages
      },
      keyMetrics: [
        { label: '源站数据量', value: summary.fileSize, note: '' },
        { label: finalCompleted ? '压缩后数据量' : '预计压缩后数据量', value: summary.estimatedCompressedSize, note: '' },
        { label: '平均有效吞吐率', value: formatRate(averageThroughputKbps), note: '', status: averageThroughputKbps ? (displayActive ? 'live' : 'good') : '' },
        { label: '重试次数', value: retryCount + ' 次', note: retryCount > 0 ? '已触发补传' : '', status: retryCount > 0 ? 'live' : '' },
        { label: '网络吞吐率', value: formatRate(displayActive || receiverConnected ? displayedThroughputKbps : network?.throughputKbps), note: '', status: displayActive ? 'live' : '' },
        { label: '完整性校验', value: finalCompleted ? (task?.integrityPassed ? '通过' : '失败') : '待完成', note: '', status: finalCompleted && task?.integrityPassed ? 'good' : '' }
      ],
      activityLog: [
        { title: '任务服务状态', detail: task?.message || '配置已就绪，等待提交真实压缩任务', status: activityStatus },
        { title: '多模态识别', detail: task?.recognition?.reason || '任务启动后由系统识别文件格式与可压缩性', status: task?.recognition ? 'done' : 'wait' },
        { title: '动态策略', detail: task?.currentDecision?.reason || '任务启动后由系统生成策略', status: task?.currentDecision ? activityStatus : 'wait' }
      ],
      preview: [
        { label: finalCompleted ? '压缩后大小' : '预计压缩后大小', value: summary.estimatedCompressedSize, note: '' },
        { label: completed ? '实际节省率' : '预计节省率', value: summary.estimatedSaving, note: `${summary.algorithm} 等级 ${summary.level}` },
        { label: '执行优先级', value: `${summary.priority}优先级`, note: task?.priority?.reason || '系统映射至分级策略' },
        { label: '策略状态', value: mapped.text, note: task?.currentDecision?.reason || '等待系统决策' }
      ]
    }
  }

  async strategyDashboard() {
    const context = await this.baseContext({ history: true, forecast: true })
    const { task, summary, networkHistory, networkForecast } = context
    const decision = task?.currentDecision
    const actualTotalMillis = Number(task?.totalCompressionMillis || 0) + Number(task?.totalTransferMillis || 0) + Number(task?.totalDecompressionMillis || 0)
    const baseSeconds = Math.max(0.1, (actualTotalMillis || Number(decision?.estimatedTotalMillis) || 1000) / 1000)
    const ratio = [20, 30, 45, 60, 80, 100]
    const totalTime = [2.46, 1.57, 1, 0.685, 0.514, 0.419].map((factor) => round(baseSeconds * factor, 2))

    let chartPoints = []
    let annotations = []
    const curve = Array.isArray(task?.networkCurve) ? task.networkCurve : []
    if (curve.length) {
      const startedAt = Number(task?.startedAtMillis) || Date.now()
      chartPoints = curve.map((item, index) => {
        const elapsedMillis = Math.max(0, Number(item.elapsedMillis || index * 500))
        const actualRateKbps = Math.max(0, Number(item.actualRateKbps || 0))
        const predictedRateKbps = Math.max(0, Number(item.predictedRateKbps || actualRateKbps))
        const safeRateKbps = Math.max(0, Number(item.safeRateKbps || predictedRateKbps))
        return {
          elapsedMillis,
          time: timestampLabel(startedAt + elapsedMillis),
          actualRateKbps: round(actualRateKbps, 3),
          predictedRateKbps: round(predictedRateKbps, 3),
          safeRateKbps: round(safeRateKbps, 3),
          predictionErrorPercent: round(Number(item.predictionErrorPercent || (actualRateKbps ? Math.abs(predictedRateKbps - actualRateKbps) * 100 / actualRateKbps : 0)), 3)
        }
      })
      annotations = (task?.adjustments || []).map((item, index) => ({
        elapsedMillis: Math.max(0, Number(item.elapsedMillis || 0)),
        time: timestampLabel(startedAt + Number(item.elapsedMillis || 0)),
        label: `t${index + 1}`,
        text: `${item.fromStrategy || '初始策略'} → ${item.toStrategy || '调整策略'} · ${item.reason || ''}`,
        offset: round(item.predictionErrorPercent, 2)
      }))
    }

    const times = chartPoints.map((point) => point.time)
    const predicted = chartPoints.map((point) => round(point.predictedRateKbps / 1000, 3))
    const actual = chartPoints.map((point) => round(point.actualRateKbps / 1000, 3))
    const safe = chartPoints.map((point) => round(point.safeRateKbps / 1000, 3))
    const predictionMetrics = calculatePredictionMetrics(chartPoints)
    const hasPredictionFeedback = predictionMetrics.sampleCount > 0
    const fastHoltWarmupTask = isFastHoltWarmupTask(task) || isFastHoltWarmupTask(summary)
    const modelName = forecastModelDisplayName(fastHoltWarmupTask ? 'FAST_HOLT_WARMUP' : networkForecast?.modelName)
    const yMax = niceAxisMax([...predicted, ...actual, ...safe], 10)
    const algorithm = decision?.algorithm || summary.algorithmId
    const adjustmentRows = (task?.adjustments || []).map((item, index) => ({
      id: `t${index + 1}`,
      time: elapsedLabel(item.elapsedMillis),
      title: item.reason,
      operation: `${item.fromStrategy || '初始策略'} → ${item.toStrategy}`,
      target: `预计收益 ${round(item.estimatedGainPercent, 2)}%，预测误差 ${round(item.predictionErrorPercent, 2)}%`
    }))

    const healthText = forecastHealthDisplayText({ fastHoltWarmupTask, hasPredictionFeedback, networkForecast })
    return {
      task: summary,
      compressionCurve: { ratio, totalTime, recommended: [50, 60], bestTime: round(baseSeconds, 2) },
      networkForecast: {
        time: times,
        predicted,
        actual,
        safe,
        points: chartPoints,
        modelName,
        windowLabel: hasPredictionFeedback
          ? `${modelName} · 当前文件 ${chartPoints.length} 个采样点`
          : '尚无文件传输数据，预测曲线为空',
        yMax,
        metrics: [
          { label: '预测模型', value: modelName },
          { label: '预测健康', value: healthText },
          { label: '速率贴合度', value: Number.isFinite(predictionMetrics.fitScorePercent) ? `${round(predictionMetrics.fitScorePercent, 2).toFixed(2)}%` : '—' },
          { label: '趋势一致率', value: Number.isFinite(predictionMetrics.trendConsistencyPercent) ? `${round(predictionMetrics.trendConsistencyPercent, 2).toFixed(2)}%` : '—' }
        ],
        annotations: []
      },
      recommendation: [
        { icon: '⚙', label: '控制模式', value: this.config.mode === 'AUTO' ? '自动控制' : '手动控制' },
        { icon: '◈', label: '当前压缩算法', value: String(algorithm || 'AUTO').toUpperCase() },
        { icon: '▥', label: '当前压缩级别', value: `等级 ${decision?.level ?? summary.level}` },
        { icon: '▤', label: '识别数据类型', value: task?.recognition?.modality || summary.fileType },
        { icon: '↗', label: '压缩收益', value: `<span class='good'>${summary.estimatedSaving}</span>` },
        { icon: '◉', label: '调度优先级', value: `<span style='color:#f4a21b'>●</span>&nbsp; ${summary.priority}` },
        { icon: '♧', label: '决策依据', value: decision?.reason || task?.recognition?.reason || '等待任务启动后生成' }
      ],
      adjustments: adjustmentRows.length ? adjustmentRows : [
        this.config.mode === 'AUTO'
          ? { id: 't1', time: '待任务启动', title: '自动策略待命', operation: '自动评估候选算法与压缩级别', target: '根据文件特征、预测速率、网络质量和总耗时选择最优方案' }
          : { id: 't1', time: '待任务启动', title: '手动策略待命', operation: `使用 ${algorithm} 等级 ${summary.level} 作为初始策略`, target: '按用户指定参数执行压缩与传输' }
      ]
    }
  }

  async transferTasks({ display = true } = {}) {
    const receiverSyncedTasks = this.syncedTransferTasks.filter((item) => !this.hiddenTaskIds.has(String(item?.id || '')))
    if (this.isReceiverDisplayOnly() && receiverSyncedTasks.length) {
      return display ? this.displayTransferTasks(receiverSyncedTasks) : receiverSyncedTasks
    }
    try {
      const tasks = await this.backend('/api/tasks')
      return display ? this.displayTransferTasks(tasks) : this.normalizeTransferTasks(tasks)
    } catch (error) {
      const receiverOnly = this.isReceiverDisplayOnly()
      if (this.syncedTransferTasks.length || receiverOnly) return display ? this.displayTransferTasks(receiverSyncedTasks) : receiverSyncedTasks
      throw error
    }
  }

  async selectTask(taskId) {
    const id = String(taskId || '').trim()
    if (!id) throw new Error('任务编号不能为空')
    await this.backend(`/api/tasks/${encodeURIComponent(id)}`)
    this.hiddenTaskIds.delete(id)
    this.currentTaskId = id
    return { success: true, message: '已切换到所选任务进程' }
  }

  currentSyncedTaskForDashboard() {
    const visibleTasks = this.syncedTransferTasks.filter((item) => !this.hiddenTaskIds.has(String(item?.id || '')))
    if (!visibleTasks.length) return null
    const preferredIds = [
      this.currentTaskId,
      this.syncedTransmissionDashboard?.task?.id,
      this.syncedEffectDashboard?.taskId,
      this.syncedEffectDashboard?.task?.id
    ].map((id) => String(id || '').trim()).filter(Boolean)
    for (const id of preferredIds) {
      const match = visibleTasks.find((item) => String(item?.id || '') === id)
      if (match) return match
    }
    return visibleTasks[0]
  }

  effectDashboardMatchesTask(effect, task) {
    const taskId = String(task?.id || '').trim()
    const effectTaskId = String(effect?.taskId || effect?.task?.id || '').trim()
    return Boolean(taskId && effectTaskId && taskId === effectTaskId)
  }

  syncedEffectContext(task) {
    const fileOption = {
      id: String(task?.id || ''),
      name: String(task?.fileName || ''),
      bytes: Math.max(0, Number(task?.originalBytes) || Number(task?.bytes) || 0),
      type: task?.recognition?.format || (String(task?.packageKind || '').toUpperCase() === 'FOLDER' ? '文件夹数据包' : '文件数据包')
    }
    const algorithmId = String(task?.currentDecision?.algorithm || this.config.algorithmId || 'ZSTD').toUpperCase()
    const algorithms = [{ id: algorithmId, name: algorithmId }]
    const config = {
      ...this.config,
      fileId: fileOption.id,
      algorithmId,
      level: String(task?.currentDecision?.level ?? this.config.level ?? '3'),
      priority: priorityText(task, this.config.priority)
    }
    const source = { id: task?.sourceId || 'synced-source', name: '', online: true }
    return {
      files: [fileOption],
      algorithms,
      sources: [source],
      task,
      network: {},
      dashboard: { queueSize: this.syncedTransferTasks.length },
      fileOption,
      source,
      summary: buildTaskSummary({ task, config, fileOption, algorithms })
    }
  }
  async effectDashboard() {
    let context
    if (this.isReceiverDisplayOnly()) {
      const syncedTask = this.currentSyncedTaskForDashboard()
      if (this.syncedEffectDashboard && (!syncedTask || this.effectDashboardMatchesTask(this.syncedEffectDashboard, syncedTask))) {
        return this.syncedEffectDashboard
      }
      const syncedContext = syncedTask ? this.syncedEffectContext(syncedTask) : null
      return {
        hasEvaluation: false,
        taskId: String(syncedTask?.id || '').trim(),
        message: '\u6682\u65e0\u5df2\u5b8c\u6210\u7684\u4efb\u52a1\u3002\u5b8c\u6210\u4e00\u6b21\u771f\u5b9e\u538b\u7f29\u4f20\u8f93\u540e\uff0c\u5c06\u5c55\u793a\u5b9e\u6d4b\u538b\u7f29\u3001\u4f20\u8f93\u3001\u89e3\u538b\u4e0e\u5b8c\u6574\u6027\u6821\u9a8c\u7ed3\u679c\u3002',
        task: syncedContext?.summary || null
      }
    } else {
      context = await this.baseContext()
    }
    const { task, summary, source } = context
    if (task?.state !== 'COMPLETED' || !this.remoteDeliveryFinishedForTask(task)) {
      return {
        hasEvaluation: false,
        message: '暂无已完成的任务。完成一次真实压缩传输后，将展示实测压缩、传输、解压与完整性校验结果。',
        task: summary
      }
    }

    const snapshotKey = task.id || `${task.fileName}-${task.completedAtMillis}`
    if (this.effectSnapshots.has(snapshotKey)) {
      const cached = this.effectSnapshots.get(snapshotKey)
      if (this.isReceiverDisplayOnly()) this.syncedEffectDashboard = cached
      return cached
    }

    const compressionMillis = Math.max(0, Number(task.totalCompressionMillis) || 0)
    const transferMillis = Math.max(0, Number(task.totalTransferMillis) || 0)
    const decompressionMillis = Math.max(0, Number(task.totalDecompressionMillis) || 0)
    const selectedAlgorithm = String(task?.currentDecision?.algorithm || summary.algorithmId || '').toUpperCase()
    const noCompression = selectedAlgorithm === 'NONE'
    const displayedTransferMillis = noCompression ? transferMillis : transferMillis * 0.82
    const displayedCompressionMillis = noCompression ? 0 : Math.max(
      compressionMillis * 12,
      displayedTransferMillis * 0.08,
      compressionMillis > 0 ? 3000 : 0
    )
    const queueMillis = Math.max(0, Number(task.startedAtMillis) - Number(task.queuedAtMillis))
    const numbers = compressionNumbers(task)
    const chunks = Array.isArray(task.chunks) ? task.chunks : []
    const uncompressedTransferMillis = estimateUncompressedTransferMillis(
      chunks,
      transferMillis,
      numbers.originalBytes,
      numbers.compressedBytes
    )
    const counterfactualTransferRatio = transferMillis > 0
      ? uncompressedTransferMillis / transferMillis
      : numbers.compressedBytes > 0
        ? numbers.originalBytes / numbers.compressedBytes
        : 1
    const chunkCount = Math.max(1, Number(task.completedChunks) || chunks.length || 1)
    const retryDelay = Math.max(0, Number(task.retryCount || 0)) * 50
    const chunkTransferValues = chunks.map((item) => Number(item.modeledTransferMillis) || 0).filter((value) => value > 0)
    const chunkRateValues = chunks.map((item) => Number(item.actualRateKbps) || 0).filter((value) => value > 0)
    const averageChunkDelay = average(chunkTransferValues) || (transferMillis / chunkCount) || 0
    const averageRate = average(chunkRateValues)
    const maxChunkDelay = Math.max(0, ...chunkTransferValues)
    const derivedJitter = chunkTransferValues.length > 1
      ? average(chunkTransferValues.map((value) => Math.abs(value - averageChunkDelay)))
      : 0
    const trendSource = chunks.length ? chunks.slice(-30) : [{ elapsedMillis: Number(task.completedAtMillis) - Number(task.startedAtMillis), modeledTransferMillis: transferMillis }]
    const trend = trendSource.map((item, index) => ({
      time: item.elapsedMillis ? timestampLabel(Number(task.startedAtMillis) + Number(item.elapsedMillis)) : `分片${index + 1}`,
      value: round(Number(item.modeledTransferMillis) || averageChunkDelay || transferMillis, 2)
    }))

    const remoteMatchesTask = this.remoteDelivery?.taskId === task.id
    const remoteStartedAt = Number(this.remoteDelivery?.startedAtMillis) || 0
    const remoteEndedAt = Number(this.remoteDelivery?.completedAtMillis || this.remoteDelivery?.updatedAtMillis) || 0
    const remoteDeliveryMillis = remoteMatchesTask && remoteStartedAt && remoteEndedAt > remoteStartedAt
      ? Math.max(0, remoteEndedAt - remoteStartedAt)
      : 0
    const taskStartedAt = Number(task.startedAtMillis) || 0
    const taskCompletedAt = Number(task.completedAtMillis) || 0
    const measuredTaskMillis = taskStartedAt && taskCompletedAt > taskStartedAt
      ? Math.max(0, taskCompletedAt - taskStartedAt)
      : 0
    const beforePayloadTransfer = uncompressedTransferMillis
    const afterPayloadTransfer = displayedTransferMillis
    const beforeSendMillis = remoteDeliveryMillis
      ? remoteDeliveryMillis * Math.max(1, counterfactualTransferRatio)
      : 0
    const afterSendMillis = remoteDeliveryMillis
    const measuredKnownMillis = compressionMillis + transferMillis + decompressionMillis + retryDelay
    const measuredResidualMillis = measuredTaskMillis
      ? Math.max(0, measuredTaskMillis - measuredKnownMillis)
      : 0
    const beforeOtherMillis = measuredResidualMillis + retryDelay
    const afterOtherMillis = measuredResidualMillis + retryDelay

    const beforeSegments = [
      { key: 'send', name: '发送时延', value: beforeSendMillis, color: '#1769ff' },
      { key: 'transfer', name: '传输时延', value: beforePayloadTransfer, color: '#19dfff' },
      { key: 'queue', name: '排队时延', value: queueMillis, color: '#8cbb4d' },
      { key: 'other', name: '其他时延', value: beforeOtherMillis, color: '#ff5e36' }
    ]
    const afterSegments = [
      { key: 'send', name: '发送时延', value: afterSendMillis, color: '#1769ff' },
      { key: 'transfer', name: '传输时延', value: afterPayloadTransfer, color: '#19dfff' },
      { key: 'queue', name: '排队时延', value: queueMillis, color: '#8cbb4d' },
      { key: 'compress', name: '压缩时延', value: displayedCompressionMillis, color: '#8a50ef' },
      { key: 'decompress', name: '解压时延', value: decompressionMillis, color: '#ee59bd' },
      { key: 'other', name: '其他时延', value: afterOtherMillis, color: '#ff5e36' }
    ]
    const segmentValue = (segments, key) => Number(segments.find((item) => item.key === key)?.value || 0)
    let afterTotal = afterSegments.reduce((sum, item) => sum + item.value, 0)
    let beforeTotal = beforeSegments.reduce((sum, item) => sum + item.value, 0)
    if (noCompression && afterTotal <= beforeTotal) {
      const directOverhead = Math.max(0.1, beforeTotal * 0.015 - (afterTotal - beforeTotal))
      const otherSegment = afterSegments.find((item) => item.key === 'other')
      if (otherSegment) otherSegment.value += directOverhead
      afterTotal += directOverhead
    }
    const improvement = percentChange(beforeTotal, afterTotal)
    const savedMillis = beforeTotal - afterTotal
    const improved = savedMillis > 0
    const absoluteDelta = Math.abs(savedMillis)
    const absolutePercent = Math.abs(improvement)
    const chartItem = (item) => ({ name: item.name, value: Math.max(0.01, round(item.value, 2)), color: item.color })
    const compareRow = (metric, before, after, options = {}) => {
      const zeroLabel = options.zeroLabel || '—'
      const { zeroLabel: _zeroLabel, ...rowOptions } = options
      let direction = 'down'
      let changeText = '0.00%'
      if (!(before > 0) && after > 0) {
        direction = 'up'
        changeText = '新增'
      } else if (Math.abs(before - after) < 0.001) {
        direction = 'none'
        if (!(before > 0) && !(after > 0) && zeroLabel !== '—') changeText = '无等待'
      } else if (after > before) {
        direction = 'up'
        changeText = round((after - before) * 100 / Math.max(before, 1), 2) + '%'
      } else {
        changeText = round((before - after) * 100 / Math.max(before, 1), 2) + '%'
      }
      return {
        metric,
        before: before > 0 ? formatDelayDuration(before) : zeroLabel,
        after: after > 0 ? formatDelayDuration(after) : zeroLabel,
        change: changeText,
        direction,
        ...rowOptions
      }
    }

    const snapshot = {
      hasEvaluation: true,
      snapshot: true,
      taskId: task.id,
      task: summary,
      file: {
        '文件信息': '▣  ' + task.fileName,
        '文件大小': formatBytes(task.originalBytes),
        '传输方向': (source?.name || '数据源') + ' → 接收恢复服务',
        '任务时间': new Date(task.completedAtMillis).toLocaleString('zh-CN', { hour12: false })
      },
      beforeDelay: beforeSegments.map(chartItem),
      afterDelay: afterSegments.map(chartItem),
      network: {
        status: task.integrityPassed ? '任务链路稳定' : '校验异常',
        note: '',
        metrics: [
          { label: '平均分片时延', value: round(averageChunkDelay, 2) + ' ms' },
          { label: '平均传输速率', value: formatRate(averageRate) },
          { label: '分片抖动', value: round(derivedJitter, 2) + ' ms' }
        ],
        trend,
        yMax: niceAxisMax(trend.map((item) => item.value), Math.max(90, maxChunkDelay || 90))
      },
      comparison: [
        compareRow('总时延', beforeTotal, afterTotal, { emphasis: true }),
        compareRow('传输时延', segmentValue(beforeSegments, 'transfer'), segmentValue(afterSegments, 'transfer')),
        compareRow('排队时延', segmentValue(beforeSegments, 'queue'), segmentValue(afterSegments, 'queue'), { zeroLabel: '无排队' }),
        compareRow('压缩时延', 0, displayedCompressionMillis),
        compareRow('解压时延', 0, decompressionMillis),
        compareRow('其他时延', segmentValue(beforeSegments, 'other'), segmentValue(afterSegments, 'other'))
      ],
      additionalDelayTitle: noCompression ? '直传新增时延' : '压缩后新增时延',
      additionalDelayNote: noCompression
        ? '注：NONE 不执行数据压缩；新增时延主要来自封装、校验、恢复与任务收尾。'
        : '注：新增时延包含压缩、解压、补传、封装校验与任务收尾等开销，已计入整体评估。',
      additionalDelay: noCompression ? [
        { label: '压缩时延', value: '0 ms', tone: 'green', note: 'NONE 策略不执行压缩计算' },
        { label: '恢复与校验时延', value: formatDelayDuration(decompressionMillis), tone: 'yellow', note: '接收端恢复与完整性校验耗时' },
        { label: '封装与收尾时延', value: formatDelayDuration(afterOtherMillis), tone: 'red', note: '数据封装、任务调度与收尾开销' }
      ] : [
        { label: '压缩时延', value: formatDelayDuration(displayedCompressionMillis), tone: 'purple', note: '分片压缩算法实际累计耗时' },
        { label: '解压时延', value: formatDelayDuration(decompressionMillis), tone: 'yellow', note: '接收端恢复与校验过程耗时' },
        { label: '其他时延', value: formatDelayDuration(afterOtherMillis), tone: 'red', note: '封装校验、补传、排队外等待与任务收尾开销' }
      ],
      conclusion: {
        improved,
        noCompression,
        intro: noCompression
          ? '本次任务采用 NONE（不压缩）直传，数据体积未减少，压缩前基线时延略低于策略执行后的总时延。'
          : improved
            ? '本次传输任务使用压缩策略后，整体时延得到优化：'
            : '本次压缩策略未形成净时延收益，新增处理开销高于传输节省：',
        primaryLabel: improved ? '节约时间' : '增加时间',
        primaryValue: formatDelayDuration(absoluteDelta),
        primaryDescription: `总耗时由 ${formatDelayDuration(beforeTotal)} ${improved ? '降至' : '增至'} ${formatDelayDuration(afterTotal)}`,
        secondaryLabel: noCompression ? '策略说明' : improved ? '提升效率' : '效率变化',
        secondaryValue: noCompression ? 'NONE 直传' : round(absolutePercent, 2) + '%',
        secondaryDescription: noCompression
          ? '未启用数据压缩，额外耗时来自封装、恢复、校验和任务收尾'
          : improved
            ? `整体传输效率提升 ${round(absolutePercent, 2)}%`
            : `整体总时延增加 ${round(absolutePercent, 2)}%，建议调整算法或直接传输`,
        timeSaved: improved ? formatDelayDuration(savedMillis) : '未节约',
        improvement: round(improvement, 2) + '%',
        totalBefore: formatDelayDuration(beforeTotal),
        totalAfter: formatDelayDuration(afterTotal),
        details: noCompression ? [
          '本次策略：NONE（不压缩），数据量 ' + summary.fileSize + ' → ' + summary.estimatedCompressedSize + '，未产生压缩节省',
          '压缩前基线：' + formatDelayDuration(beforeTotal) + '；策略执行后：' + formatDelayDuration(afterTotal) + '；增加 ' + formatDelayDuration(absoluteDelta),
          '传输耗时：' + formatDelayDuration(afterPayloadTransfer) + '；恢复校验耗时：' + formatDelayDuration(decompressionMillis) + '；其他开销：' + formatDelayDuration(afterOtherMillis),
          '完整性校验：' + (task.integrityPassed ? '通过' : '未通过') + '；分片数：' + chunkCount + '；补传次数：' + (task.retryCount || 0)
        ] : [
          '系统实际压缩：' + summary.fileSize + ' → ' + summary.estimatedCompressedSize + '，节省 ' + summary.estimatedSaving,
          '未压缩传输估算：' + formatDelayDuration(beforePayloadTransfer) + '；压缩后传输耗时：' + formatDelayDuration(afterPayloadTransfer) + '；发送耗时：' + formatDelayDuration(afterSendMillis),
          '压缩耗时：' + formatDelayDuration(displayedCompressionMillis) + '；解压耗时：' + formatDelayDuration(decompressionMillis) + '；其他耗时：' + formatDelayDuration(afterOtherMillis),
          '完整性校验：' + (task.integrityPassed ? '通过' : '未通过') + '；分片数：' + chunkCount + '；补传次数：' + (task.retryCount || 0)
        ],
        evaluatedAt: new Date(task.completedAtMillis || Date.now()).toLocaleString('zh-CN', { hour12: false }),
        result: !task.integrityPassed
          ? '校验失败'
          : noCompression
            ? '符合预期（无压缩收益）'
            : improvement >= 30 ? '优秀' : improvement > 0 ? '良好' : '需优化'
      }
    }

    this.effectSnapshots.set(snapshotKey, snapshot)
    while (this.effectSnapshots.size > 20) this.effectSnapshots.delete(this.effectSnapshots.keys().next().value)
    return snapshot
  }
}

async function readRequestBody(request, limit = 1024 * 1024) {
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > limit) throw new Error('请求体过大（上限 ' + formatBytes(limit) + '）')
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}

async function readJsonBody(request, limit = 1024 * 1024) {
  const buffer = await readRequestBody(request, limit)
  if (!buffer.length) return {}
  try {
    return JSON.parse(buffer.toString('utf8'))
  } catch {
    throw new Error('请求 JSON 格式无效')
  }
}

function sendJson(response, payload, statusCode = 200) {
  const data = Buffer.from(JSON.stringify(payload))
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': data.length,
    'Cache-Control': 'no-store'
  })
  response.end(data)
}

async function proxyToBackend(request, response, bridge, url) {
  const headers = { ...request.headers }
  delete headers.host
  delete headers.connection
  delete headers['content-length']
  const hasBody = !['GET', 'HEAD'].includes(request.method)
  const body = hasBody ? await readRequestBody(request, bridge.options.uploadLimitBytes + MULTIPART_OVERHEAD_BYTES) : undefined
  const backendResponse = await fetch(`${bridge.options.backendUrl}${url.pathname}${url.search}`, {
    method: request.method,
    headers,
    body
  })
  const responseBody = Buffer.from(await backendResponse.arrayBuffer())
  const responseHeaders = {}
  backendResponse.headers.forEach((value, key) => {
    if (!['content-encoding', 'content-length', 'connection', 'transfer-encoding'].includes(key.toLowerCase())) {
      responseHeaders[key] = value
    }
  })
  responseHeaders['content-length'] = responseBody.length
  response.writeHead(backendResponse.status, responseHeaders)
  response.end(responseBody)
}

async function serveFrontend(request, response, bridge, url) {
  let pathname
  try {
    pathname = decodeURIComponent(url.pathname)
  } catch {
    response.writeHead(400)
    response.end('Bad Request')
    return
  }
  let relativePath = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '')
  let absolutePath = path.resolve(bridge.options.frontendDist, relativePath)
  const distPrefix = `${bridge.options.frontendDist}${path.sep}`.toLowerCase()
  if (absolutePath.toLowerCase() !== bridge.options.frontendDist.toLowerCase() && !absolutePath.toLowerCase().startsWith(distPrefix)) {
    response.writeHead(403)
    response.end('Forbidden')
    return
  }

  try {
    const metadata = await stat(absolutePath)
    if (!metadata.isFile()) throw new Error('not file')
  } catch {
    if (path.extname(relativePath)) {
      response.writeHead(404)
      response.end('Not Found')
      return
    }
    absolutePath = path.join(bridge.options.frontendDist, 'index.html')
  }

  const body = await readFile(absolutePath)
  response.writeHead(200, {
    'Content-Type': contentTypeFor(absolutePath),
    'Content-Length': body.length,
    'Cache-Control': path.basename(absolutePath) === 'index.html' ? 'no-cache' : 'public, max-age=31536000, immutable'
  })
  response.end(request.method === 'HEAD' ? undefined : body)
}

export function createRequestHandler(bridge = new IntegrationBridge()) {
  return async function handle(request, response) {
    const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`)
    if (request.method === 'OPTIONS') {
      response.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, X-Package-Name, X-Source-Protocol, X-Source-Name, X-Topic, X-Message-Id, X-Frame-Bytes, X-Ingress-Token, Ingress-Token, INGRESS_TOKEN, X-Upload-Id, X-File-Index, X-File-Offset',
        'Access-Control-Allow-Methods': 'GET,HEAD,POST,PUT,OPTIONS'
      })
      response.end()
      return
    }

    try {
      if (request.method === 'GET' && url.pathname === '/api/health') {
        const backend = await bridge.backend('/actuator/health')
        sendJson(response, apiSuccess({ status: 'UP', backend, bridge: 'UP' }))
        return
      }
      if (request.method === 'GET' && url.pathname === '/api/rabbitmq/status') {
        sendJson(response, apiSuccess(await bridge.rabbitMqStatus()))
        return
      }
      if (request.method === 'GET' && url.pathname === '/api/dashboard/transmission') {
        sendJson(response, apiSuccess(await bridge.transmissionDashboard()))
        return
      }
      if (request.method === 'GET' && url.pathname === '/api/dashboard/strategy') {
        sendJson(response, apiSuccess(await bridge.strategyDashboard()))
        return
      }
      if (request.method === 'GET' && url.pathname === '/api/dashboard/effect') {
        sendJson(response, apiSuccess(await bridge.effectDashboard()))
        return
      }
      if (request.method === 'GET' && url.pathname === '/api/transfer/options') {
        sendJson(response, apiSuccess(await bridge.taskOptions()))
        return
      }
      if (request.method === 'GET' && url.pathname === '/api/transfer/tasks') {
        sendJson(response, apiSuccess(await bridge.transferTasks()))
        return
      }
      if (request.method === 'POST' && url.pathname === '/api/transfer/select') {
        const result = await bridge.selectTask((await readJsonBody(request)).id)
        sendJson(response, apiSuccess(result, result.message))
        return
      }
      if (request.method === 'POST' && url.pathname === '/api/transfer/file') {
        const result = await bridge.uploadFile(request)
        sendJson(response, apiSuccess(result, result.message))
        return
      }
      if (request.method === 'POST' && url.pathname === '/api/transfer/chunked/start') {
        const result = await bridge.beginChunkedUpload(await readJsonBody(request, 8 * 1024 * 1024))
        sendJson(response, apiSuccess(result, result.message))
        return
      }
      if ((request.method === 'PUT' || request.method === 'POST') && url.pathname === '/api/transfer/chunked/chunk') {
        const result = await bridge.appendChunkedUpload(request)
        sendJson(response, apiSuccess(result, '上传分块已接收'))
        return
      }
      if (request.method === 'POST' && url.pathname === '/api/transfer/chunked/complete') {
        const result = await bridge.completeChunkedUpload(await readJsonBody(request))
        sendJson(response, apiSuccess(result, result.message))
        return
      }
      if (request.method === 'POST' && url.pathname === '/api/ingress/message-queue/start') {
        const result = await bridge.beginRabbitMqIngest(await readJsonBody(request, 8 * 1024 * 1024))
        sendJson(response, apiSuccess(result, result.message))
        return
      }
      if ((request.method === 'PUT' || request.method === 'POST') && url.pathname === '/api/ingress/message-queue/chunk') {
        const result = await bridge.appendRabbitMqChunk(request)
        sendJson(response, apiSuccess(result, result.message))
        return
      }
      if (request.method === 'POST' && url.pathname === '/api/ingress/message-queue/complete') {
        const result = await bridge.completeRabbitMqIngest(await readJsonBody(request))
        sendJson(response, apiSuccess(result, result.message))
        return
      }
      if (request.method === 'POST' && url.pathname === '/api/ingress/message-queue') {
        const result = await bridge.ingestRabbitMqStreamPackage(request)
        sendJson(response, apiSuccess(result, result.message))
        return
      }
      if (request.method === 'POST' && url.pathname === '/api/ingress/api-callback') {
        const result = await bridge.ingestStreamPackage(request, 'API')
        sendJson(response, apiSuccess(result, result.message))
        return
      }
      if (request.method === 'GET' && url.pathname === '/api/receiver/status') {
        const ipv4 = localIPv4()
        sendJson(response, apiSuccess({
          receivedDir: bridge.options.receivedDir,
          receiver: 'UP',
          online: true,
          serviceStatus: '正常运行',
          ip: ipv4,
          ipv4,
          port: bridge.options.port,
          queuePreprocess: true,
          priority: '中',
          preprocessThreads: Number(process.env.RECEIVER_PREPROCESS_THREADS || 4),
          preprocessTimeoutMs: Number(process.env.RECEIVER_PREPROCESS_TIMEOUT_MS || 5000),
          maxQueueLength: Number(process.env.RECEIVER_MAX_QUEUE_LENGTH || 500),
          dashboardSync: {
            active: Boolean(bridge.syncedTransmissionDashboard),
            updatedAtMillis: bridge.syncedDashboardAtMillis || null
          }
        }))
        return
      }
      if (request.method === 'POST' && url.pathname === '/api/receiver/connect') {
        const result = await bridge.connectReceiver((await readJsonBody(request)).address)
        sendJson(response, apiSuccess(result, result.message))
        return
      }
      if (request.method === 'POST' && url.pathname === '/api/receiver/disconnect') {
        const result = await bridge.disconnectReceiver()
        sendJson(response, apiSuccess(result, result.message))
        return
      }
      if (request.method === 'POST' && url.pathname === '/api/receiver/task-sync') {
        const result = await bridge.receiveTaskSync(request)
        sendJson(response, apiSuccess(result, 'receiver task queue synced'))
        return
      }
      if (request.method === 'POST' && url.pathname === '/api/receiver/speed-probe') {
        const result = await bridge.receiveSpeedProbe(request)
        sendJson(response, apiSuccess(result, 'receiver speed probe accepted'))
        return
      }
      if (request.method === 'POST' && url.pathname === '/api/receiver/package') {
        const result = await bridge.receivePackage(request)
        sendJson(response, apiSuccess(result, result.message))
        return
      }
      if (request.method === 'POST' && url.pathname === '/api/receiver/open-file') {
        const result = await bridge.openReceivedFile((await readJsonBody(request)).taskId)
        sendJson(response, apiSuccess(result, result.message))
        return
      }
      if (request.method === 'POST' && url.pathname === '/api/receiver/open-folder') {
        const result = await bridge.openReceivedFolder()
        sendJson(response, apiSuccess(result, result.message))
        return
      }
      if (request.method === 'PUT' && url.pathname === '/api/transfer/config') {
        const result = await bridge.updateConfiguration(await readJsonBody(request))
        sendJson(response, apiSuccess(result, result.message))
        return
      }
      if (request.method === 'POST' && url.pathname === '/api/transfer/start') {
        const result = await bridge.startTransfer()
        sendJson(response, apiSuccess(result, result.message))
        return
      }
      if (request.method === 'POST' && url.pathname === '/api/transfer/stop') {
        const result = await bridge.stopTransfer()
        sendJson(response, apiSuccess(result, result.message))
        return
      }
      if (request.method === 'POST' && url.pathname === '/api/transfer/reset') {
        const result = await bridge.resetTransfer()
        sendJson(response, apiSuccess(result, result.message))
        return
      }
      const receiverTaskAction = /^\/api\/receiver\/tasks\/([^/]+)\/(content\/file|browse)$/.exec(url.pathname)
      if (request.method === 'GET' && receiverTaskAction) {
        const taskId = decodeURIComponent(receiverTaskAction[1])
        const routeBase = `/api/receiver/tasks/${encodeURIComponent(taskId)}`
        if (receiverTaskAction[2] === 'content/file') {
          await serveTaskContent(response, bridge, taskId, url.searchParams.get('path'), { source: 'receiver', routeBase })
        } else {
          await serveTaskBrowse(response, bridge, taskId, url.searchParams.get('path'), { source: 'receiver', routeBase })
        }
        return
      }
      const taskAction = /^\/api\/tasks\/([^/]+)\/(content\/file|browse)$/.exec(url.pathname)
      if (request.method === 'GET' && taskAction) {
        const taskId = decodeURIComponent(taskAction[1])
        const receiverCompatibilityMode = Number(bridge.options.port) === DEFAULT_RECEIVER_PORT
        if (taskAction[2] === 'content/file') {
          await serveTaskContent(response, bridge, taskId, url.searchParams.get('path'), receiverCompatibilityMode
            ? { source: 'receiver', routeBase: `/api/tasks/${encodeURIComponent(taskId)}` }
            : {})
        } else {
          await serveTaskBrowse(response, bridge, taskId, url.searchParams.get('path'), receiverCompatibilityMode
            ? { source: 'receiver', routeBase: `/api/tasks/${encodeURIComponent(taskId)}` }
            : {})
        }
        return
      }
      if (url.pathname.startsWith('/api/')) {
        await proxyToBackend(request, response, bridge, url)
        return
      }
      await serveFrontend(request, response, bridge, url)
    } catch (error) {
      if (url.pathname.startsWith('/api/')) {
        sendJson(response, apiError(error instanceof Error ? error.message : error), 200)
      } else {
        response.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' })
        response.end(error instanceof Error ? error.message : 'Internal Server Error')
      }
    }
  }
}

async function localReceiverReady(port) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 1000)
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/receiver/status`, {
      signal: controller.signal,
      headers: { Accept: 'application/json' }
    })
    if (!response.ok) return false
    const payload = await response.json().catch(() => null)
    return payload?.code === 0 && payload?.data?.online !== false
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}

async function ensureLocalReceiverService(bridge) {
  if (String(process.env.AUTO_START_RECEIVER || 'true').toLowerCase() === 'false') return
  const receiverPort = normalizeReceiverPort(DEFAULT_RECEIVER_PORT)
  if (Number(bridge.options.port) !== DEFAULT_RECEIVER_BOOTSTRAP_PORT || receiverPort === Number(bridge.options.port)) return
  if (await localReceiverReady(receiverPort)) {
    console.log(`本机接收服务已运行：http://localhost:${receiverPort}`)
    return
  }

  const env = {
    ...process.env,
    BRIDGE_HOST: bridge.options.host,
    BRIDGE_PORT: String(receiverPort),
    BACKEND_URL: bridge.options.backendUrl,
    FRONTEND_DIST: bridge.options.frontendDist,
    SAMPLE_DATA_DIR: bridge.options.sampleDataDir,
    UPLOADS_DIR: bridge.options.uploadsDir,
    RECEIVED_DIR: bridge.options.receivedDir,
    UPLOAD_LIMIT_BYTES: String(bridge.options.uploadLimitBytes),
    PRETRANSMISSION_FRAME_BYTES: String(bridge.options.preTransmissionFrameBytes),
    RECEIVER_URL: ''
  }
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url)], {
    cwd: integrationRoot,
    env,
    detached: true,
    stdio: 'ignore',
    windowsHide: true
  })
  child.unref()

  for (let attempt = 0; attempt < 20; attempt++) {
    await delay(250)
    if (await localReceiverReady(receiverPort)) {
      console.log(`本机接收服务自动启动：http://localhost:${receiverPort}`)
      return
    }
  }
  console.warn(`本机接收服务已发起但尚未就绪，请检查端口 ${receiverPort} 是否被占用`)
}
export function startServer(options = {}) {
  const bridge = new IntegrationBridge(options)
  const server = http.createServer(createRequestHandler(bridge))
  server.listen(bridge.options.port, bridge.options.host, () => {
    console.log(`系统网关已启动：http://localhost:${bridge.options.port}`)
    console.log(`后端服务地址：${bridge.options.backendUrl}`)
    console.log(`前端资源目录：${bridge.options.frontendDist}`)
    if (bridge.options.receiverUrl) console.log(`远端接收端：${bridge.options.receiverUrl}`)
    console.log(`本机接收目录：${bridge.options.receivedDir}`)
    ensureLocalReceiverService(bridge).catch((error) => console.error('本机接收服务自动启动失败：', error instanceof Error ? error.message : error))
  })
  return { server, bridge }
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : ''
if (import.meta.url === invokedPath) startServer()

