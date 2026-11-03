/**
 * TaskRepository - 任务数据访问层
 * 
 * 封装任务相关的数据访问操作
 * 重构：直接操作 nmConfig.task，不再依赖 Controller 层
 */

import { BaseRepository } from '../base/BaseRepository'
import { RepositoryError, ErrorCode } from '../interfaces/IRepository'
import { logger } from '../../services/LoggerService'
import { nmConfig, saveNmConfig } from '../../services/ConfigService'
import type { TaskEntity, TaskStatus, TaskResult, TaskStats } from '../../type/task/task'
import type { TaskListItem } from '../../type/config'
import {
  TaskSchedulerLike,
  getTaskScheduler,
  taskListItemToEntity as _taskListItemToEntity,
  executeTask as _executeTask,
  cancelTask as _cancelTask,
  getTaskStatus as _getTaskStatus,
  getPendingTasks as _getPendingTasks,
  getRunningTasks as _getRunningTasks,
  getTaskStats as _getTaskStats,
  startScheduler as _startScheduler,
} from './taskHelpers'

const taskLogger = logger.withContext('TaskRepository')

/**
 * TaskRepository 类
 */
export class TaskRepository extends BaseRepository<TaskEntity> {
  constructor() {
    super({ enableCache: false })
  }

  /**
   * 将 TaskListItem 转换为 TaskEntity
   */
  private taskListItemToEntity(task: TaskListItem): TaskEntity {
    return _taskListItemToEntity(task)
  }

  // ==========================================
  // CRUD 方法
  // ==========================================

  async getAll(): Promise<TaskEntity[]> {
    return nmConfig.task.map(task => this.taskListItemToEntity(task))
  }

  async getById(id: string): Promise<TaskEntity | null> {
    const task = nmConfig.task.find(t => t.name === id)
    return task ? this.taskListItemToEntity(task) : null
  }

  async create(entity: Partial<TaskEntity>): Promise<TaskEntity> {
    if (!entity.name || !entity.taskType || !entity.source || !entity.target) {
      throw new RepositoryError(
        'Missing required fields: name, taskType, source, or target',
        ErrorCode.INVALID_DATA,
        'TaskRepository'
      )
    }

    // 检查是否已存在同名任务
    if (nmConfig.task.some(t => t.name === entity.name)) {
      throw new RepositoryError(
        'Task with this name already exists',
        ErrorCode.ALREADY_EXISTS,
        'TaskRepository'
      )
    }

    const taskListItem: TaskListItem = {
      name: entity.name,
      taskType: entity.taskType,
      source: entity.source,
      target: entity.target,
      parameters: entity.parameters,
      enable: entity.enable ?? true,
      run: entity.run ?? {
        mode: 'start',
        time: { intervalDays: 0, h: 0, m: 0, s: 0 },
      },
      runInfo: entity.runInfo ?? {},
    }

    nmConfig.task.push(taskListItem)
    await saveNmConfig()

    // 如果不是立即执行模式，添加到调度器
    if (taskListItem.run.mode !== 'start') {
      const scheduler = await getTaskScheduler()
      await scheduler.addTask(taskListItem)
    }

    const task = this.taskListItemToEntity(taskListItem)
    this.notifyChange({ type: 'create', id: task.id, newData: task, timestamp: new Date() })
    taskLogger.info('Task created', { id: task.id })
    return task
  }

  async update(id: string, entity: Partial<TaskEntity>): Promise<TaskEntity> {
    const oldTask = await this.getById(id)
    if (!oldTask) {
      throw new RepositoryError(`Task ${id} not found`, ErrorCode.NOT_FOUND, 'TaskRepository')
    }

    // 不允许更改任务名称
    if (entity.name && entity.name !== id) {
      throw new RepositoryError(
        'Cannot change task name, please delete and recreate',
        ErrorCode.INVALID_DATA,
        'TaskRepository'
      )
    }

    const taskIndex = nmConfig.task.findIndex(t => t.name === id)
    if (taskIndex === -1) {
      throw new RepositoryError('Task configuration not found', ErrorCode.NOT_FOUND, 'TaskRepository')
    }

    const oldTaskListItem = nmConfig.task[taskIndex]!

    // 构建更新后的配置
    const updatedTaskListItem: TaskListItem = {
      name: id,
      taskType: entity.taskType ?? oldTaskListItem.taskType,
      source: entity.source ?? oldTaskListItem.source,
      target: entity.target ?? oldTaskListItem.target,
      parameters: entity.parameters ?? oldTaskListItem.parameters,
      enable: entity.enable ?? oldTaskListItem.enable,
      run: entity.run ? { ...oldTaskListItem.run, ...entity.run } : oldTaskListItem.run,
      runInfo: entity.runInfo ?? oldTaskListItem.runInfo,
    }

    // 如果有运行ID，取消旧任务
    if (updatedTaskListItem.run.runId) {
      const scheduler = await getTaskScheduler()
      scheduler.cancelTask(id)
    }

    nmConfig.task[taskIndex] = updatedTaskListItem
    await saveNmConfig()

    // 如果调度模式变更，更新调度器
    if (updatedTaskListItem.run.mode !== 'start') {
      const scheduler = await getTaskScheduler()
      await scheduler.addTask(updatedTaskListItem)
    }

    const newTask = this.taskListItemToEntity(updatedTaskListItem)
    if (entity.status) newTask.status = entity.status

    this.notifyChange({ type: 'update', id, oldData: oldTask, newData: newTask, timestamp: new Date() })
    taskLogger.info('Task updated', { id })
    return newTask
  }

  async delete(id: string): Promise<boolean> {
    const oldTask = await this.getById(id)
    if (!oldTask) return false

    // 取消调度
    const scheduler = await getTaskScheduler()
    scheduler.cancelTask(id)

    // 从配置中删除
    nmConfig.task = nmConfig.task.filter(t => t.name !== id)
    await saveNmConfig()

    this.notifyChange({ type: 'delete', id, oldData: oldTask, timestamp: new Date() })
    taskLogger.info('Task deleted', { id })
    return true
  }

  async exists(id: string): Promise<boolean> {
    return nmConfig.task.some(t => t.name === id)
  }

  // ==========================================
  // 业务方法
  // ==========================================

  async executeTask(taskId: string): Promise<TaskResult> {
    return _executeTask(taskId)
  }

  async cancelTask(taskId: string): Promise<boolean> {
    return _cancelTask(taskId)
  }

  async getTaskStatus(taskId: string): Promise<TaskStatus> {
    return _getTaskStatus(taskId)
  }

  async getPendingTasks(): Promise<TaskEntity[]> {
    return _getPendingTasks()
  }

  async getRunningTasks(): Promise<TaskEntity[]> {
    return _getRunningTasks()
  }

  async getTaskStats(): Promise<TaskStats> {
    return _getTaskStats()
  }

  async startScheduler(): Promise<void> {
    return _startScheduler()
  }

  // ==========================================
  // 公开 API（供 Controller 使用）
  // ==========================================

  /**
   * 保存任务配置（兼容旧接口）
   */
  async saveTaskConfig(taskInfo: TaskListItem): Promise<boolean> {
    const existingIndex = nmConfig.task.findIndex(task => task.name === taskInfo.name)

    if (existingIndex !== -1) {
      // 存在同名任务，更新：无论新对象是否带 runId，都要取消旧任务的排期
      const scheduler = await getTaskScheduler()
      scheduler.cancelTask(taskInfo.name)
      nmConfig.task[existingIndex] = taskInfo
    } else {
      // 新任务，添加
      nmConfig.task.push(taskInfo)
    }

    if (taskInfo.run.mode !== 'start') {
      const scheduler = await getTaskScheduler()
      await scheduler.addTask(taskInfo)
    }

    await saveNmConfig()
    return true
  }

  /**
   * 删除任务配置（兼容旧接口）
   */
  async deleteTaskConfig(taskName: string): Promise<boolean> {
    const scheduler = await getTaskScheduler()
    scheduler.cancelTask(taskName)
    nmConfig.task = nmConfig.task.filter(task => task.name !== taskName)
    await saveNmConfig()
    return true
  }

  /**
   * 获取 TaskScheduler 实例（兼容旧接口）
   */
  async getScheduler(): Promise<TaskSchedulerLike> {
    return getTaskScheduler()
  }
}

export const taskRepository = new TaskRepository()
