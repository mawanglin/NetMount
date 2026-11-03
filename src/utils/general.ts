/**
 * 检查对象是否为空
 * @param obj - 要检查的对象
 * @returns 如果对象为空则返回 true
 */
export function isEmptyObject(obj: Record<string, unknown>): boolean {
  if (!obj || typeof obj !== 'object') {
    return true
  }
  return Object.keys(obj).length === 0 && obj.constructor === Object
}

/**
 * 获取 URL 搜索参数
 * @param name - 参数名
 * @returns 参数值
 */
export function getURLSearchParam(name: string): string {
  const searchParams = new URLSearchParams(window.location.search)
  return searchParams.get(name) || ''
}

/**
 * 获取对象属性数组
 * @param obj - 输入对象
 * @returns 包含键值对的对象数组
 */
export function getProperties<T extends Record<string, unknown>>(
  obj: T
): Array<{ key: string; value: unknown }> {
  const result: Array<{ key: string; value: unknown }> = []

  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      result.push({ key: key, value: obj[key] })
    }
  }

  return result
}

/**
 * 合并对象
 * @param target - 目标对象
 * @param source - 源对象
 * @returns 合并后的对象
 */
export function mergeObjects<T>(target: T, source: Partial<T>): T {
  for (const key in source) {
    if (Object.prototype.hasOwnProperty.call(source, key)) {
      const sourceValue = source[key]
      const targetValue = target[key]

      if (typeof sourceValue === 'object' && !Array.isArray(sourceValue) && sourceValue !== null) {
        if (
          typeof targetValue === 'object' &&
          !Array.isArray(targetValue) &&
          targetValue !== null
        ) {
          target[key] = mergeObjects(targetValue, sourceValue)
        } else {
          target[key] = sourceValue as T[Extract<keyof T, string>]
        }
      } else {
        // 如果不是对象，则直接覆盖
        target[key] = sourceValue as T[Extract<keyof T, string>]
      }
    }
  }
  return target
}

/**
 * 存储名称是否合法。
 * 名称会用作 rclone 的 remote 名（"name:"）、OpenList 挂载路径与缓存目录名，
 * 因此不能含路径分隔符、冒号、控制字符，不能以 "-" 开头，首尾不能有空格，也不能是 "." / ".."。
 */
export function isValidStorageName(name: string): boolean {
  if (!name || name.length > 255) return false
  if (name !== name.trim() || name === '.' || name === '..' || name.startsWith('-')) return false
  if (/[/\\:]/.test(name)) return false
  return ![...name].some(ch => ch.charCodeAt(0) < 0x20)
}
