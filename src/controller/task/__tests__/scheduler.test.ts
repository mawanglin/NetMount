import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { TaskListItem } from '../../../type/config'

const { runTaskMock, delTaskMock } = vi.hoisted(() => ({
  runTaskMock: vi.fn(),
  delTaskMock: vi.fn(),
}))

vi.mock('../runner', () => ({ runTask: runTaskMock }))
vi.mock('../task', () => ({ delTask: delTaskMock }))
vi.mock('../../../services/LoggerService', () => ({
  logger: { error: vi.fn(), debug: vi.fn(), warn: vi.fn(), info: vi.fn() },
}))

import { TaskScheduler } from '../scheduler'

const makeTask = (over: Omit<Partial<TaskListItem>, 'run'> & { run?: Partial<TaskListItem['run']> } = {}): TaskListItem => {
  const { run, ...rest } = over
  return {
    name: 't1',
    taskType: 'copy',
    source: { storageName: 's1', path: '/a/' },
    target: { storageName: 's2', path: '/b/' },
    enable: true,
    run: { mode: 'interval', interval: 1000, time: { intervalDays: 0, h: 0, m: 0, s: 0 }, ...run },
    runInfo: {},
    ...rest,
  } as TaskListItem
}

describe('TaskScheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    runTaskMock.mockReset()
    delTaskMock.mockReset()
    runTaskMock.mockImplementation(async (t: TaskListItem) => t)
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('同名任务重复加入时不会重复执行', async () => {
    const scheduler = new TaskScheduler()
    await scheduler.addTask(makeTask())
    await scheduler.addTask(makeTask())
    await vi.advanceTimersByTimeAsync(1000)
    expect(runTaskMock).toHaveBeenCalledTimes(1)
  })

  it('cancelTask 清除所有同名条目的定时器', async () => {
    const scheduler = new TaskScheduler()
    await scheduler.addTask(makeTask())
    scheduler.cancelTask('t1')
    await vi.advanceTimersByTimeAsync(5000)
    expect(runTaskMock).not.toHaveBeenCalled()
    expect(scheduler.tasks).toHaveLength(0)
  })

  it('interval 非法时不启动定时器', async () => {
    const scheduler = new TaskScheduler()
    await scheduler.addTask(makeTask({ run: { interval: 0 } }))
    await vi.advanceTimersByTimeAsync(5000)
    expect(runTaskMock).not.toHaveBeenCalled()
  })

  it('time 模式执行期间被取消后不会重新排期', async () => {
    const scheduler = new TaskScheduler()
    let release: () => void = () => {}
    runTaskMock.mockImplementation(
      (t: TaskListItem) => new Promise<TaskListItem>(resolve => { release = () => resolve(t) })
    )
    // 固定系统时间，避免依赖真实时钟（秒数回绕会让计划时间落到过去）
    vi.setSystemTime(new Date(2024, 0, 1, 10, 0, 0))
    const task = makeTask({
      run: { mode: 'time', time: { intervalDays: 0, h: 10, m: 0, s: 2 } },
    })
    await scheduler.addTask(task)
    await vi.advanceTimersByTimeAsync(3000)
    expect(runTaskMock).toHaveBeenCalledTimes(1)

    scheduler.cancelTask('t1')
    release()
    await vi.advanceTimersByTimeAsync(2 * 24 * 3600 * 1000)
    expect(runTaskMock).toHaveBeenCalledTimes(1)
  })

  it('disposable 任务成功后删除，失败时保留', async () => {
    const scheduler = new TaskScheduler()
    await scheduler.executeTask(makeTask({ run: { mode: 'disposable' } }))
    expect(delTaskMock).toHaveBeenCalledWith('t1')

    delTaskMock.mockReset()
    runTaskMock.mockImplementation(async (t: TaskListItem) => ({ ...t, runInfo: { error: true, msg: 'boom' } }))
    await scheduler.executeTask(makeTask({ run: { mode: 'disposable' } }))
    expect(delTaskMock).not.toHaveBeenCalled()
  })

  it('同一任务执行未结束时跳过重叠执行', async () => {
    const scheduler = new TaskScheduler()
    let release: () => void = () => {}
    runTaskMock.mockImplementation(
      (t: TaskListItem) => new Promise<TaskListItem>(resolve => { release = () => resolve(t) })
    )
    const task = makeTask({ run: { mode: 'start' } })
    const first = scheduler.executeTask(task)
    await scheduler.executeTask(task)
    expect(runTaskMock).toHaveBeenCalledTimes(1)
    release()
    await first
  })
})
