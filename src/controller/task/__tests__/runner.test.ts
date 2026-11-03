import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { TaskListItem } from '../../../type/config'

const m = vi.hoisted(() => ({
  copyDir: vi.fn(), copyFile: vi.fn(), delDir: vi.fn(), delFile: vi.fn(),
  moveDir: vi.fn(), moveFile: vi.fn(), sync: vi.fn(),
}))
vi.mock('../../../services/storage', () => m)
vi.mock('../../../services/LoggerService', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

import { runTask, isRootPath } from '../runner'

const task = (over: Partial<TaskListItem>): TaskListItem =>
  ({
    name: 't',
    taskType: 'delete',
    source: { storageName: 's', path: '/a/' },
    target: { storageName: 's', path: '/b/' },
    enable: true,
    run: { mode: 'start', time: { intervalDays: 0, h: 0, m: 0, s: 0 } },
    runInfo: {},
    ...over,
  }) as TaskListItem

describe('isRootPath', () => {
  it.each(['', '/', '//', '\\', '/\\/'])('%j 是根目录', p => expect(isRootPath(p)).toBe(true))
  it.each(['/a', '/a/', 'a', '/a/b/'])('%j 不是根目录', p => expect(isRootPath(p)).toBe(false))
})

describe('runTask 删除类任务', () => {
  beforeEach(() => Object.values(m).forEach(fn => fn.mockReset()))

  it('拒绝以存储根目录为源的删除任务，且不会调用删除接口', async () => {
    const result = await runTask(task({ source: { storageName: 's', path: '/' } }))
    expect(result.runInfo?.error).toBe(true)
    expect(m.delDir).not.toHaveBeenCalled()
    expect(m.delFile).not.toHaveBeenCalled()
  })

  it('普通目录的删除任务正常执行', async () => {
    m.delDir.mockResolvedValue(undefined)
    const result = await runTask(task({}))
    expect(result.runInfo?.error).toBe(false)
    expect(m.delDir).toHaveBeenCalledWith('s', '/a/')
  })
})
