/**
 * Logger Service - 统一的日志服务
 * 
 * 特性：
 * 1. 统一的日志格式（包含时间戳、级别、上下文）
 * 2. 日志级别控制（开发/生产环境不同级别）
 * 3. 支持结构化数据记录
 * 4. 可选的日志持久化（本地存储/文件）
 * 5. 性能优化（异步写入、批处理）
 * 
 * 替代 console.log/warn/error 的使用
 */

// ============================================
// 日志级别定义
// ============================================
export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
  FATAL = 4,
}

// 日志级别名称映射
const LOG_LEVEL_NAMES: Record<LogLevel, string> = {
  [LogLevel.DEBUG]: 'DEBUG',
  [LogLevel.INFO]: 'INFO',
  [LogLevel.WARN]: 'WARN',
  [LogLevel.ERROR]: 'ERROR',
  [LogLevel.FATAL]: 'FATAL',
}

// ============================================
// 日志配置
// ============================================
interface LoggerConfig {
  minLevel: LogLevel
  enableConsole: boolean
  enablePersistence: boolean
  maxLogEntries: number
  prefix?: string
}

const DEFAULT_CONFIG: LoggerConfig = {
  minLevel: import.meta.env.DEV ? LogLevel.DEBUG : LogLevel.INFO,
  enableConsole: import.meta.env.DEV, // 仅在开发环境启用 console 输出，生产环境禁用防止敏感数据泄露
  enablePersistence: false,
  maxLogEntries: import.meta.env.DEV ? 1000 : 100, // 生产环境减少内存占用
}

// ============================================
// 敏感数据脱敏
// ============================================
const SENSITIVE_KEY_RE =
  /(pass(word|wd)?|pwd|secret|token|credential|cookie|authorization|api[_-]?key|access[_-]?key|private[_-]?key)/i
const REDACTED = '***REDACTED***'
const MAX_REDACT_DEPTH = 6

/** 隐藏字符串里 URL 的 user:pass@ 凭据 */
function maskUrlCredentials(value: string): string {
  return value.replace(/(\b[a-z][a-z0-9+.-]*:\/\/)[^/\s@]+@/gi, '$1***@')
}

/**
 * 对日志附带的结构化数据脱敏：键名含 password/secret/token 等的值整体隐藏，
 * 字符串中 URL 里的凭据被遮蔽。返回新对象，不修改入参。
 */
export function redactLogData(value: unknown, depth: number = 0): unknown {
  if (typeof value === 'string') return maskUrlCredentials(value)
  if (value === null || typeof value !== 'object' || value instanceof Error) return value
  if (depth >= MAX_REDACT_DEPTH) return '[truncated]'
  if (Array.isArray(value)) return value.map(item => redactLogData(item, depth + 1))

  const out: Record<string, unknown> = {}
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    out[key] = SENSITIVE_KEY_RE.test(key) ? REDACTED : redactLogData(val, depth + 1)
  }
  return out
}

// ============================================
// 日志条目类型
// ============================================
interface LogEntry {
  timestamp: Date
  level: LogLevel
  message: string
  context?: string
  data?: Record<string, unknown>
  error?: Error
}

// ============================================
// 日志处理器接口
// ============================================
interface LogHandler {
  handle(entry: LogEntry): void
}

// 控制台处理器
class ConsoleHandler implements LogHandler {
  handle(entry: LogEntry): void {
    const timestamp = entry.timestamp.toISOString()
    const levelName = LOG_LEVEL_NAMES[entry.level]
    const context = entry.context ? `[${entry.context}]` : ''
    const prefix = `[${timestamp}] [${levelName}]${context}`

    switch (entry.level) {
      case LogLevel.DEBUG:
        console.debug(prefix, entry.message, entry.data || '')
        break
      case LogLevel.INFO:
        console.info(prefix, entry.message, entry.data || '')
        break
      case LogLevel.WARN:
        console.warn(prefix, entry.message, entry.data || '')
        break
      case LogLevel.ERROR:
      case LogLevel.FATAL:
        console.error(prefix, entry.message, entry.data || '', entry.error || '')
        break
    }
  }
}

// 内存存储处理器（用于调试）
class MemoryHandler implements LogHandler {
  private entries: LogEntry[] = []
  private maxEntries: number

  constructor(maxEntries: number) {
    this.maxEntries = maxEntries
  }

  handle(entry: LogEntry): void {
    this.entries.push(entry)
    if (this.entries.length > this.maxEntries) {
      this.entries.shift()
    }
  }

  getEntries(): LogEntry[] {
    return [...this.entries]
  }

  clear(): void {
    this.entries = []
  }
}

// ============================================
// Logger 类
// ============================================
export class Logger {
  private config: LoggerConfig
  private handlers: LogHandler[] = []
  private memoryHandler: MemoryHandler | null = null

  constructor(config: Partial<LoggerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config }

    if (this.config.enableConsole) {
      this.handlers.push(new ConsoleHandler())
    }

    if (this.config.enablePersistence) {
      this.memoryHandler = new MemoryHandler(this.config.maxLogEntries)
      this.handlers.push(this.memoryHandler)
    }
  }

  /**
   * 设置最小日志级别
   */
  setMinLevel(level: LogLevel): void {
    this.config.minLevel = level
  }

  /**
   * 添加自定义处理器
   */
  addHandler(handler: LogHandler): void {
    this.handlers.push(handler)
  }

  /**
   * 核心日志方法
   */
  private log(
    level: LogLevel,
    message: string,
    context?: string,
    data?: Record<string, unknown>,
    error?: Error
  ): void {
    if (level < this.config.minLevel) {
      return
    }

    const entry: LogEntry = {
      timestamp: new Date(),
      level,
      message: maskUrlCredentials(message),
      context,
      data: data ? (redactLogData(data) as Record<string, unknown>) : undefined,
      error,
    }

    this.handlers.forEach(handler => {
      try {
        handler.handle(entry)
      } catch (e) {
        // 处理器错误不应该影响主流程
        // 注意：此处故意使用 console.error，因为这是 Logger 内部，不能使用 logger 自身
        console.error('Log handler error:', e)
      }
    })
  }

  // ==========================================
  // 便捷方法
  // ==========================================

  debug(message: string, context?: string, data?: Record<string, unknown>): void {
    this.log(LogLevel.DEBUG, message, context, data)
  }

  info(message: string, context?: string, data?: Record<string, unknown>): void {
    this.log(LogLevel.INFO, message, context, data)
  }

  warn(message: string, context?: string, data?: Record<string, unknown>): void {
    this.log(LogLevel.WARN, message, context, data)
  }

  error(
    message: string,
    error?: Error,
    context?: string,
    data?: Record<string, unknown>
  ): void {
    this.log(LogLevel.ERROR, message, context, data, error)
  }

  fatal(
    message: string,
    error?: Error,
    context?: string,
    data?: Record<string, unknown>
  ): void {
    this.log(LogLevel.FATAL, message, context, data, error)
  }

  // ==========================================
  // 特定上下文日志
  // ==========================================

  /**
   * 创建带上下文的日志器
   */
  withContext(context: string): ContextLogger {
    return new ContextLogger(this, context)
  }

  /**
   * 获取内存中的日志条目（用于调试）
   */
  getMemoryLogs(): LogEntry[] {
    return this.memoryHandler?.getEntries() || []
  }

  /**
   * 清空内存日志
   */
  clearMemoryLogs(): void {
    this.memoryHandler?.clear()
  }
}

// ============================================
// 带上下文的日志器
// ============================================
export class ContextLogger {
  private logger: Logger
  private context: string

  constructor(logger: Logger, context: string) {
    this.logger = logger
    this.context = context
  }

  debug(message: string, data?: Record<string, unknown>): void {
    this.logger.debug(message, this.context, data)
  }

  info(message: string, data?: Record<string, unknown>): void {
    this.logger.info(message, this.context, data)
  }

  warn(message: string, data?: Record<string, unknown>): void {
    this.logger.warn(message, this.context, data)
  }

  error(message: string, error?: Error, data?: Record<string, unknown>): void {
    this.logger.error(message, error, this.context, data)
  }

  fatal(message: string, error?: Error, data?: Record<string, unknown>): void {
    this.logger.fatal(message, error, this.context, data)
  }
}

// ============================================
// 默认实例
// ============================================
export const logger = new Logger()

// 常用上下文日志器
export const storageLogger = logger.withContext('Storage')
export const fileLogger = logger.withContext('File')
export const transferLogger = logger.withContext('Transfer')
export const configLogger = logger.withContext('Config')
export const apiLogger = logger.withContext('API')
export const uiLogger = logger.withContext('UI')
