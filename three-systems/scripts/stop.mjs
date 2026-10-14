import { existsSync, readFileSync, rmSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { softwareConfig } from './software-config.mjs'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const kind = process.argv[2]
softwareConfig(kind)
const filename = path.join(root, 'runtime', kind, 'processes.json')
if (existsSync(filename)) {
  const { pids } = JSON.parse(readFileSync(filename, 'utf8'))
  for (const pid of pids) {
    try {
      if (process.platform === 'win32') {
        const { spawnSync } = await import('node:child_process')
        spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' })
      } else { process.kill(-pid, 'SIGTERM') }
    } catch {}
  }
  rmSync(filename)
}
console.log(`${kind} stopped`)
