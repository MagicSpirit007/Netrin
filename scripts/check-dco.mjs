import { spawnSync } from 'node:child_process'
import process from 'node:process'

const [base, head] = process.argv.slice(2)
const shaPattern = /^[0-9a-f]{40}$/i

if (!shaPattern.test(base ?? '') || !shaPattern.test(head ?? '')) {
  console.error('Usage: node scripts/check-dco.mjs <base-sha> <head-sha>')
  process.exit(2)
}

const revList = spawnSync('git', ['rev-list', '--no-merges', `${base}..${head}`], {
  encoding: 'utf8'
})
if (revList.status !== 0) {
  console.error(revList.stderr.trim() || 'Unable to enumerate pull-request commits.')
  process.exit(2)
}

const commits = revList.stdout.split(/\r?\n/).filter(Boolean)
const unsigned = []

for (const commit of commits) {
  const show = spawnSync('git', ['show', '-s', '--format=%B', commit], { encoding: 'utf8' })
  if (show.status !== 0 || !/^Signed-off-by:\s+.+\s+<[^<>\s]+@[^<>\s]+>\s*$/im.test(show.stdout)) {
    unsigned.push(commit)
  }
}

if (unsigned.length > 0) {
  console.error('DCO check failed. These commits lack a valid Signed-off-by trailer:')
  for (const commit of unsigned) console.error(`- ${commit}`)
  console.error('Create commits with `git commit -s` or amend them before the pull request is merged.')
  process.exit(1)
}

console.log(`DCO check passed for ${commits.length} commit(s).`)
