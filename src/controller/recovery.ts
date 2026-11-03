import { reupStorage } from '../services/storage/StorageManager'
import { addOpenlistInRclone } from '../utils/openlist/openlist'
import { reupMount } from './storage/mount/mount'
import { autoMountOnStartup } from './storage/mount/autoMount'
import { logger } from '../services/LoggerService'

/**
 * 组件（rclone / openlist）被自动重启后，恢复其依赖的状态：
 * - rclone 重启会丢失全部挂载，且停止时已移除 openlist 的 remote
 * - openlist 重启后端口与 token 可能变化，需要重新写入 rclone 的 remote
 * 步骤与启动流程一致，且每步独立容错。
 */
export async function recoverAfterComponentRestart(): Promise<void> {
  const steps: Array<[string, () => Promise<unknown>]> = [
    ['refresh storages', reupStorage],
    ['add openlist remote', addOpenlistInRclone],
    ['refresh mounts', () => reupMount()],
    ['auto mount', autoMountOnStartup],
  ]
  for (const [label, step] of steps) {
    try {
      await step()
    } catch (e) {
      logger.error(`Recovery step failed: ${label}`, e as Error, 'Recovery')
    }
  }
}
