import { describe, it, expect, vi, afterEach } from 'vitest'
import { fetchWithTimeout, isHttpUrl } from '../fetchWithTimeout'

describe('fetchWithTimeout', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('超时后中止请求', async () => {
    vi.useFakeTimers()
    vi.stubGlobal(
      'fetch',
      (_url: string, init: RequestInit) =>
        new Promise((_, reject) => {
          init.signal!.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
        })
    )
    const pending = fetchWithTimeout('http://x', {}, 1000)
    const assertion = expect(pending).rejects.toThrow('aborted')
    await vi.advanceTimersByTimeAsync(1001)
    await assertion
  })

  it('正常返回时透传响应', async () => {
    vi.stubGlobal('fetch', async () => new Response('ok'))
    const res = await fetchWithTimeout('http://x')
    expect(await res.text()).toBe('ok')
  })
})

describe('isHttpUrl', () => {
  it.each(['https://example.com/a', 'http://example.com'])('接受 %s', v => {
    expect(isHttpUrl(v)).toBe(true)
  })
  it.each(['javascript:alert(1)', 'file:///etc/passwd', 'ftp://x', 'not a url', '', undefined, null, 5])('拒绝 %s', v => {
    expect(isHttpUrl(v)).toBe(false)
  })
})

import { isValidStorageName } from '../general'

describe('isValidStorageName', () => {
  it.each(['mys3', '115 Cloud', '网盘', 'a.b', 'name_1', 'a@b+c'])('接受 %s', v => {
    expect(isValidStorageName(v)).toBe(true)
  })
  it.each(['', ' a', 'a ', '.', '..', '-x', 'a/b', 'a\\b', 'a:b', 'a\u0000b', 'x'.repeat(256)])('拒绝 %j', v => {
    expect(isValidStorageName(v)).toBe(false)
  })
})
