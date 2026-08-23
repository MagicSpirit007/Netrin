import { randomBytes } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { request as httpsRequest } from 'node:https'
import type { AddressInfo } from 'node:net'
import { AiRouteError } from '../errors.js'
import { resolvePublicAddresses, type ResolvedAddress } from '../network/publicHttps.js'
import { normalizedCustomBaseUrl, validateCustomBaseUrl } from './customEndpoint.js'

const MAX_REQUEST_BYTES = 1024 * 1024
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024
const CONNECT_TIMEOUT_MS = 10_000
const TOTAL_TIMEOUT_MS = 60_000
const LEASE_TTL_MS = 2 * 60_000

type LeaseRecord = {
  target: URL
  pinned: ResolvedAddress
  expiresAt: number
}

export type ProviderEgressLease = {
  baseUrl: string
  normalizedTarget: string
  revoke: () => void
}

export interface ProviderEgress {
  lease(baseUrl: string, signal?: AbortSignal): Promise<ProviderEgressLease>
  close?: () => Promise<void>
}

export type ProviderEgressDependencies = {
  resolve?: (hostname: string) => Promise<ResolvedAddress[]>
  now?: () => number
}

function safeJson(response: ServerResponse, status: number): void {
  if (response.headersSent || response.destroyed) {
    response.destroy()
    return
  }
  response.statusCode = status
  response.setHeader('content-type', 'application/json; charset=utf-8')
  response.setHeader('cache-control', 'no-store')
  response.setHeader('x-content-type-options', 'nosniff')
  response.end(JSON.stringify({ error: { code: 'AI_PROVIDER_UNAVAILABLE' } }))
}

function bearer(value: string | undefined): string | undefined {
  if (!value || value.length > 4_103 || !/^Bearer [^\r\n]+$/.test(value)) return undefined
  return value
}

export class LoopbackProviderEgressBroker implements ProviderEgress {
  readonly #leases = new Map<string, LeaseRecord>()
  readonly #resolve?: ProviderEgressDependencies['resolve']
  readonly #now: () => number
  #server?: Server
  #starting?: Promise<void>

  constructor(dependencies: ProviderEgressDependencies = {}) {
    this.#resolve = dependencies.resolve
    this.#now = dependencies.now ?? Date.now
  }

  async lease(baseUrl: string, signal?: AbortSignal): Promise<ProviderEgressLease> {
    const target = validateCustomBaseUrl(baseUrl)
    const addresses = await resolvePublicAddresses(target.hostname, {
      ...(this.#resolve ? { resolve: this.#resolve } : {}),
      blockedCode: 'AI_PROVIDER_ENDPOINT_BLOCKED',
      failureCode: 'AI_PROVIDER_ENDPOINT_BLOCKED',
      allowIpLiteral: false
    })
    if (signal?.aborted) throw new AiRouteError('AI_ABORTED', 499)
    await this.#ensureStarted()
    const token = randomBytes(32).toString('base64url')
    this.#leases.set(token, {
      target,
      pinned: addresses[0],
      expiresAt: this.#now() + LEASE_TTL_MS
    })
    const address = this.#server?.address() as AddressInfo
    const targetPath = target.pathname.replace(/\/+$/, '')
    return {
      baseUrl: `http://127.0.0.1:${address.port}/${token}${targetPath}`,
      normalizedTarget: normalizedCustomBaseUrl(baseUrl),
      revoke: () => { this.#leases.delete(token) }
    }
  }

  async close(): Promise<void> {
    this.#leases.clear()
    if (!this.#server) return
    const server = this.#server
    this.#server = undefined
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve())
    })
  }

  async #ensureStarted(): Promise<void> {
    if (this.#server?.listening) return
    if (this.#starting) return this.#starting
    this.#starting = new Promise<void>((resolve, reject) => {
      const server = createServer((request, response) => this.#handle(request, response))
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => {
        server.removeListener('error', reject)
        this.#server = server
        resolve()
      })
    }).finally(() => { this.#starting = undefined })
    return this.#starting
  }

  #handle(request: IncomingMessage, response: ServerResponse): void {
    void this.#proxy(request, response).catch(() => safeJson(response, 502))
  }

  async #proxy(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const requestUrl = new URL(request.url ?? '/', 'http://127.0.0.1')
    const [, token, ...rest] = requestUrl.pathname.split('/')
    const lease = token ? this.#leases.get(token) : undefined
    if (!lease || lease.expiresAt <= this.#now() || requestUrl.search) {
      if (token) this.#leases.delete(token)
      safeJson(response, 404)
      return
    }
    const suffix = rest.join('/')
    const expectedBase = lease.target.pathname.replace(/^\/+|\/+$/g, '')
    if (expectedBase && suffix !== expectedBase && !suffix.startsWith(`${expectedBase}/`)) {
      safeJson(response, 404)
      return
    }
    const relative = expectedBase
      ? suffix.slice(expectedBase.length).replace(/^\/+/, '')
      : suffix
    const isModels = request.method === 'GET' && relative === 'models'
    const isChat = request.method === 'POST' && relative === 'chat/completions'
    if (!isModels && !isChat) {
      safeJson(response, 404)
      return
    }
    const authorization = bearer(request.headers.authorization)
    if (!authorization) {
      safeJson(response, 401)
      return
    }
    if (isChat && String(request.headers['content-type'] ?? '').split(';', 1)[0].trim().toLowerCase() !== 'application/json') {
      safeJson(response, 415)
      return
    }
    const contentLength = Number(request.headers['content-length'] ?? 0)
    if (!Number.isFinite(contentLength) || contentLength < 0 || contentLength > MAX_REQUEST_BYTES) {
      safeJson(response, 413)
      return
    }
    const endpoint = isModels ? 'models' : 'chat/completions'
    const targetBasePath = lease.target.pathname.replace(/\/+$/, '')
    const upstreamPath = `${targetBasePath}/${endpoint}`
    const upstream = httpsRequest({
      protocol: 'https:',
      hostname: lease.pinned.address,
      family: lease.pinned.family,
      port: 443,
      servername: lease.target.hostname,
      path: upstreamPath,
      method: request.method,
      agent: false,
      headers: {
        host: lease.target.hostname,
        authorization,
        accept: isModels ? 'application/json' : 'text/event-stream, application/json',
        'accept-encoding': 'identity',
        ...(isChat ? { 'content-type': 'application/json' } : {}),
        'user-agent': 'Netrin-AI-Provider/1.3'
      }
    })
    const connectTimer = setTimeout(() => upstream.destroy(new Error('connect timeout')), CONNECT_TIMEOUT_MS)
    const totalTimer = setTimeout(() => upstream.destroy(new Error('total timeout')), TOTAL_TIMEOUT_MS)
    upstream.once('socket', (socket) => socket.once('secureConnect', () => clearTimeout(connectTimer)))
    const abort = () => upstream.destroy(new Error('client aborted'))
    request.once('aborted', abort)
    response.once('close', () => {
      clearTimeout(connectTimer)
      clearTimeout(totalTimer)
      abort()
    })
    upstream.once('error', () => {
      clearTimeout(connectTimer)
      clearTimeout(totalTimer)
      safeJson(response, 502)
    })
    upstream.once('response', (incoming) => {
      clearTimeout(connectTimer)
      const status = incoming.statusCode ?? 502
      const encoding = String(incoming.headers['content-encoding'] ?? '').trim().toLowerCase()
      const mediaType = String(incoming.headers['content-type'] ?? '').split(';', 1)[0].trim().toLowerCase()
      if (status < 200 || status >= 300 || (encoding && encoding !== 'identity') ||
          !['application/json', 'text/event-stream'].includes(mediaType)) {
        clearTimeout(totalTimer)
        incoming.resume()
        safeJson(response, status >= 400 && status <= 599 ? status : 502)
        return
      }
      response.statusCode = status
      response.setHeader('content-type', incoming.headers['content-type'] ?? mediaType)
      response.setHeader('cache-control', 'no-store')
      response.setHeader('x-content-type-options', 'nosniff')
      let responseBytes = 0
      incoming.on('data', (chunk: Buffer | string) => {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
        responseBytes += buffer.length
        if (responseBytes > MAX_RESPONSE_BYTES) {
          clearTimeout(totalTimer)
          incoming.destroy()
          upstream.destroy()
          response.destroy()
          return
        }
        response.write(buffer)
      })
      incoming.once('end', () => {
        clearTimeout(totalTimer)
        response.end()
      })
      incoming.once('error', () => {
        clearTimeout(totalTimer)
        response.destroy()
      })
    })
    if (isModels) {
      upstream.end()
      return
    }
    let requestBytes = 0
    request.on('data', (chunk: Buffer | string) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      requestBytes += buffer.length
      if (requestBytes > MAX_REQUEST_BYTES) {
        upstream.destroy()
        safeJson(response, 413)
        return
      }
      upstream.write(buffer)
    })
    request.once('end', () => upstream.end())
    request.once('error', () => upstream.destroy())
  }
}
