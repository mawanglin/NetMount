import { describe, it, expect } from 'vitest'
import { hashPassword, verifyPassword, legacyHashPassword, isLegacyPasswordHash } from '../passwordHash'

// 测试中使用较少的迭代次数以加快速度
const FAST = 1000

describe('passwordHash', () => {
  it('正确密码验证通过，错误密码失败', async () => {
    const stored = await hashPassword('correct horse', FAST)
    expect((await verifyPassword('correct horse', stored)).ok).toBe(true)
    expect((await verifyPassword('wrong', stored)).ok).toBe(false)
  })

  it('每次哈希使用不同的盐', async () => {
    const a = await hashPassword('same', FAST)
    const b = await hashPassword('same', FAST)
    expect(a).not.toBe(b)
    expect((await verifyPassword('same', a)).ok).toBe(true)
    expect((await verifyPassword('same', b)).ok).toBe(true)
  })

  it('存储格式为 pbkdf2$迭代$盐$哈希', async () => {
    const stored = await hashPassword('x', FAST)
    expect(stored).toMatch(/^pbkdf2\$1000\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/)
    expect(isLegacyPasswordHash(stored)).toBe(false)
  })

  it('兼容旧版哈希，验证成功时返回升级后的新哈希', async () => {
    const legacy = legacyHashPassword('oldpass')
    expect(isLegacyPasswordHash(legacy)).toBe(true)

    const ok = await verifyPassword('oldpass', legacy)
    expect(ok.ok).toBe(true)
    expect(ok.upgradedHash).toMatch(/^pbkdf2\$/)
    expect((await verifyPassword('oldpass', ok.upgradedHash!)).ok).toBe(true)

    const bad = await verifyPassword('nope', legacy)
    expect(bad.ok).toBe(false)
    expect(bad.upgradedHash).toBeUndefined()
  })

  it('损坏或被篡改的存储值一律验证失败', async () => {
    expect((await verifyPassword('x', '')).ok).toBe(false)
    expect((await verifyPassword('x', 'pbkdf2$abc$aa$bb')).ok).toBe(false)
    expect((await verifyPassword('x', 'pbkdf2$1000$only-two')).ok).toBe(false)
    expect((await verifyPassword('x', 'pbkdf2$999999999999$aa$bb')).ok).toBe(false)
  })
})
