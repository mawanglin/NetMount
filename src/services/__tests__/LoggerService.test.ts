import { describe, it, expect } from 'vitest'
import { Logger, redactLogData, LogLevel } from '../LoggerService'

describe('redactLogData', () => {
  it('隐藏键名含 password/secret/token 等的值', () => {
    const out = redactLogData({
      user: 'admin',
      password: 'p1',
      newPassword: 'p2',
      client_secret: 's',
      accessToken: 't',
      Authorization: 'Bearer x',
      nested: { api_key: 'k', ok: 1 },
      list: [{ pass: 'x', name: 'n' }],
    }) as Record<string, unknown>
    expect(out).toEqual({
      user: 'admin',
      password: '***REDACTED***',
      newPassword: '***REDACTED***',
      client_secret: '***REDACTED***',
      accessToken: '***REDACTED***',
      Authorization: '***REDACTED***',
      nested: { api_key: '***REDACTED***', ok: 1 },
      list: [{ pass: '***REDACTED***', name: 'n' }],
    })
  })

  it('不误伤普通字段（如 keys、passed）', () => {
    expect(redactLogData({ keys: ['a', 'b'], status: 'passed' })).toEqual({ keys: ['a', 'b'], status: 'passed' })
  })

  it('遮蔽字符串里 URL 的凭据', () => {
    expect(redactLogData({ url: 'socks5://me:p%40ss@10.0.0.1:1080' })).toEqual({ url: 'socks5://***@10.0.0.1:1080' })
    expect(redactLogData('https://u:p@host/x')).toBe('https://***@host/x')
  })

  it('不修改入参，且能处理深层嵌套与 null', () => {
    const input = { password: 'x', a: { b: { c: { d: { e: { f: { g: 1 } } } } } }, n: null }
    const out = redactLogData(input) as Record<string, unknown>
    expect(input.password).toBe('x')
    expect(out.n).toBeNull()
    expect(JSON.stringify(out)).toContain('[truncated]')
  })
})

describe('Logger 写入前脱敏', () => {
  it('处理器收到的数据和消息已脱敏', () => {
    const logger = new Logger({ enableConsole: false, minLevel: LogLevel.DEBUG })
    const seen: Array<{ message: string; data?: Record<string, unknown> }> = []
    logger.addHandler({ handle: e => seen.push({ message: e.message, data: e.data }) })

    logger.info('connect https://u:secretpw@host/a', 'Test', { password: 'hunter2', host: 'h' })

    expect(seen).toHaveLength(1)
    expect(seen[0]!.message).toBe('connect https://***@host/a')
    expect(seen[0]!.data).toEqual({ password: '***REDACTED***', host: 'h' })
  })
})
