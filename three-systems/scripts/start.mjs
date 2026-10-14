import { existsSync, mkdirSync, openSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { softwareConfig } from './software-config.mjs'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const kind = process.argv[2]
const { port, backendPort, receiverPort } = softwareConfig(kind)
const runtime = path.join(root, 'runtime', kind)
mkdirSync(runtime, { recursive: true })
const pidFile = path.join(runtime, 'processes.json')
if (existsSync(pidFile)) {
  const previous = JSON.parse(readFileSync(pidFile, 'utf8'))
  const live = previous.pids.some(pid => { try { process.kill(pid, 0); return true } catch { return false } })
  if (live) throw new Error('This software already has running processes; stop it first')
  rmSync(pidFile)
}
if (!existsSync(path.join(root, 'shared-runtime/backend.jar')) || !existsSync(path.join(root, 'apps', kind, 'ui/index.html'))) {
  throw new Error('Build artifacts missing. Run scripts/build.sh first.')
}
const pids = []
function launch(executable, args, cwd, env, logName) {
  const fd = openSync(path.join(runtime, logName), 'a')
  const child = spawn(executable, args, { cwd, env: { ...process.env, ...env }, detached: true, stdio: ['ignore', fd, fd] })
  child.on('error', error => console.error(error.message))
  child.unref()
  if (child.pid) pids.push(child.pid)
  return child
}
const java = process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, 'bin', process.platform === 'win32' ? 'java.exe' : 'java') : 'java'
launch(java, ['-jar', path.join(root, 'shared-runtime/backend.jar'), `--server.port=${backendPort}`, `--app.history.dir=${path.join(runtime, 'history')}`], runtime, {}, 'backend.log')
async function ready(url, timeout = 90000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    try { const response = await fetch(url, { signal: AbortSignal.timeout(2000) }); if (response.ok) return await response.json() } catch {}
    await new Promise(resolve => setTimeout(resolve, 500))
  }
  throw new Error(`Service did not become ready: ${url}; inspect logs in ${runtime}`)
}
try {
  const health = await ready(`http://127.0.0.1:${backendPort}/actuator/health`)
  if (health.status !== 'UP') throw new Error('Backend health check failed')
  const bridgeEnvironment = {
    BACKEND_URL: `http://127.0.0.1:${backendPort}`,
    FRONTEND_DIST: path.join(root, 'apps', kind, 'ui'),
    SAMPLE_DATA_DIR: path.join(root, 'backend/sample-data'),
    UPLOADS_DIR: path.join(runtime, 'uploads'), RECEIVED_DIR: path.join(runtime, 'received'),
    DEFAULT_RECEIVER_PORT: String(receiverPort), DEFAULT_RECEIVER_BOOTSTRAP_PORT: String(port), AUTO_START_RECEIVER: 'false'
  }
  launch(process.execPath, [path.join(root, 'bridge/src/server.mjs')], root, { ...bridgeEnvironment, BRIDGE_PORT: String(receiverPort), RECEIVED_DIR: path.join(runtime, 'receiver-received'), RECEIVER_URL: '' }, 'receiver.log')
  const receiver = await ready(`http://127.0.0.1:${receiverPort}/api/receiver/status`)
  if (receiver.code !== 0) throw new Error('Receiver readiness check failed')
  launch(process.execPath, [path.join(root, 'bridge/src/server.mjs')], root, { ...bridgeEnvironment,
    BRIDGE_PORT: String(port), BACKEND_URL: `http://127.0.0.1:${backendPort}`,
    FRONTEND_DIST: path.join(root, 'apps', kind, 'ui'),
    SAMPLE_DATA_DIR: path.join(root, 'backend/sample-data'),
    UPLOADS_DIR: path.join(runtime, 'uploads'), RECEIVED_DIR: path.join(runtime, 'received'),
    DEFAULT_RECEIVER_PORT: String(receiverPort)
  }, 'bridge.log')
  writeFileSync(pidFile, JSON.stringify({ kind, port, backendPort, receiverPort, pids }, null, 2))
  const dashboard = await ready(`http://127.0.0.1:${port}/api/dashboard/strategy`)
  if (dashboard.code !== 0 || !dashboard.data?.networkForecast || !dashboard.data?.compressionCurve) throw new Error('Dashboard readiness check failed')
  console.log(`${kind} ready; UI port ${port}, backend ${backendPort}, receiver ${receiverPort}`)
} catch (error) {
  for (const pid of pids) { try { process.kill(pid) } catch {} }
  if (existsSync(pidFile)) rmSync(pidFile)
  throw error
}
