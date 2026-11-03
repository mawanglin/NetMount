import { describe, it, expect, vi, beforeEach } from 'vitest'
import { invoke } from '@tauri-apps/api/core'
import { ConfigService } from '../ConfigService'
import type { TaskListItem } from '../../type/config'

vi.mock('../LoggerService', () => ({
  logger: { error: vi.fn(), debug: vi.fn(), warn: vi.fn(), info: vi.fn(), withContext: () => ({ error: vi.fn(), debug: vi.fn(), warn: vi.fn(), info: vi.fn() }) },
}))

const task = (runId?: number): TaskListItem =>
  ({
    name: 't',
    taskType: 'copy',
    source: { storageName: 'a', path: '/' },
    target: { storageName: 'b', path: '/' },
    enable: true,
    run: { mode: 'interval', interval: 1000, time: { intervalDays: 0, h: 0, m: 0, s: 0 }, runId },
    runInfo: {},
  }) as TaskListItem

describe('ConfigService 任务 runId 处理', () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset()
    vi.mocked(invoke).mockResolvedValue(undefined)
  })

  it('保存配置时不持久化 runId，且不影响内存中的值', async () => {
    const svc = new ConfigService()
    svc.getConfig().task.push(task(42))

    await svc.saveConfig()

    const saved = vi.mocked(invoke).mock.calls[0]![1] as { data: { task: TaskListItem[] } }
    expect(saved.data.task[0]!.run.runId).toBeUndefined()
    expect(svc.getConfig().task[0]!.run.runId).toBe(42)
  })

  it('加载配置时清除遗留的 runId', async () => {
    const svc = new ConfigService()
    vi.mocked(invoke).mockResolvedValueOnce({ task: [task(99)] })

    await svc.loadConfig()

    expect(svc.getConfig().task[0]!.run.runId).toBeUndefined()
  })
})
