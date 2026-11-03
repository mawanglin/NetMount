import { WATCHDOG_CONFIG } from '../constants'
import { rcloneInfo } from '../services/rclone'
import { openlistInfo } from '../services/openlist'
import { rclone_api_noop } from '../utils/rclone/request'
import { openlist_api_ping } from '../utils/openlist/request'
import { restartRclone } from '../utils/rclone/process'
import { restartOpenlist } from '../utils/openlist/process'
import { Notification } from '@arco-design/web-react'
import { t } from 'i18next'
import { logger } from '../services/LoggerService'
import { nmConfig } from '../services/ConfigService'
import { recoverAfterComponentRestart } from './recovery'

let componentWatchdogTimer: number | undefined
let componentWatchdogStopping = false

export function startComponentWatchdog() {
  componentWatchdogStopping = false
  if (componentWatchdogTimer) {
    clearInterval(componentWatchdogTimer)
    componentWatchdogTimer = undefined
  }

  let running = false
  let rcloneFailCount = 0
  let openlistFailCount = 0
  let rcloneCooldownUntil = 0
  let openlistCooldownUntil = 0

  const { COOLDOWN_MS, INTERVAL_MS, FAIL_THRESHOLD } = WATCHDOG_CONFIG

  componentWatchdogTimer = window.setInterval(async () => {
    if (componentWatchdogStopping) return
    if (!nmConfig.settings.autoRecoverComponents) return
    if (running) return
    running = true

    try {
      const now = Date.now()

      if (rcloneInfo.process.child) {
        const ok = await rclone_api_noop()
        rcloneFailCount = ok ? 0 : rcloneFailCount + 1
        if (!ok && rcloneFailCount >= FAIL_THRESHOLD && now >= rcloneCooldownUntil) {
          rcloneCooldownUntil = now + COOLDOWN_MS
          rcloneFailCount = 0
          Notification.warning({
            id: 'rclone_auto_recover',
            title: t('transmit'),
            content: t('rclone_restarting'),
          })
          if (componentWatchdogStopping) return
          try {
            await restartRclone()
            await recoverAfterComponentRestart()
            Notification.success({
              id: 'rclone_auto_recover_ok',
              title: t('success'),
              content: t('rclone_restarted'),
            })
          } catch (e) {
            logger.error('restartRclone failed', e as Error, 'ComponentWatchdog')
          }
        }
      } else {
        rcloneFailCount = 0
      }

      if (openlistInfo.process.child) {
        const ok = await openlist_api_ping()
        openlistFailCount = ok ? 0 : openlistFailCount + 1
        if (!ok && openlistFailCount >= FAIL_THRESHOLD && now >= openlistCooldownUntil) {
          openlistCooldownUntil = now + COOLDOWN_MS
          openlistFailCount = 0
          Notification.warning({
            id: 'openlist_auto_recover',
            title: t('storage'),
            content: t('openlist_restarting'),
          })
          if (componentWatchdogStopping) return
          try {
            await restartOpenlist()
            await recoverAfterComponentRestart()
            Notification.success({
              id: 'openlist_auto_recover_ok',
              title: t('success'),
              content: t('openlist_restarted'),
            })
          } catch (e) {
            logger.error('restartOpenlist failed', e as Error, 'ComponentWatchdog')
          }
        }
      } else {
        openlistFailCount = 0
      }
    } finally {
      running = false
    }
  }, INTERVAL_MS)
}

export function stopComponentWatchdog() {
  componentWatchdogStopping = true
  if (componentWatchdogTimer) {
    clearInterval(componentWatchdogTimer)
    componentWatchdogTimer = undefined
  }
}
