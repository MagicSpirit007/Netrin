import { lookup as dnsLookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import type { AiRouteErrorCode } from '../contracts/aiRoute.js'
import { AiRouteError } from '../errors.js'

export type ResolvedAddress = { address: string; family: 4 | 6 }

function ipv4Bytes(value: string): number[] | undefined {
  const parts = value.split('.')
  if (parts.length !== 4) return undefined
  const bytes = parts.map(Number)
  return bytes.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)
    ? bytes
    : undefined
}

function isPublicIpv4(bytes: number[]): boolean {
  const [a, b, c] = bytes
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false
  if (a === 100 && b >= 64 && b <= 127) return false
  if (a === 169 && b === 254) return false
  if (a === 172 && b >= 16 && b <= 31) return false
  if (a === 192 && (b === 168 || (b === 0 && c <= 2) || (b === 88 && c === 99))) return false
  if (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) return false
  if (a === 203 && b === 0 && c === 113) return false
  return true
}

function ipv6Bytes(input: string): number[] | undefined {
  let value = input.toLowerCase().split('%')[0]
  if (value.includes('.')) {
    const lastColon = value.lastIndexOf(':')
    const ipv4Tail = ipv4Bytes(value.slice(lastColon + 1))
    if (!ipv4Tail) return undefined
    value = `${value.slice(0, lastColon)}:${((ipv4Tail[0] << 8) | ipv4Tail[1]).toString(16)}:${((ipv4Tail[2] << 8) | ipv4Tail[3]).toString(16)}`
  }
  const halves = value.split('::')
  if (halves.length > 2) return undefined
  const left = halves[0] ? halves[0].split(':') : []
  const right = halves.length === 2 && halves[1] ? halves[1].split(':') : []
  const missing = 8 - left.length - right.length
  if ((halves.length === 1 && missing !== 0) || missing < 0) return undefined
  const words = [...left, ...Array(missing).fill('0'), ...right]
  if (words.length !== 8 || words.some((word) => !/^[0-9a-f]{1,4}$/.test(word))) return undefined
  return words.flatMap((word) => {
    const parsed = Number.parseInt(word, 16)
    return [parsed >> 8, parsed & 0xff]
  })
}

export function isPublicAddress(address: string): boolean {
  const family = isIP(address)
  if (family === 4) return isPublicIpv4(ipv4Bytes(address) ?? [])
  if (family !== 6) return false
  const bytes = ipv6Bytes(address)
  if (!bytes) return false
  const allZero = bytes.every((byte) => byte === 0)
  const loopback = bytes.slice(0, 15).every((byte) => byte === 0) && bytes[15] === 1
  if (allZero || loopback) return false
  if ((bytes[0] & 0xfe) === 0xfc) return false
  if (bytes[0] === 0xfe && (bytes[1] & 0xc0) === 0x80) return false
  if (bytes[0] === 0xff) return false
  if (bytes[0] === 0x20 && bytes[1] === 0x01 && bytes[2] === 0x0d && bytes[3] === 0xb8) return false
  if (bytes.slice(0, 10).every((byte) => byte === 0) && bytes[10] === 0xff && bytes[11] === 0xff) {
    return isPublicIpv4(bytes.slice(12))
  }
  return (bytes[0] & 0xe0) === 0x20
}

export async function resolvePublicAddresses(
  hostname: string,
  options: {
    resolve?: (hostname: string) => Promise<ResolvedAddress[]>
    blockedCode?: AiRouteErrorCode
    failureCode?: AiRouteErrorCode
    allowIpLiteral?: boolean
  } = {}
): Promise<ResolvedAddress[]> {
  const blockedCode = options.blockedCode ?? 'AI_PROVIDER_ENDPOINT_BLOCKED'
  const failureCode = options.failureCode ?? 'AI_PROVIDER_ENDPOINT_BLOCKED'
  const literal = hostname.startsWith('[') && hostname.endsWith(']')
    ? hostname.slice(1, -1)
    : hostname
  const literalFamily = isIP(literal)
  if (literalFamily) {
    if (!options.allowIpLiteral || !isPublicAddress(literal)) throw new AiRouteError(blockedCode, 400)
    return [{ address: literal, family: literalFamily as 4 | 6 }]
  }
  let addresses: ResolvedAddress[]
  try {
    addresses = options.resolve
      ? await options.resolve(hostname)
      : (await dnsLookup(hostname, { all: true, verbatim: true }))
          .map(({ address, family }) => ({ address, family: family as 4 | 6 }))
  } catch {
    throw new AiRouteError(failureCode, 502)
  }
  if (!addresses.length || addresses.length > 16 || addresses.some(({ address }) => !isPublicAddress(address))) {
    throw new AiRouteError(blockedCode, 400)
  }
  return addresses
}
