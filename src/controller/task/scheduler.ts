import type { TaskListItem } from '../../type/config'
import { runTask } from './runner'
import { delTask } from './task'
import { logger } from '../../services/LoggerService'

class TaskScheduler {
  tasks: TaskListItem[]
  private runningTasks: Set<string>

  constructor() {
    this.tasks = []
    this.runningTasks = new Set()
  }

  public async addTask(task: TaskListItem) {
    // 同名任务重复加入时，先取消旧的排期，避免重复执行和定时器泄漏
    this.cancelTask(task.name)
    if (task.enable) {
      this.tasks.push(task)
      this.scheduleTask(task)
    }
  }

  private scheduleTask(task: TaskListItem) {
    switch (task.run.mode) {
      case 'start':
      case 'disposable':
        // 只执行一次，不占用定时器句柄
        void this.executeTask(task)
        break
      case 'time': {
        const executeTaskInterval = () => {
          const now = new Date()
          const scheduledTime = new Date(now)
          scheduledTime.setDate(scheduledTime.getDate() + task.run.time.intervalDays)
          scheduledTime.setHours(task.run.time.h, task.run.time.m, task.run.time.s)

          if (scheduledTime < now) {
            scheduledTime.setDate(scheduledTime.getDate() + 1)
          }

          const timeout = scheduledTime.getTime() - now.getTime()
          if (timeout >= 0) {
            const timerId: number = window.setTimeout(async () => {
              await this.executeTask(task)
              // 执行期间若被取消（runId 被清除或替换），不要再重新排期
              if (task.run.runId === timerId) {
                executeTaskInterval()
              }
            }, timeout)
            task.run.runId = timerId
          }
        }
        executeTaskInterval()
        break
      }
      case 'interval':
        if (!task.run.interval || task.run.interval <= 0) {
          logger.error(`Invalid interval for task ${task.name}: ${task.run.interval}`, undefined, 'TaskScheduler')
          break
        }
        task.run.runId = window.setInterval(async () => await this.executeTask(task), task.run.interval)
        break
      default:
        logger.error(`Invalid task mode: ${task.run.mode}`, undefined, 'TaskScheduler')
    }
  }

  public async executeTask(task: TaskListItem) {
    // 防止同一任务重叠执行
    if (this.runningTasks.has(task.name)) {
      logger.debug(`Task ${task.name} is already running, skipping`, 'TaskScheduler')
      return
    }

    this.runningTasks.add(task.name)
    try {
      const updatedTask = await runTask(task)
      this.tasks = this.tasks.map(t => t.name === updatedTask.name ? updatedTask : t)

      // disposable 模式：成功完成后删除；失败时保留，让用户能看到错误
      if (updatedTask.run.mode === 'disposable' && !updatedTask.runInfo?.error) {
        await delTask(updatedTask.name)
      }
    } catch (error) {
      // 调用方多以 void / 定时器回调方式触发，这里兜底避免未处理的 Promise 拒绝
      logger.error(`Task ${task.name} failed unexpectedly`, error as Error, 'TaskScheduler')
    } finally {
      this.runningTasks.delete(task.name)
    }
  }

  cancelTask(taskName: string) {
    // 同名的所有条目都要处理（编辑任务后旧对象可能仍留在列表中）
    for (const task of this.tasks.filter(t => t.name === taskName)) {
      if (task.run.runId !== undefined) {
        window.clearInterval(task.run.runId)
        window.clearTimeout(task.run.runId)
        task.run.runId = undefined
      }
    }
    this.tasks = this.tasks.filter(t => t.name !== taskName)
  }
}

export { TaskScheduler }
