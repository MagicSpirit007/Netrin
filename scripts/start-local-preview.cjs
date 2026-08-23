const { spawn } = require('node:child_process')
const { mkdirSync, openSync } = require('node:fs')
const { join } = require('node:path')

const root = process.cwd()
const logDir = join(root, '.preview-logs')
mkdirSync(logDir, { recursive: true })

function launch(command, cwd, name) {
  const stdout = openSync(join(logDir, `${name}.log`), 'a')
  const stderr = openSync(join(logDir, `${name}-error.log`), 'a')
  const child = spawn(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', command], {
    cwd,
    env: process.env,
    detached: true,
    windowsHide: true,
    stdio: ['ignore', stdout, stderr]
  })
  child.unref()
  return child.pid
}

const frontendPid = launch(
  'npm run dev -- --host 127.0.0.1 --port 5174',
  root,
  'frontend-5174'
)

process.stdout.write(JSON.stringify({ frontendPid, aiMode: 'deterministic-mock', logDir }))
