import { reupStorage } from '../services/storage/StorageManager'
import { addOpenlistInRclone } from '../utils/openlist/openlist'
import { reupMount } from './storage/mount/mount'
import { autoMountOnStartup } from './storage/mount/autoMount'
import { checkNotice } from './update/notice'
import { updateStorageInfoList } from './storage/allList'
import { startTaskScheduler } from './task/task'
import { hooks } from '../services/hook'
import { logger } from '../services/LoggerService'
import { t } from 'i18next'
import { Notification } from '@arco-design/web-react'
import { reupRcloneVersion, reupOpenlistVersion } from './versionCheck'

export async function runStartupTasksInBackground() {
  hooks.startup.storageInitDone = false
  hooks.startup.storageSyncing = true
  hooks.startup.storageInitFailed = false
  hooks.upStartup()

  const failedSteps = new Set<string>()
  const runStep = async (label: string, fn: () => Promise<unknown>) => {
    try {
      await fn()
      return true
    } catch (e) {
      logger.error(`[startup] ${label} failed`, e as Error, 'StartupTasks', { step: label })
      if (!failedSteps.has(label)) {
        failedSteps.add(label)
        Notification.warning({
          id: `startup_step_failed_${label.replace(/\s+/g, '_')}`,
          title: t('warning'),
          content: t('startup_task_failed', { step: label }),
        })
      }
      return false
    }
  }

  hooks.retryStartupStorageSync = async () => {
    hooks.startup.storageSyncing = true
    hooks.startup.storageInitFailed = false
    hooks.upStartup()
    const refreshOk = await runStep('refresh storages and mounts', async () => {
      await reupStorage()
      await addOpenlistInRclone()
      await reupMount()
    })
    hooks.startup.storageInitDone = refreshOk
    hooks.startup.storageSyncing = false
    hooks.startup.storageInitFailed = !refreshOk
    hooks.upStartup()
  }

  await Promise.allSettled([
    runStep('check notice', async () => {
      await checkNotice()
      hooks.upNotice()
    }),
    runStep('sync versions', async () => {
      await Promise.allSettled([reupRcloneVersion(), reupOpenlistVersion()])
    }),
    runStep('update storage providers', updateStorageInfoList),
  ])

  const refreshOk = await runStep('refresh storages and mounts', async () => {
    await reupStorage()
    await addOpenlistInRclone()
    await reupMount()
  })
  hooks.startup.storageInitDone = refreshOk
  hooks.startup.storageSyncing = false
  hooks.startup.storageInitFailed = !refreshOk
  hooks.upStartup()

  if (refreshOk) {
    await runStep('auto mount', autoMountOnStartup)
  }

  await runStep('start task scheduler', startTaskScheduler)
  await runStep('main startup hooks', main)
}

async function main() {
  if (window.location.pathname.includes('mount')) {
    Notification.success({
      id: 'install_success',
      title: t('success'),
      content: 'WinFsp ' + t('install_success'),
    })
  }
}
