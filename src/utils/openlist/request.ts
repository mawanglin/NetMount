import { openlistInfo } from '../../services/openlist'
import { logger } from '../../services/LoggerService'
import { HTTP_HEADERS } from '../../constants'
import { getOpenlistToken } from './openlistAuth'

/** 单次请求超时。OpenList 创建存储等操作可能较慢，故取较宽松的值 */
const API_TIMEOUT_MS = 60_000

/**
 * 带超时的 fetch：服务假死时不会无限挂起（否则启动、恢复流程会被卡住）
 */
async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT_MS)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timeoutId)
  }
}

/**
 * OpenList 的令牌会过期（默认 48 小时），过期后接口以 HTTP 200 + code 401 响应。
 * 长时间运行的应用需要自动重新登录并重试一次，否则 OpenList 相关功能会永久失效。
 */
async function withReauth(request: () => Promise<ApiResponse>): Promise<ApiResponse> {
  const first = await request()
  if (first.code !== 401 || !openlistInfo.endpoint.auth.token) {
    return first
  }
  logger.info('OpenList token expired, re-login and retry', 'OpenListAPI')
  openlistInfo.endpoint.auth.token = ''
  try {
    await getOpenlistToken()
  } catch (e) {
    logger.warn('OpenList re-login failed', 'OpenListAPI', { error: String(e) })
    return first
  }
  return request()
}

// API 响应接口
interface ApiResponse {
  code?: number
  message?: string
  data?: unknown
  [key: string]: unknown
}

/**
 * 构建完整 URL（包含查询参数）
 */
function buildFullPath(path: string, queryData?: object): string {
  const searchParams = new URLSearchParams()
  if (queryData) {
    Object.entries(queryData).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        searchParams.append(key, String(value))
      }
    })
  }
  const queryString = searchParams.toString()
  return `${openlistInfo.endpoint.url}${path}${queryString ? '?' + queryString : ''}`
}

/**
 * 统一处理 API 响应
 */
async function handleApiResponse(
  res: Response,
  fullPath: string,
  method: string
): Promise<ApiResponse> {
  // 检查 HTTP 状态
  if (!res.ok) {
    logger.error(
      `OpenList API HTTP error [${method}]: ${res.status} ${res.statusText} for ${fullPath}`,
      undefined,
      'OpenListAPI'
    )
    throw new Error(`HTTP ${res.status}: ${res.statusText}`)
  }

  // 解析 JSON
  let data: ApiResponse
  try {
    data = await res.json()
  } catch (parseError) {
    logger.error(`OpenList API JSON parse error [${method}] for ${fullPath}`, parseError as Error, 'OpenListAPI')
    throw new Error('JSON parse error')
  }

  // 检查业务状态码
  // 注意：业务错误（code != 200）仅记录日志，不抛出异常
  // 调用方应根据返回的 code 自行处理业务错误
  if (data.code !== undefined && data.code !== 200) {
    logger.error(
      `OpenList API business error [${method}]: code=${data.code}, message=${data.message}, path=${fullPath}`,
      undefined,
      'OpenListAPI'
    )
  }

  return data
}

/**
 * 统一错误处理包装器
 */
async function wrapApiCall<T>(
  operation: () => Promise<T>,
  fullPath: string,
  method: string
): Promise<T> {
  try {
    return await operation()
  } catch (error) {
    logger.error(`OpenList API call failed [${method}] for ${fullPath}`, error instanceof Error ? error : new Error(String(error)))
    throw error
  }
}

/**
 * OpenList API Ping 检查
 */
async function openlist_api_ping(): Promise<boolean> {
  try {
    const url = openlistInfo.endpoint.url + '/ping'
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 2000) // 2秒超时

    const res = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
    })
    clearTimeout(timeoutId)

    if (res.ok) {
      return true
    }
    logger.warn(`OpenList ping returned status: ${res.status}`, 'OpenListAPI')
    return false
  } catch (e) {
    // 只在特定情况下记录错误，避免日志刷屏
    if (e instanceof Error && e.name !== 'AbortError') {
      logger.warn('OpenList ping failed', 'OpenListAPI', { message: e.message })
    }
    return false
  }
}

/**
 * OpenList API GET 请求
 */
async function openlist_api_get(path: string, queryData?: object): Promise<ApiResponse> {
  const fullPath = buildFullPath(path, queryData)

  return wrapApiCall(
    () =>
      withReauth(async () => {
        const headers: Record<string, string> = {}
        if (openlistInfo.endpoint.auth.token) {
          headers['Authorization'] = openlistInfo.endpoint.auth.token
        }
        const res = await fetchWithTimeout(fullPath, {
          method: 'GET',
          redirect: 'follow',
          headers,
        })
        return handleApiResponse(res, fullPath, 'GET')
      }),
    fullPath,
    'GET'
  )
}

/**
 * OpenList API POST 请求
 */
async function openlist_api_post(
  path: string,
  bodyData?: object,
  queryData?: object
): Promise<ApiResponse> {
  const fullPath = buildFullPath(path, queryData)

  return wrapApiCall(
    () =>
      withReauth(async () => {
        const headers: Record<string, string> = {
          'Content-Type': HTTP_HEADERS.CONTENT_TYPE_JSON,
        }
        if (openlistInfo.endpoint.auth.token) {
          headers['Authorization'] = openlistInfo.endpoint.auth.token
        }
        const res = await fetchWithTimeout(fullPath, {
          method: 'POST',
          redirect: 'follow',
          headers,
          body: bodyData ? JSON.stringify(bodyData) : null,
        })
        return handleApiResponse(res, fullPath, 'POST')
      }),
    fullPath,
    'POST'
  )
}

export { openlist_api_get, openlist_api_post, openlist_api_ping }
export type { ApiResponse }
