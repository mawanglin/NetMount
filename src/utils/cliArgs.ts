function parseExtraCliArgs(input?: string): string[] {
  if (!input || !input.trim()) return []

  const args: string[] = []
  let current = ''
  let quote: '"' | "'" | null = null

  for (let i = 0; i < input.length; i++) {
    const ch = input[i]!
    const next = input[i + 1]

    if (ch === '\\') {
      if (quote === '"') {
        // In double quotes, allow escaping quote/backslash.
        if (next === '"' || next === '\\') {
          current += next
          i++
          continue
        }
        current += ch
        continue
      }

      if (!quote) {
        // Outside quotes, only treat as escape for whitespace/quote/backslash.
        if (next && (/\s/.test(next) || next === '"' || next === "'" || next === '\\')) {
          current += next
          i++
          continue
        }
        // Keep normal Windows paths like C:\temp\logs literally.
        current += ch
        continue
      }
    }

    if (quote) {
      if (ch === quote) {
        quote = null
      } else {
        current += ch
      }
      continue
    }

    if (ch === '"' || ch === "'") {
      quote = ch
      continue
    }

    if (/\s/.test(ch)) {
      if (current) {
        args.push(current)
        current = ''
      }
      continue
    }

    current += ch
  }

  if (current) {
    args.push(current)
  }

  return args
}

/**
 * 过滤用户配置的额外参数中不允许覆盖的标志。
 *
 * 额外参数来自配置文件（可通过导入配置带入）。若允许覆盖 RC 的监听地址、认证等，
 * 一份恶意配置就能让 rclone 在无认证的情况下对局域网开放。
 * 同时处理 `--flag=value` 与 `--flag value` 两种写法（后者连同值一起丢弃）。
 */
function filterBlockedArgs(
  args: string[],
  blockedFlags: string[]
): { allowed: string[]; blocked: string[] } {
  const blockedSet = new Set(blockedFlags.map(f => f.toLowerCase()))
  const allowed: string[] = []
  const blocked: string[] = []

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!
    if (arg.startsWith('-')) {
      const flag = arg.split('=')[0]!.toLowerCase()
      if (blockedSet.has(flag)) {
        blocked.push(arg)
        // `--flag value`：值是下一个不以 '-' 开头的 token
        if (!arg.includes('=') && args[i + 1] !== undefined && !args[i + 1]!.startsWith('-')) {
          blocked.push(args[i + 1]!)
          i++
        }
        continue
      }
    }
    allowed.push(arg)
  }
  return { allowed, blocked }
}

/** rclone 不允许通过额外参数覆盖的标志：监听地址、认证、静态文件/Web GUI、TLS、配置文件位置 */
const RCLONE_BLOCKED_FLAGS = [
  '--rc-addr',
  '--rc-no-auth',
  '--rc-user',
  '--rc-pass',
  '--rc-htpasswd',
  '--rc-realm',
  '--rc-baseurl',
  '--rc-allow-origin',
  '--rc-files',
  '--rc-serve',
  '--rc-web-gui',
  '--rc-web-gui-update',
  '--rc-web-gui-force-update',
  '--rc-web-gui-no-open-browser',
  '--rc-job-expire-duration',
  '--rc-server-read-timeout',
  '--rc-server-write-timeout',
  '--rc-cert',
  '--rc-key',
  '--rc-client-ca',
  '--rc-min-tls-version',
  '--rc-auth-proxy',
  '--rc-template',
  '--config',
  '--password-command',
  '--ask-password',
]

/** OpenList 不允许通过额外参数覆盖数据目录 */
const OPENLIST_BLOCKED_FLAGS = ['--data', '-d']

export { parseExtraCliArgs, filterBlockedArgs, RCLONE_BLOCKED_FLAGS, OPENLIST_BLOCKED_FLAGS }
