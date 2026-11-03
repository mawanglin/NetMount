import type { TaskListItem } from '../../type/config'
import { copyDir, copyFile, delDir, delFile, moveDir, moveFile, sync } from '../../services/storage'
import { logger } from '../../services/LoggerService'

/** 路径是否指向存储根目录（空串、"/"、"\\"，或只由分隔符组成） */
function isRootPath(path: string): boolean {
  return path.replace(/[\\/]+/g, '') === ''
}

async function runTask(task: TaskListItem): Promise<TaskListItem> {
  const executeTask = async (t: TaskListItem) => {
    // 删除类任务无人值守地定时执行，源为存储根目录会清空整个存储（purge），一律拒绝
    // （配置可经导入带入，因此执行时也要检查，不能只依赖添加页的校验）
    if (t.taskType === 'delete' && isRootPath(t.source.path)) {
      throw new Error('Refusing to run a delete task on the storage root')
    }

    const srcIsDir = t.source.path.endsWith('/')
    const targetIsDir = t.target.path.endsWith('/')

    switch (t.taskType) {
      case 'copy': {
        const copyFilterRules = t.parameters?.filterRules as string[] | undefined
        if (srcIsDir && targetIsDir) {
          await copyDir(t.source.storageName, t.source.path, t.target.storageName, t.target.path, copyFilterRules)
        } else if (!srcIsDir && !targetIsDir) {
          await copyFile(t.source.storageName, t.source.path, t.target.storageName, t.target.path, true)
        } else if (!srcIsDir && targetIsDir) {
          await copyFile(t.source.storageName, t.source.path, t.target.storageName, t.target.path)
        } else {
          throw new Error('The directory cannot be copied/moved to a file')
        }
        break
      }
      case 'move': {
        const moveFilterRules = t.parameters?.filterRules as string[] | undefined
        if (srcIsDir && targetIsDir) {
          await moveDir(t.source.storageName, t.source.path, t.target.storageName, t.target.path, undefined, moveFilterRules)
        } else if (!srcIsDir && targetIsDir) {
          await moveFile(t.source.storageName, t.source.path, t.target.storageName, t.target.path)
        } else if (!srcIsDir && !targetIsDir) {
          await moveFile(t.source.storageName, t.source.path, t.target.storageName, t.target.path, undefined, true)
        } else {
          throw new Error('The directory cannot be copied/moved to a file')
        }
        break
      }
      case 'delete': {
        if (srcIsDir) {
          await delDir(t.source.storageName, t.source.path)
        } else {
          await delFile(t.source.storageName, t.source.path)
        }
        break
      }
      case 'sync': {
        const syncFilterRules = t.parameters?.filterRules as string[] | undefined
        await sync(t.source.storageName, t.source.path, t.target.storageName, t.target.path, false, false, syncFilterRules)
        break
      }
      case 'bisync': {
        // 使用resync参数处理首次同步或同步状态丢失的情况
        const useResync = t.parameters?.resync === true
        const bisyncFilterRules = t.parameters?.filterRules as string[] | undefined
        await sync(t.source.storageName, t.source.path, t.target.storageName, t.target.path, true, useResync, bisyncFilterRules)
        break
      }
      default: {
        throw new Error('Invalid task type')
      }
    }

    if (t.run.mode === 'disposable') {
      t.enable = false
    }
  }

  try {
    if (task.enable) {
      await executeTask(task)
      task.runInfo = { ...task.runInfo, error: false, msg: '' }
    }
  } catch (error) {
    logger.error(`Error executing task ${task.name}:`, error as Error, 'TaskRunner')
    task.runInfo = {
      ...task.runInfo,
      error: true,
      msg: error instanceof Error ? error.message : String(error),
    }
  }

  return task
}

export { runTask, isRootPath }
