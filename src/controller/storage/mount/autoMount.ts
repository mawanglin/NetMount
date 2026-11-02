import { Notification } from '@arco-design/web-react'
import { t } from 'i18next'
import { logger } from '../../../services/LoggerService'
import { nmConfig } from '../../../services/ConfigService'
import { rcloneInfo } from '../../../services/rclone'
import { mountRepository } from '../../../repositories/mount/MountRepository'
import { pickAutoMountTargets } from '../../../repositories/mount/mountView'

const autoMountLogger = logger.withContext('AutoMount')

/**
 * 启动时自动挂载配置了 autoMount 的存储
 * 需在存储列表与挂载列表刷新之后调用；单个失败不影响其余，最后汇总提示一次
 */
export async function autoMountOnStartup(): Promise<void> {
  const targets = pickAutoMountTargets(nmConfig.mount?.lists ?? [], rcloneInfo.mountList)
  if (targets.length === 0) return

  const failed: string[] = []
  for (const mountInfo of targets) {
    try {
      await mountRepository.mountStorage(mountInfo)
      autoMountLogger.info('Auto mounted', { mountPath: mountInfo.mountPath })
    } catch (error) {
      failed.push(mountInfo.mountPath)
      autoMountLogger.error(`Auto mount failed for ${mountInfo.mountPath}`, error as Error)
    }
  }

  if (failed.length > 0) {
    Notification.warning({
      id: 'auto_mount_failed',
      title: t('warning'),
      content: `${t('startup_task_failed', { step: t('mount') })}: ${failed.join(', ')}`,
    })
  }
}
