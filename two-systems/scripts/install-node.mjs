import { mkdtempSync, readFileSync, writeFileSync, copyFileSync, existsSync, renameSync, rmSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
for (const name of ['frontend', 'bridge']) {
  const project = path.join(root, name)
  mkdirSync(path.join(root, '.cache'), { recursive: true })
  const temporary = mkdtempSync(path.join(root, '.cache', 'install-'))
  try {
    copyFileSync(path.join(project, 'package.json'), path.join(temporary, 'package.json'))
    const lock = JSON.parse(readFileSync(path.join(project, 'package-lock.json'), 'utf8'))
    for (const entry of Object.values(lock.packages || {})) {
      if (entry.resolved?.startsWith('https://mirrors.cloud.tencent.com/npm/')) {
        entry.resolved = entry.resolved.replace('https://mirrors.cloud.tencent.com/npm/', 'https://registry.npmjs.org/')
      }
    }
    writeFileSync(path.join(temporary, 'package-lock.json'), JSON.stringify(lock, null, 2) + '\n')
    const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
    const result = spawnSync(npm, ['ci', '--cache', path.join(root, '.cache/npm')], { cwd: temporary, stdio: 'inherit', shell: process.platform === 'win32' })
    if (result.status !== 0) process.exit(result.status || 1)
    const destination = path.join(project, 'node_modules')
    if (existsSync(destination)) rmSync(destination, { recursive: true })
    renameSync(path.join(temporary, 'node_modules'), destination)
  } finally { rmSync(temporary, { recursive: true, force: true }) }
}
