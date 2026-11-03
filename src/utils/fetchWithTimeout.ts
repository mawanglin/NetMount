/**
 * 带超时的 fetch。超时后中止请求并抛出 AbortError。
 * 用于启动阶段访问外部服务（公告、更新检查等），避免服务不可达时无限挂起、拖住启动流程。
 */
export async function fetchWithTimeout(
  input: string,
  init: RequestInit = {},
  timeoutMs: number = 8000
): Promise<Response> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(input, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timeoutId)
  }
}

/** 是否为可安全在浏览器中打开的 http(s) 链接 */
export function isHttpUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:'
  } catch {
    return false
  }
}
