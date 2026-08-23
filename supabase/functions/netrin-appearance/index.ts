import { createClient } from 'npm:@supabase/supabase-js@2.55.0'
import { auditAppearanceArchive } from '../_shared/appearance-audit.ts'
import { appearanceAdminAccess, appearanceAuthorAccess } from '../../../appearance/access-gate.ts'
import { validateAppearanceApproval, validateAppearanceReviewDecision } from '../../../appearance/review-gate-core.ts'
import { validateAppearanceReviewReport } from '../../../appearance/review-report.ts'
import { corsHeaders, isAllowedOrigin, json, publicServiceUrl, requestFailure } from '../_shared/http.ts'
import { contentLengthExceeds } from '../_shared/request-security.ts'
import { drainStorageCleanup, queueStorageCleanup } from '../_shared/storage-cleanup.ts'

const url = Deno.env.get('SUPABASE_URL') ?? ''
const publicUrl = Deno.env.get('SUPABASE_PUBLIC_URL') ?? ''
const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const MAX_MULTIPART_BYTES = 8 * 1024 * 1024
const MAX_PACKAGE_BYTES = 5 * 1024 * 1024

const ACCESS_ERRORS = {
  'authentication-required': 'Authentication required.',
  'account-inactive': 'Account is not active.',
  'permanent-account-required': 'A permanent account is required.',
  'phone-unconfirmed': 'A confirmed phone number is required.',
  'admin-required': 'Admin required.'
} as const

Deno.serve(async (request) => {
  const reply = (body: unknown, status = 200) => json(request, body, status)
  if (!isAllowedOrigin(request)) return reply({ error: 'Origin not allowed.' }, 403)
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(request) })
  if (!url || !publicUrl || !anonKey || !serviceKey) return reply({ error: 'Service unavailable.' }, 503)
  const authorization = request.headers.get('authorization') ?? ''
  const token = authorization.replace(/^Bearer\s+/i, '')
  const service = createClient(url, serviceKey, { auth: { persistSession: false } })
  const caller = createClient(url, anonKey, {
    global: { headers: { Authorization: authorization } }, auth: { persistSession: false }
  })
  const { data: authData } = token ? await caller.auth.getUser(token) : { data: { user: null } }
  const user = authData.user
  const [{ data: profile }, { data: role }] = user ? await Promise.all([
    service.from('profiles').select('account_status').eq('id', user.id).maybeSingle(),
    service.from('user_roles').select('role').eq('user_id', user.id).eq('role', 'admin').maybeSingle()
  ]) : [{ data: null }, { data: null }]
  const isActiveConfirmedAdmin = Boolean(role) &&
    profile?.account_status === 'active' &&
    Boolean(user?.phone_confirmed_at)
  const actor = {
    id: user?.id,
    isAnonymous: user?.is_anonymous,
    phoneConfirmedAt: user?.phone_confirmed_at,
    accountStatus: profile?.account_status,
    isAdmin: isActiveConfirmedAdmin
  }

  try {
    await drainStorageCleanup(service)
    if (request.headers.get('content-type')?.includes('application/json')) {
      const body = await request.json() as { action?: string; id?: string }
      if (body.action !== 'download' || !body.id) return reply({ error: 'Unsupported action.' }, 400)
      const { data: submission, error } = await service.from('appearance_submissions')
        .select('id, owner_id, moderation_status, storage_path').eq('id', body.id).maybeSingle()
      if (error || !submission) return reply({ error: 'Appearance not found.' }, 404)
      if (submission.moderation_status !== 'approved' &&
        (!user || (submission.owner_id !== user.id && !isActiveConfirmedAdmin))) {
        return reply({ error: 'Not allowed.' }, 403)
      }
      const { data, error: signedError } = await service.storage.from('appearance-submissions')
        .createSignedUrl(submission.storage_path, 60)
      if (signedError || !data?.signedUrl) throw signedError ?? new Error('Could not sign download URL.')
      return reply({ url: publicServiceUrl(data.signedUrl, publicUrl), expiresIn: 60 })
    }

    if (request.method !== 'POST') return reply({ error: 'Method not allowed.' }, 405)
    if (!request.headers.get('content-type')?.includes('multipart/form-data')) return reply({ error: 'v3 multipart submission required.' }, 415)
    const preliminaryAccess = appearanceAuthorAccess(actor)
    if (!preliminaryAccess.ok) return reply({ error: ACCESS_ERRORS[preliminaryAccess.code] }, preliminaryAccess.status)
    if (contentLengthExceeds(request, MAX_MULTIPART_BYTES)) {
      return reply({ error: 'Multipart request is too large.' }, 413)
    }
    const form = await request.formData()
    const action = form.get('action')
    if (action === 'review') {
      const access = appearanceAdminAccess(actor)
      if (!access.ok) return reply({ error: ACCESS_ERRORS[access.code] }, access.status)
      const submissionId = form.get('submissionId')
      const decision = form.get('decision')
      const reason = typeof form.get('reason') === 'string' ? String(form.get('reason')).trim() : ''
      const displayName = typeof form.get('displayName') === 'string' ? String(form.get('displayName')).trim() : ''
      const summary = typeof form.get('summary') === 'string' ? String(form.get('summary')).trim() : ''
      if (typeof submissionId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(submissionId)) {
        return reply({ error: 'Invalid submission ID.' }, 400)
      }
      const reviewFile = form.get('review')
      const decisionGate = validateAppearanceReviewDecision({
        decision, reason, displayName, summary, hasReview: reviewFile instanceof File
      })
      if (!decisionGate.ok) return reply({ error: 'Invalid appearance review request.', code: decisionGate.code }, 400)

      let adminReport: unknown = null
      let validationSummary: Record<string, unknown> = {}
      if (decision === 'approved') {
        if (!(reviewFile instanceof File) || reviewFile.size > 2 * 1024 * 1024) {
          return reply({ error: 'Administrator .netrin-review.json is required.' }, 400)
        }
        if (!reviewFile.name.toLowerCase().endsWith('.netrin-review.json')) return reply({ error: 'Administrator review filename must end in .netrin-review.json.' }, 400)
        try { adminReport = JSON.parse(await reviewFile.text()) } catch { return reply({ error: 'Review report is invalid JSON.' }, 400) }

        const gated = await validateAppearanceApproval(submissionId, adminReport, {
          async loadSubmission(id) {
            const result = await service.from('appearance_submissions')
              .select('id, package_id, package_version, package_sha256, storage_path, moderation_status')
              .eq('id', id).maybeSingle()
            if (result.error || !result.data) return null
            return {
              id: result.data.id,
              packageId: result.data.package_id,
              packageVersion: result.data.package_version,
              packageSha256: result.data.package_sha256,
              storagePath: result.data.storage_path,
              moderationStatus: result.data.moderation_status
            }
          },
          async download(storagePath) {
            const result = await service.storage.from('appearance-submissions').download(storagePath)
            if (result.error || !result.data) throw result.error ?? new Error('Candidate unavailable.')
            return new Uint8Array(await result.data.arrayBuffer())
          },
          audit: auditAppearanceArchive
        })
        if (!gated.ok) return reply({ error: 'Administrator review gate rejected the candidate.', code: gated.code, issues: gated.issues }, gated.status)
        adminReport = gated.report
        validationSummary = gated.summary
      }

      const finalized = await service.rpc('finalize_appearance_review_v3', {
        p_submission_id: submissionId,
        p_decision: decision,
        p_reason: reason || null,
        p_display_name: displayName || null,
        p_summary: summary || null,
        p_reviewer_id: user!.id,
        p_admin_review: adminReport,
        p_validation_summary: validationSummary
      })
      if (finalized.error) throw finalized.error
      return reply({ id: submissionId, decision, requestId: request.headers.get('x-request-id') ?? undefined })
    }

    const access = appearanceAuthorAccess(actor)
    if (!access.ok) return reply({ error: ACCESS_ERRORS[access.code] }, access.status)
    const packageFile = form.get('package')
    const reviewFile = form.get('review')
    if (!(packageFile instanceof File) || !(reviewFile instanceof File)) return reply({ error: 'Both package and .netrin-review.json are required.' }, 400)
    if (!packageFile.name.toLowerCase().endsWith('.netrin-appearance') || !reviewFile.name.toLowerCase().endsWith('.netrin-review.json')) {
      return reply({ error: 'v3 package/review filenames are required.' }, 400)
    }
    if (packageFile.size > MAX_PACKAGE_BYTES) return reply({ error: 'Appearance package is too large.' }, 413)
    if (reviewFile.size > 2 * 1024 * 1024) return reply({ error: 'Review report is too large.' }, 413)
    let authorReview: unknown
    try { authorReview = JSON.parse(await reviewFile.text()) } catch { return reply({ error: 'Review report is invalid JSON.' }, 400) }
    const bytes = new Uint8Array(await packageFile.arrayBuffer())
    const { manifest, report } = await auditAppearanceArchive(bytes)
    const validatedAuthorReview = validateAppearanceReviewReport(authorReview, {
      packageId: manifest.id,
      packageVersion: manifest.version,
      packageSha256: report.packageSha256 ?? '',
      interfaceContractVersion: manifest.interfaceContractVersion
    })
    if (!validatedAuthorReview.ok) {
      return reply({ error: 'Review report does not match the submitted package.' }, 400)
    }
    const replacementValue = form.get('replacementId')
    const replacementId = typeof replacementValue === 'string' && replacementValue ? replacementValue : null
    if (replacementId && !isActiveConfirmedAdmin) {
      return reply({ error: 'Admin required for package replacement.' }, 403)
    }

    let existing: { id: string; storage_path: string; owner_id: string | null } | null = null
    if (replacementId) {
      const result = await service.from('appearance_submissions').select('id, storage_path, owner_id').eq('id', replacementId).maybeSingle()
      existing = result.data
      if (!existing) return reply({ error: 'Appearance submission not found.' }, 404)
    } else {
      const result = await service.from('appearance_submissions').select('id, storage_path, owner_id')
        .eq('owner_id', user.id).eq('package_id', manifest.id).eq('package_version', manifest.version).maybeSingle()
      existing = result.data
    }
    const ownerId = existing?.owner_id ?? user.id
    const storagePath = `appearances/${ownerId}/${manifest.id}/${manifest.version}/${report.packageSha256}.netrin-appearance`
    const upload = await service.storage.from('appearance-submissions').upload(storagePath, bytes, {
      contentType: 'application/vnd.netrin.appearance+zip', upsert: true
    })
    if (upload.error) throw upload.error

    const values = {
      owner_id: ownerId, package_id: manifest.id, package_version: manifest.version,
      display_name: manifest.displayName, declared_author: manifest.author, license: manifest.license,
      package_sha256: report.packageSha256, byte_size: bytes.byteLength, storage_path: storagePath,
      audit_report: { server: report, author: { trust: 'author-provided-untrusted', report: validatedAuthorReview.report } }, moderation_status: 'pending', rejection_reason: null,
      reviewed_at: null, reviewed_by: null, updated_at: new Date().toISOString()
    }
    const write = existing
      ? await service.from('appearance_submissions').update(values).eq('id', existing.id).select('id').single()
      : await service.from('appearance_submissions').insert(values).select('id').single()
    if (write.error) {
      await service.storage.from('appearance-submissions').remove([storagePath])
      throw write.error
    }
    if (existing?.storage_path && existing.storage_path !== storagePath) {
      await queueStorageCleanup(
        service,
        'appearance-submissions',
        [existing.storage_path],
        user.id,
        `replace-appearance:${write.data.id}`
      )
    }
    return reply({ id: write.data.id, status: 'pending', audit: report }, 201)
  } catch (error) {
    return requestFailure(request, error)
  }
})
