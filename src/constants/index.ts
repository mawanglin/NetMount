/**
 * 全局常量定义
 * 集中管理所有魔术数字和字符串，增强可维护性
 */

// ============================================
// API 超时配置（毫秒）
// ============================================
export const API_TIMEOUT = {
  DEFAULT: 10_000,
  PING: 5_000,
  LONG: 30_000,
  VERSION_CHECK: 5_000,
  OPENLIST_VERSION: 10_000,
} as const

// ============================================
// 重试配置
// ============================================
export const RETRY_CONFIG = {
  MAX_ATTEMPTS: 3,
  INITIAL_DELAY: 1_000,
  MAX_DELAY: 10_000,
  BACKOFF_MULTIPLIER: 2,
  JITTER_RANGE: 500,
} as const

// ============================================
// 主题和语言配置
// ============================================
export const THEME_MODES = ['auto', 'light', 'dark'] as const

export const LANGUAGE_OPTIONS = [
  { name: '简体中文', value: 'cn', langCode: 'zh-cn' },
  { name: '繁體中文', value: 'ct', langCode: 'zh-tw' },
  { name: 'English', value: 'en', langCode: 'en-us' },
] as const

// ============================================
// 看门狗配置
// ============================================
export const WATCHDOG_CONFIG = {
  COOLDOWN_MS: 60_000,
  FAIL_THRESHOLD: 3,
  INTERVAL_MS: 10_000,
  INITIAL_DELAY_MS: 1000,
} as const

// ============================================
// 更新检查配置
// ============================================
export const UPDATE_CONFIG = {
  CHECK_DELAY_MS: 5000,
  CHECK_SILENT: true,
} as const

// ============================================
// HTTP 相关常量
// ============================================
export const HTTP_HEADERS = {
  CONTENT_TYPE_JSON: 'application/json',
  CONTENT_TYPE_TEXT: 'text/plain',
  CONTENT_TYPE_HTML: 'text/html',
} as const

export const LOCALHOST_URLS = {
  RCLONE: 'http://127.0.0.1',
  // 使用回环 IP 而非 localhost，避免解析到仅监听 IPv4 的服务不监听的 ::1
  OPENLIST: 'http://127.0.0.1',
} as const
