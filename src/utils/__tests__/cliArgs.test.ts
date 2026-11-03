import { describe, it, expect } from 'vitest'
import { filterBlockedArgs, parseExtraCliArgs, RCLONE_BLOCKED_FLAGS, OPENLIST_BLOCKED_FLAGS } from '../cliArgs'

describe('filterBlockedArgs (rclone)', () => {
  const run = (input: string) => filterBlockedArgs(parseExtraCliArgs(input), RCLONE_BLOCKED_FLAGS)

  it('放行普通参数', () => {
    expect(run('--transfers 8 --checkers=16 --bwlimit 10M')).toEqual({
      allowed: ['--transfers', '8', '--checkers=16', '--bwlimit', '10M'],
      blocked: [],
    })
  })

  it('拦截覆盖监听地址与认证的参数（等号形式）', () => {
    const r = run('--rc-no-auth --rc-addr=0.0.0.0:5572 --rc-user=x --transfers=4')
    expect(r.allowed).toEqual(['--transfers=4'])
    expect(r.blocked).toEqual(['--rc-no-auth', '--rc-addr=0.0.0.0:5572', '--rc-user=x'])
  })

  it('空格形式的参数连同值一起丢弃，但不吞掉后面的选项', () => {
    const r = run('--rc-addr 0.0.0.0:5572 --transfers 4 --config /tmp/evil.conf')
    expect(r.allowed).toEqual(['--transfers', '4'])
    expect(r.blocked).toEqual(['--rc-addr', '0.0.0.0:5572', '--config', '/tmp/evil.conf'])
  })

  it('大小写不敏感，且 --rc-no-auth 后紧跟另一个选项时不丢弃该选项', () => {
    const r = run('--RC-NO-AUTH --transfers=2')
    expect(r.allowed).toEqual(['--transfers=2'])
    expect(r.blocked).toEqual(['--RC-NO-AUTH'])
  })

  it('不会把名称相近的合法参数误判为被拦截', () => {
    expect(run('--rc-job-expire-interval=1m --config-dir=x').blocked).toEqual([])
  })
})

describe('filterBlockedArgs (openlist)', () => {
  it('拦截覆盖数据目录的参数', () => {
    const r = filterBlockedArgs(parseExtraCliArgs('--data /tmp/x --debug'), OPENLIST_BLOCKED_FLAGS)
    expect(r.allowed).toEqual(['--debug'])
    expect(r.blocked).toEqual(['--data', '/tmp/x'])
  })
})
