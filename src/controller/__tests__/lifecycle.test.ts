import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const m = vi.hoisted(() => ({
  saveNmConfig: vi.fn(),
  stopRclone: vi.fn(),
  stopOpenlist: vi.fn(),
  stopComponentWatchdog: vi.fn(),
  tauriExit: vi.fn(),
  cleanupTempOnExit: vi.fn(),
}))

vi.mock('../../services/ConfigService', () => ({ saveNmConfig: m.saveNmConfig }))
vi.mock('../../utils/rclone/process', () => ({ stopRclone: m.stopRclone }))
vi.mock('../../utils/openlist/process', () => ({ stopOpenlist: m.stopOpenlist }))
vi.mock('../componentWatchdog', () => ({ stopComponentWatchdog: m.stopComponentWatchdog }))
vi.mock('@tauri-apps/plugin-process', () => ({ exit: m.tauriExit }))
vi.mock('../../utils/tempCleanup', () => ({ cleanupTempOnExit: m.cleanupTempOnExit }))
vi.mock('../../services/LoggerService', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

describe('exit', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.useFakeTimers()
    for (const fn of Object.values(m)) {
      fn.mockReset()
      fn.mockResolvedValue(undefined)
    }
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('某一步失败不影响后续步骤，最终仍会退出', async () => {
    m.stopRclone.mockRejectedValue(new Error('boom'))
    const { exit } = await import('../lifecycle')

    await exit()

    expect(m.stopOpenlist).toHaveBeenCalled()
    expect(m.cleanupTempOnExit).toHaveBeenCalled()
    expect(m.tauriExit).toHaveBeenCalledWith(0)
  })

  it('某一步挂起时超时后继续退出', async () => {
    m.stopRclone.mockReturnValue(new Promise(() => {}))
    const { exit } = await import('../lifecycle')

    const pending = exit()
    await vi.advanceTimersByTimeAsync(9000)
    await pending

    expect(m.stopOpenlist).toHaveBeenCalled()
    expect(m.tauriExit).toHaveBeenCalledWith(0)
  })

  it('并发调用只执行一次退出流程', async () => {
    const { exit } = await import('../lifecycle')

    await Promise.all([exit(), exit()])

    expect(m.stopRclone).toHaveBeenCalledTimes(1)
    expect(m.tauriExit).toHaveBeenCalledTimes(1)
  })
})
