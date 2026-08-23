type ServiceClient = {
  from: (table: string) => any
  storage: { from: (bucket: string) => { remove: (paths: string[]) => Promise<{ error: { message: string } | null }> } }
}

export async function queueStorageCleanup(
  service: ServiceClient,
  bucket: 'route-media' | 'appearance-submissions',
  paths: string[],
  actorId: string,
  context: string
): Promise<void> {
  const unique = [...new Set(paths)].filter(Boolean)
  if (!unique.length) return
  const queued = await service.from('storage_cleanup_jobs').upsert(
    unique.map((path) => ({
      bucket_id: bucket,
      object_path: path,
      requested_by: actorId,
      context,
      last_error: null,
      attempt_count: 0,
      next_attempt_at: new Date().toISOString(),
      locked_at: null,
      completed_at: null
    })),
    { onConflict: 'bucket_id,object_path' }
  )
  if (queued.error) throw queued.error
  await drainStorageCleanup(service)
}

export async function drainStorageCleanup(service: ServiceClient): Promise<void> {
  const now = new Date()
  const staleLock = new Date(now.getTime() - 10 * 60 * 1000).toISOString()
  const { data } = await service.from('storage_cleanup_jobs')
    .select('id,bucket_id,object_path,attempt_count').is('completed_at', null)
    .lte('next_attempt_at', now.toISOString())
    .or(`locked_at.is.null,locked_at.lt.${staleLock}`)
    .order('created_at').limit(100)
  const jobs = Array.isArray(data) ? data : []
  for (const job of jobs) {
    if (job.bucket_id !== 'route-media' && job.bucket_id !== 'appearance-submissions') continue
    const attemptCount = Math.min(Number(job.attempt_count ?? 0) + 1, 1000)
    const claimed = await service.from('storage_cleanup_jobs').update({
      locked_at: now.toISOString(), attempt_count: attemptCount
    }).eq('id', job.id).is('completed_at', null)
    if (claimed.error) continue

    const removed = await service.storage.from(job.bucket_id).remove([job.object_path])
    if (removed.error) {
      const backoffSeconds = Math.min(24 * 60 * 60, 60 * (2 ** Math.min(attemptCount - 1, 10)))
      await service.from('storage_cleanup_jobs').update({
        last_error: removed.error.message.slice(0, 1000),
        next_attempt_at: new Date(Date.now() + backoffSeconds * 1000).toISOString(),
        locked_at: null
      }).eq('id', job.id)
      continue
    }
    await service.from('storage_cleanup_jobs').update({
      completed_at: new Date().toISOString(), last_error: null, locked_at: null
    }).eq('id', job.id)
  }
}
