import { saveNmConfig } from '../services/ConfigService'
import { stopRclone } from '../utils/rclone/process'
import { stopOpenlist } from '../utils/openlist/process'
import { stopComponentWatchdog } from './componentWatchdog'
import { exit as tauriExit } from '@tauri-apps/plugin-process'
import { logger } from '../services/LoggerService'
import { cleanupTempOnExit } from '../utils/tempCleanup'

let exiting: Promise<void> | undefined

/** 单个退出步骤：失败或超时只记录日志，不影响后续步骤 */
async function runExitStep(label: string, step: () => Promise<unknown>, timeoutMs = 8000): Promise<void> {
  try {
    await Promise.race([
      step(),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`timeout after ${timeoutMs}ms`)), timeoutMs)),
    ])
  } catch (e) {
    logger.error(`Exit step failed: ${label}`, e as Error, 'Lifecycle')
  }
}

export function exit(isRestartSelf: boolean = false): Promise<void> {
  // 托盘、窗口关闭等可能同时触发退出，只执行一次
  exiting ??= doExit(isRestartSelf)
  return exiting
}

async function doExit(isRestartSelf: boolean): Promise<void> {
  stopComponentWatchdog()

  await runExitStep('save config', saveNmConfig)
  await runExitStep('stop rclone', stopRclone)
  await runExitStep('stop openlist', stopOpenlist)
  await runExitStep('save config (final)', saveNmConfig)
  // 退出前清理临时文件（短超时，不阻塞退出）
  await runExitStep('cleanup temp files', cleanupTempOnExit, 5000)

  if (isRestartSelf) {
    exiting = undefined
    location.reload()
  } else {
    await tauriExit(0)
  }
}

export async function saveStateAndExit(isRestartSelf: boolean = false) {
  try {
    await saveNmConfig()
  } catch (e) {
    logger.error('Failed to save config before exit', e as Error, 'Lifecycle')
  }
  
  if (isRestartSelf) {
    location.reload()
  }
}
