import { Message } from '@arco-design/web-react'
import { rcloneInfo } from '../../services/rclone'
import { logger } from '../../services/LoggerService'
import { buildApiUrl, getRcloneApiHeaders, handleApiResponse } from './httpClient'
import {
  JobStatusResponse,
  isAsyncJobResponse,
  isJobStatusResponse,
} from '../../type/rclone/api'

interface RcloneApiResponse {
  [key: string]: unknown
}

const ASYNC_TASK_DEFAULTS = {
  pollInterval: 1000,
  timeout: 0,
}

async function printError(error: Error | Response): Promise<void> {
  logger.error('Rclone API Error:', error instanceof Error ? error : undefined, 'RcloneAPI', { error })

  let errorMessage = ''

  if (error instanceof Response) {
    if (error.status) {
      errorMessage += `HTTP ${error.status} - ${error.statusText}\n`
    }
    try {
      const text = await error.text()
      if (text) {
        try {
          const errorData = JSON.parse(text) as { error?: unknown }
          if (typeof errorData?.error === 'string' && errorData.error.trim()) {
            errorMessage += `\n${errorData.error}`
          } else {
            errorMessage += `\n${JSON.stringify(errorData)}`
          }
        } catch {
          errorMessage += `\n${text}`
        }
      }
    } catch {
      // ignore
    }
  } else if (error instanceof Error) {
    errorMessage = error.message
  } else {
    errorMessage = String(error)
  }

  if (errorMessage) {
    Message.error(errorMessage)
  }
}

async function rclone_api_noop(): Promise<boolean> {
  // 必须带超时：rclone 假死时 fetch 会一直挂起，看门狗的检查就永远无法完成
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 3000)
  try {
    const url = buildApiUrl(rcloneInfo.endpoint.url, '/rc/noop')
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: getRcloneApiHeaders().Authorization },
      signal: controller.signal,
    })
    return res.ok
  } catch (e) {
    logger.debug('Rclone ping failed', 'Rclone', { error: e })
    return false
  } finally {
    clearTimeout(timeoutId)
  }
}

async function rclone_api_post(
  path: string,
  bodyData: object = {},
  ignoreError?: boolean
): Promise<RcloneApiResponse | undefined> {
  const fullPath = buildApiUrl(rcloneInfo.endpoint.url, path)

  try {
    const res = await fetch(fullPath, {
      method: 'POST',
      headers: getRcloneApiHeaders(),
      body: JSON.stringify(bodyData),
    })

    const data = await handleApiResponse(res)
    return data
  } catch (error) {
    if (!ignoreError) {
      await printError(error as Error | Response)
    }
    return undefined
  }
}

async function rclone_api_get(
  path: string,
  ignoreError?: boolean
): Promise<RcloneApiResponse | undefined> {
  const fullPath = buildApiUrl(rcloneInfo.endpoint.url, path)

  try {
    const res = await fetch(fullPath, {
      method: 'GET',
      headers: getRcloneApiHeaders(),
    })

    const data = await handleApiResponse(res)
    return data
  } catch (error) {
    if (!ignoreError) {
      await printError(error as Error | Response)
    }
    return undefined
  }
}

async function rclone_api_post_async(
  path: string,
  bodyData: object = {},
  ignoreError?: boolean
): Promise<number | undefined> {
  const fullPath = buildApiUrl(rcloneInfo.endpoint.url, path)

  try {
    const res = await fetch(fullPath, {
      method: 'POST',
      headers: getRcloneApiHeaders(),
      body: JSON.stringify({ ...bodyData, _async: true }),
    })

    const data = await handleApiResponse(res)
    
    if (!isAsyncJobResponse(data)) {
      logger.error('Invalid async job response format', undefined, 'RcloneAPI', { data })
      return undefined
    }
    
    return data.jobid
  } catch (error) {
    if (!ignoreError) {
      await printError(error as Error | Response)
    }
    return undefined
  }
}

async function rclone_api_job_status(
  jobid: number,
  ignoreError?: boolean
): Promise<JobStatusResponse | undefined> {
  const fullPath = buildApiUrl(rcloneInfo.endpoint.url, '/job/status')

  try {
    const res = await fetch(fullPath, {
      method: 'POST',
      headers: getRcloneApiHeaders(),
      body: JSON.stringify({ jobid }),
    })

    const data = await handleApiResponse(res)
    
    if (!isJobStatusResponse(data)) {
      logger.error('Invalid job status response format', undefined, 'RcloneAPI', { data, jobid })
      return undefined
    }
    
    return data
  } catch (error) {
    if (!ignoreError) {
      await printError(error as Error | Response)
    }
    return undefined
  }
}

async function rclone_api_wait_for_job(
  jobid: number,
  pollInterval: number = ASYNC_TASK_DEFAULTS.pollInterval,
  timeout: number = ASYNC_TASK_DEFAULTS.timeout,
  signal?: AbortSignal
): Promise<boolean> {
  const startTime = Date.now()
  // 状态查询偶发失败（网络抖动、rclone 重启中）不应直接判定任务失败，
  // 否则任务仍在 rclone 中运行，用户却被告知失败并可能重复发起
  const MAX_CONSECUTIVE_STATUS_FAILURES = 5
  let statusFailures = 0

  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (signal?.aborted) {
      logger.debug(`Job ${jobid} was cancelled`, 'Rclone')
      await rclone_api_post('/job/stop', { jobid }, true).catch(() => {})
      return false
    }

    const status = await rclone_api_job_status(jobid, true)

    if (!status) {
      statusFailures++
      if (statusFailures >= MAX_CONSECUTIVE_STATUS_FAILURES) {
        logger.error(`Failed to get job status for jobid: ${jobid}`)
        return false
      }
      await new Promise(resolve => setTimeout(resolve, pollInterval))
      continue
    }
    statusFailures = 0

    if (status.finished) {
      if (status.success) {
        logger.debug(`Job ${jobid} completed successfully`, 'Rclone')
        return true
      } else {
        const errorMsg = status.error || 'Unknown error'
        logger.error(`Job ${jobid} failed: ${errorMsg}`)
        Message.error(`Task failed: ${errorMsg}`)
        return false
      }
    }

    if (timeout > 0 && Date.now() - startTime > timeout) {
      logger.error(`Job ${jobid} timed out`, undefined, 'Rclone')
      Message.error('Task timed out')
      await rclone_api_post('/job/stop', { jobid }, true).catch(() => {})
      return false
    }

    // 每轮轮询都会注册 abort 监听，轮询结束后必须移除，否则长任务会累积监听器
    let onAbort: (() => void) | undefined
    await Promise.race([
      new Promise(resolve => setTimeout(resolve, pollInterval)),
      new Promise((_, reject) => {
        if (signal) {
          onAbort = () => reject(new Error('Cancelled'))
          signal.addEventListener('abort', onAbort, { once: true })
        }
      }),
    ])
      .catch(() => {})
      .finally(() => {
        if (signal && onAbort) signal.removeEventListener('abort', onAbort)
      })
  }
}

async function rclone_api_exec_async(
  path: string,
  bodyData: object = {},
  pollInterval: number = ASYNC_TASK_DEFAULTS.pollInterval,
  timeout: number = ASYNC_TASK_DEFAULTS.timeout,
  signal?: AbortSignal
): Promise<boolean> {
  const jobid = await rclone_api_post_async(path, bodyData, true)

  if (jobid === undefined) {
    logger.error(`Failed to start async job for ${path}`)
    return false
  }

  logger.debug(`Started async job ${jobid} for ${path}`, 'Rclone')
  return await rclone_api_wait_for_job(jobid, pollInterval, timeout, signal)
}

export {
  rclone_api_post,
  rclone_api_get,
  getRcloneApiHeaders,
  rclone_api_noop,
  rclone_api_post_async,
  rclone_api_job_status,
  rclone_api_wait_for_job,
  rclone_api_exec_async,
}
export type { RcloneApiResponse }
