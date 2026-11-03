import { describe, it, expect, vi, beforeEach } from 'vitest'

const m = vi.hoisted(() => ({
  reupStorage: vi.fn(),
  addOpenlistInRclone: vi.fn(),
  reupMount: vi.fn(),
  autoMountOnStartup: vi.fn(),
}))

vi.mock('../../services/storage/StorageManager', () => ({ reupStorage: m.reupStorage }))
vi.mock('../../utils/openlist/openlist', () => ({ addOpenlistInRclone: m.addOpenlistInRclone }))
vi.mock('../storage/mount/mount', () => ({ reupMount: m.reupMount }))
vi.mock('../storage/mount/autoMount', () => ({ autoMountOnStartup: m.autoMountOnStartup }))
vi.mock('../../services/LoggerService', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

import { recoverAfterComponentRestart } from '../recovery'

describe('recoverAfterComponentRestart', () => {
  beforeEach(() => {
    for (const fn of Object.values(m)) {
      fn.mockReset()
      fn.mockResolvedValue(undefined)
    }
  })

  it('按顺序恢复存储、openlist remote、挂载列表并自动挂载', async () => {
    const order: string[] = []
    m.reupStorage.mockImplementation(async () => { order.push('storage') })
    m.addOpenlistInRclone.mockImplementation(async () => { order.push('openlist') })
    m.reupMount.mockImplementation(async () => { order.push('mounts') })
    m.autoMountOnStartup.mockImplementation(async () => { order.push('auto') })

    await recoverAfterComponentRestart()

    expect(order).toEqual(['storage', 'openlist', 'mounts', 'auto'])
  })

  it('单步失败不影响后续步骤', async () => {
    m.addOpenlistInRclone.mockRejectedValue(new Error('x'))

    await recoverAfterComponentRestart()

    expect(m.reupMount).toHaveBeenCalled()
    expect(m.autoMountOnStartup).toHaveBeenCalled()
  })
})
