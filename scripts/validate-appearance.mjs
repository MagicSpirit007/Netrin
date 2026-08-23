import { spawn } from 'node:child_process'
import { once } from 'node:events'

const npmCli = process.env.npm_execpath
if (!npmCli) throw new Error('npm_execpath is unavailable; run this command through npm.')
for (const script of ['test:appearance-flow', 'test:appearance-lifecycle', 'test:appearance-workbench', 'test:appearance-e2e', 'shell:check']) {
  console.log(`[validate:appearance] npm run ${script}`)
  const child = spawn(process.execPath, [npmCli, 'run', script], { cwd: process.cwd(), windowsHide: true, stdio: 'inherit' })
  const [code] = await once(child, 'exit')
  if (code !== 0) process.exit(code ?? 1)
}
console.log('[validate:appearance] PASS')
