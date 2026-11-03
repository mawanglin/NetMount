import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../../../services/rclone', () => ({ rcloneInfo: { endpoint: { url: 'http://rc' } } }))
vi.mock('../../../services/LoggerService', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))
vi.mock('@arco-design/web-react', () => ({ Message: { error: vi.fn() } }))
vi.mock('../httpClient', () => ({
  buildApiUrl: (base: string, path: string) => base + path,
  getRcloneApiHeaders: () => ({ Authorization: 'x' }),
  handleApiResponse: async (res: Response) => res.json(),
}))

import { rclone_api_wait_for_job } from '../request'

const status = (over: Record<string, unknown>) =>
  new Response(JSON.stringify({ jobid: 1, finished: false, success: false, error: '', ...over }), { status: 200 })

describe('rclone_api_wait_for_job', () => {
  const fetchMock = vi.fn()
  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('状态查询偶发失败不会判定任务失败', async () => {
    fetchMock
      .mockRejectedValueOnce(new Error('blip'))
      .mockRejectedValueOnce(new Error('blip'))
      .mockImplementation(async () => status({ finished: true, success: true }))

    const pending = rclone_api_wait_for_job(1, 10)
    await vi.advanceTimersByTimeAsync(100)

    expect(await pending).toBe(true)
  })

  it('连续多次失败后才判定失败', async () => {
    fetchMock.mockRejectedValue(new Error('down'))

    const pending = rclone_api_wait_for_job(1, 10)
    await vi.advanceTimersByTimeAsync(200)

    expect(await pending).toBe(false)
    expect(fetchMock).toHaveBeenCalledTimes(5)
  })

  it('任务失败时返回 false', async () => {
    fetchMock.mockImplementation(async () => status({ finished: true, success: false, error: 'boom' }))
    expect(await rclone_api_wait_for_job(1, 10)).toBe(false)
  })

  it('被取消时停止任务并移除 abort 监听', async () => {
    fetchMock.mockImplementation(async () => status({}))
    const controller = new AbortController()
    const add = vi.spyOn(controller.signal, 'addEventListener')
    const remove = vi.spyOn(controller.signal, 'removeEventListener')

    const pending = rclone_api_wait_for_job(1, 10, 0, controller.signal)
    await vi.advanceTimersByTimeAsync(55)
    controller.abort()
    await vi.advanceTimersByTimeAsync(20)

    expect(await pending).toBe(false)
    expect(add.mock.calls.length).toBeGreaterThan(2)
    // 轮询过的每一轮都应移除自己的监听
    expect(remove.mock.calls.length).toBeGreaterThanOrEqual(add.mock.calls.length - 1)
  })
})
