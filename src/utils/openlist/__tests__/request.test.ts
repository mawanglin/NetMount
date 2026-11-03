import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const { info, getTokenMock } = vi.hoisted(() => ({
  info: { endpoint: { url: 'http://127.0.0.1:5244', auth: { token: 'old' } } },
  getTokenMock: vi.fn(),
}))

vi.mock('../../../services/openlist', () => ({ openlistInfo: info }))
vi.mock('../openlistAuth', () => ({ getOpenlistToken: getTokenMock }))
vi.mock('../../../services/LoggerService', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

import { openlist_api_get, openlist_api_post } from '../request'

const jsonResponse = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })

describe('openlist request 令牌过期处理', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    fetchMock.mockReset()
    getTokenMock.mockReset()
    info.endpoint.auth.token = 'old'
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('code 401 时重新登录并用新令牌重试一次', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ code: 401, message: 'token expired' }))
      .mockResolvedValueOnce(jsonResponse({ code: 200, data: { ok: true } }))
    getTokenMock.mockImplementation(async () => {
      info.endpoint.auth.token = 'new'
      return 'new'
    })

    const res = await openlist_api_get('/api/admin/storage/list')

    expect(res.code).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect((fetchMock.mock.calls[1]![1] as RequestInit).headers).toMatchObject({ Authorization: 'new' })
  })

  it('重新登录失败时返回原始响应，不无限重试', async () => {
    fetchMock.mockImplementation(async () => jsonResponse({ code: 401 }))
    getTokenMock.mockRejectedValue(new Error('login failed'))

    const res = await openlist_api_post('/api/admin/storage/create', { a: 1 })

    expect(res.code).toBe(401)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('重试后仍是 401 也只重试一次', async () => {
    fetchMock.mockImplementation(async () => jsonResponse({ code: 401 }))
    getTokenMock.mockResolvedValue('new')

    const res = await openlist_api_get('/x')

    expect(res.code).toBe(401)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('没有令牌时（登录接口之前）不触发重新登录', async () => {
    info.endpoint.auth.token = ''
    fetchMock.mockImplementation(async () => jsonResponse({ code: 401 }))

    await openlist_api_get('/x')

    expect(getTokenMock).not.toHaveBeenCalled()
  })

  it('请求挂起时按超时中止', async () => {
    vi.useFakeTimers()
    fetchMock.mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_, reject) => {
          init.signal!.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
        })
    )

    const pending = openlist_api_get('/x')
    const assertion = expect(pending).rejects.toThrow()
    await vi.advanceTimersByTimeAsync(61_000)
    await assertion
  })
})
