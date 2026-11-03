/**
 * PasswordGuard - 启动密码保护组件
 * 
 * 功能：
 * - 启动时密码验证
 * - 空闲超时自动锁定
 * - 休眠/睡眠时自动锁定
 * - 支持重新锁定
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { Button, Form, Input } from '@arco-design/web-react'
import { useTranslation } from 'react-i18next'
import { nmConfig, saveNmConfig } from '../services/ConfigService'
import { verifyPassword } from '../utils/passwordHash'
import { useSecurityStore } from '../stores/useSecurityStore'
import { logger } from '../services/LoggerService'

const FormItem = Form.Item

interface PasswordGuardProps {
  children: React.ReactNode
}

export function PasswordGuard({ children }: PasswordGuardProps): JSX.Element {
  const { t } = useTranslation()
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  // 连续失败次数与下次允许尝试的时间：达到阈值后按指数退避，减缓暴力尝试
  const [failures, setFailures] = useState(0)
  const [retryAt, setRetryAt] = useState(0)
  const [verifying, setVerifying] = useState(false)
  // 首次渲染时锁定状态尚未写入 store，期间不能渲染受保护的内容（否则会闪现界面）
  const [booted, setBooted] = useState(false)
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  
  const { 
    isLocked, 
    lock, 
    unlock, 
    setHasPassword, 
    setIdleTimeout, 
    updateActivity 
  } = useSecurityStore()

  const hasPassword = Boolean(nmConfig.settings.security?.startupPassword)
  const lockOnSleep = nmConfig.settings.security?.lockOnSleep ?? false
  const idleTimeoutMinutes = nmConfig.settings.security?.idleTimeoutMinutes ?? 0

  // 初始化：设置密码状态和空闲超时
  useEffect(() => {
    setHasPassword(hasPassword)
    setIdleTimeout(idleTimeoutMinutes)
    
    if (hasPassword) {
      lock()
    }
    setBooted(true)
  }, [hasPassword, idleTimeoutMinutes])

  // 空闲超时检测
  const resetIdleTimer = useCallback(() => {
    updateActivity()
    
    if (idleTimerRef.current) {
      clearTimeout(idleTimerRef.current)
    }
    
    if (idleTimeoutMinutes > 0 && hasPassword && !isLocked) {
      idleTimerRef.current = setTimeout(() => {
        logger.info('Idle timeout reached, locking application', 'PasswordGuard')
        lock()
      }, idleTimeoutMinutes * 60 * 1000)
    }
  }, [idleTimeoutMinutes, hasPassword, isLocked, lock, updateActivity])

  // 监听用户活动事件
  useEffect(() => {
    if (!hasPassword || idleTimeoutMinutes <= 0) return

    const activityEvents = ['mousedown', 'keydown', 'touchstart', 'scroll']
    
    const handleActivity = () => {
      if (!isLocked) {
        resetIdleTimer()
      }
    }

    activityEvents.forEach(event => {
      document.addEventListener(event, handleActivity, { passive: true })
    })

    // 初始化定时器
    resetIdleTimer()

    return () => {
      activityEvents.forEach(event => {
        document.removeEventListener(event, handleActivity)
      })
      if (idleTimerRef.current) {
        clearTimeout(idleTimerRef.current)
      }
    }
  }, [hasPassword, idleTimeoutMinutes, isLocked, resetIdleTimer])

  // 休眠/睡眠检测
  useEffect(() => {
    if (!hasPassword || !lockOnSleep) return

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        // 页面隐藏（可能是系统休眠或窗口最小化）
        // 记录隐藏时间，如果超过一定时间则锁定
        const hiddenTime = Date.now()
        const handleVisible = () => {
          if (document.visibilityState === 'visible') {
            const elapsed = Date.now() - hiddenTime
            // 如果隐藏超过5秒，认为是休眠/睡眠
            if (elapsed > 5000) {
              logger.info(`System sleep detected (${elapsed}ms hidden), locking application`, 'PasswordGuard')
              lock()
            }
            document.removeEventListener('visibilitychange', handleVisible)
          }
        }
        document.addEventListener('visibilitychange', handleVisible)
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [hasPassword, lockOnSleep, lock])

  const handleUnlock = async () => {
    if (verifying) return

    const waitMs = retryAt - Date.now()
    if (waitMs > 0) {
      setError(t('too_many_attempts', { seconds: Math.ceil(waitMs / 1000) }))
      return
    }

    setVerifying(true)
    try {
      const stored = nmConfig.settings.security?.startupPassword ?? ''
      const result = await verifyPassword(password, stored)
      if (result.ok) {
        // 旧格式（弱哈希）验证成功后升级为 PBKDF2
        if (result.upgradedHash && nmConfig.settings.security) {
          nmConfig.settings.security.startupPassword = result.upgradedHash
          saveNmConfig().catch(e =>
            logger.warn('Failed to save upgraded password hash', 'PasswordGuard', { error: String(e) })
          )
        }
        unlock()
        setError('')
        setPassword('')
        setFailures(0)
        setRetryAt(0)
        resetIdleTimer()
      } else {
        const next = failures + 1
        setFailures(next)
        // 前 4 次不限制；之后 5s、10s、20s ... 最长 5 分钟
        if (next >= 5) {
          const delay = Math.min(5000 * 2 ** (next - 5), 5 * 60 * 1000)
          setRetryAt(Date.now() + delay)
        }
        setError(t('wrong_password'))
      }
    } finally {
      setVerifying(false)
    }
  }

  if (!isLocked && (booted || !hasPassword)) {
    return <>{children}</>
  }

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'var(--color-bg-1)',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        zIndex: 9999,
      }}
    >
      <div
        style={{
          width: '20rem',
          padding: '2rem',
          backgroundColor: 'var(--color-bg-2)',
          borderRadius: '8px',
          boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
        }}
      >
        <h2 style={{ textAlign: 'center', marginBottom: '1.5rem' }}>
          {t('enter_startup_password')}
        </h2>
        <Form autoComplete="off">
          <FormItem>
            <Input.Password
              value={password}
              onChange={value => {
                setPassword(value)
                setError('')
              }}
              onPressEnter={handleUnlock}
              placeholder={t('please_input')}
              autoFocus
            />
          </FormItem>
          {error && (
            <div style={{ color: 'var(--color-danger-6)', marginBottom: '1rem', textAlign: 'center' }}>
              {error}
            </div>
          )}
          <FormItem>
            <Button
              type="primary"
              long
              onClick={handleUnlock}
              loading={verifying}
            >
              {t('unlock')}
            </Button>
          </FormItem>
        </Form>
      </div>
    </div>
  )
}
