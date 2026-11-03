/**
 * 启动密码哈希
 *
 * 使用 PBKDF2-SHA256（带随机盐、可调迭代次数），存储格式：
 *   pbkdf2$<迭代次数>$<盐 base64>$<哈希 base64>
 *
 * 旧版本使用 32 位滚动哈希（极易碰撞/暴力破解），仍可验证，验证成功后应升级为新格式。
 * 注意：启动密码只是界面层的锁，配置文件在本机可读，不能防御能直接访问文件的攻击者。
 */

const PREFIX = 'pbkdf2$'
const DEFAULT_ITERATIONS = 150_000
const SALT_BYTES = 16
const HASH_BITS = 256

function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary)
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

async function derive(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  )
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations },
    keyMaterial,
    HASH_BITS
  )
  return new Uint8Array(bits)
}

/** 常量时间比较，避免通过比较耗时推断前缀 */
function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!
  return diff === 0
}

/** 旧版 32 位滚动哈希，仅用于兼容已保存的密码 */
export function legacyHashPassword(password: string): string {
  let hash = 0
  for (let i = 0; i < password.length; i++) {
    const char = password.charCodeAt(i)
    hash = (hash << 5) - hash + char
    hash = hash & hash
  }
  return hash.toString(36)
}

export function isLegacyPasswordHash(stored: string): boolean {
  return !stored.startsWith(PREFIX)
}

export async function hashPassword(password: string, iterations: number = DEFAULT_ITERATIONS): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES))
  const hash = await derive(password, salt, iterations)
  return `${PREFIX}${iterations}$${toBase64(salt)}$${toBase64(hash)}`
}

export interface VerifyResult {
  ok: boolean
  /** 旧格式验证成功时给出的新哈希，调用方应保存以完成升级 */
  upgradedHash?: string
}

export async function verifyPassword(password: string, stored: string): Promise<VerifyResult> {
  if (!stored) return { ok: false }

  if (isLegacyPasswordHash(stored)) {
    const ok = constantTimeEqual(
      new TextEncoder().encode(legacyHashPassword(password)),
      new TextEncoder().encode(stored)
    )
    return ok ? { ok, upgradedHash: await hashPassword(password) } : { ok: false }
  }

  const parts = stored.slice(PREFIX.length).split('$')
  if (parts.length !== 3) return { ok: false }
  const iterations = Number(parts[0])
  if (!Number.isInteger(iterations) || iterations < 1 || iterations > 10_000_000) return { ok: false }

  try {
    const expected = fromBase64(parts[2]!)
    const actual = await derive(password, fromBase64(parts[1]!), iterations)
    return { ok: constantTimeEqual(actual, expected) }
  } catch {
    return { ok: false }
  }
}
