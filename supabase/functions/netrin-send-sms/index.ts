import DypnsapiPackage, { SendSmsVerifyCodeRequest } from 'npm:@alicloud/dypnsapi20170525@2.0.0'
import { $OpenApiUtil } from 'npm:@alicloud/openapi-core@1.0.0'
import { Webhook } from 'npm:standardwebhooks@1.0.0'
import {
  buildProviderRequest,
  maskPhone,
  providerAccepted,
  readHookTarget,
  resolveProviderRequestId,
  safeProviderError,
  type SendSmsHookPayload,
  webhookSigningSecret
} from './core.ts'
import { contentLengthExceeds } from '../_shared/request-security.ts'

const MAX_WEBHOOK_BODY_BYTES = 64 * 1024

const accessKeyId = Deno.env.get('ALIBABA_CLOUD_ACCESS_KEY_ID') ?? ''
const accessKeySecret = Deno.env.get('ALIBABA_CLOUD_ACCESS_KEY_SECRET') ?? ''
const signName = Deno.env.get('ALIBABA_PNVS_SIGN_NAME') ?? ''
const templateCode = Deno.env.get('ALIBABA_PNVS_TEMPLATE_CODE') ?? ''
const hookSecret = Deno.env.get('SEND_SMS_HOOK_SECRET') ?? ''

function response(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' }
  })
}

const DypnsapiClient = DypnsapiPackage.default

function createClient(): InstanceType<typeof DypnsapiClient> {
  const config = new $OpenApiUtil.Config({
    accessKeyId,
    accessKeySecret,
    endpoint: 'dypnsapi.aliyuncs.com',
    regionId: 'cn-hangzhou',
    type: 'access_key'
  })
  return new DypnsapiClient(config)
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') return response({ error: 'Method not allowed.' }, 405)
  if (!accessKeyId || !accessKeySecret || !signName || !templateCode || !hookSecret) {
    return response({ error: 'SMS hook is not configured.' }, 503)
  }

  if (contentLengthExceeds(request, MAX_WEBHOOK_BODY_BYTES)) {
    return response({ error: 'Request body is too large.' }, 413)
  }
  const rawBody = await request.text()
  if (new TextEncoder().encode(rawBody).byteLength > MAX_WEBHOOK_BODY_BYTES) {
    return response({ error: 'Request body is too large.' }, 413)
  }
  let payload: SendSmsHookPayload
  try {
    const webhook = new Webhook(webhookSigningSecret(hookSecret))
    payload = webhook.verify(rawBody, Object.fromEntries(request.headers)) as SendSmsHookPayload
  } catch {
    return response({ error: 'Invalid webhook signature.' }, 401)
  }

  const target = readHookTarget(payload)
  if (!target) return response({ error: 'Invalid SMS hook payload.' }, 400)
  const { phone, otp } = target

  const providerRequestId = crypto.randomUUID()
  try {
    const requestBody = new SendSmsVerifyCodeRequest(
      buildProviderRequest(phone, otp, signName, templateCode, providerRequestId)
    )
    const result = await createClient().sendSmsVerifyCode(requestBody)
    const body = result.body
    console.info('[netrin-send-sms]', {
      phone: maskPhone(phone),
      code: body?.code ?? 'NO_CODE',
      requestId: resolveProviderRequestId(body, providerRequestId)
    })
    if (!providerAccepted(body)) {
      return response({ error: 'SMS provider rejected the request.' }, 502)
    }
    return response({}, 200)
  } catch (error) {
    const safe = safeProviderError(error)
    console.error('[netrin-send-sms]', {
      phone: maskPhone(phone),
      code: safe.code,
      requestId: safe.requestId ?? providerRequestId
    })
    return response({ error: 'SMS provider request failed.' }, 502)
  }
})
