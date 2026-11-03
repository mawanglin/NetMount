import { describe, it, expect, vi, beforeEach } from 'vitest'

const { postMock, getMock, warnMock } = vi.hoisted(() => ({
  postMock: vi.fn(),
  getMock: vi.fn(),
  warnMock: vi.fn(),
}))

vi.mock('i18next', () => ({ t: (key: string) => key }))
vi.mock('../../../utils/openlist/request', () => ({
  openlist_api_get: getMock,
  openlist_api_post: postMock,
}))
vi.mock('../StorageManager', () => ({ reupStorage: vi.fn() }))
vi.mock('../../LoggerService', () => ({
  logger: { warn: warnMock, info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

import { importAlistConfig, parseAlistConfigWithStats } from '../AlistImportService'

const item = (mount_path: string, extra: Record<string, unknown> = {}) => ({
  mount_path,
  driver: 'Local',
  addition: '{"token":"super-secret"}',
  ...extra,
})

describe('parseAlistConfigWithStats', () => {
  beforeEach(() => warnMock.mockClear())

  it('拒绝含 .. 等不安全的 mount_path，并计入 skipped', () => {
    const { items, skipped } = parseAlistConfigWithStats([
      item('/ok'),
      item('/../../etc'),
      item('/a/../b'),
      item('/a//b'),
      item('/bad\\name'),
      item('/ctl\u0001'),
      item('/media/movies'),
    ])
    expect(items.map(i => i.mount_path)).toEqual(['/ok', '/media/movies'])
    expect(skipped).toBe(5)
  })

  it('缺少字段的条目计入 skipped，日志不包含 addition 凭据', () => {
    const { items, skipped } = parseAlistConfigWithStats([
      { mount_path: '/x', addition: '{"token":"super-secret"}' },
      { driver: 'Local', addition: '{"token":"super-secret"}' },
      null,
    ])
    expect(items).toHaveLength(0)
    expect(skipped).toBe(3)
    expect(JSON.stringify(warnMock.mock.calls)).not.toContain('super-secret')
  })
})

describe('importAlistConfig', () => {
  beforeEach(() => {
    postMock.mockReset()
    getMock.mockReset()
    postMock.mockResolvedValue({ code: 200 })
  })

  it('驱动列表只请求一次', async () => {
    getMock.mockResolvedValue({ data: ['Local'] })
    const result = await importAlistConfig([item('/a'), item('/b'), item('/c')])
    expect(getMock).toHaveBeenCalledTimes(1)
    expect(result.success).toBe(3)
  })

  it('驱动列表获取失败时不误判为不支持', async () => {
    getMock.mockRejectedValue(new Error('network'))
    const result = await importAlistConfig([item('/a')])
    expect(result.failed).toBe(0)
    expect(result.success).toBe(1)
  })

  it('不在支持列表内的驱动计为失败；被跳过的条目计入 skipped 与 total', async () => {
    getMock.mockResolvedValue({ data: ['Local'] })
    const result = await importAlistConfig([item('/a'), item('/b', { driver: 'Nope' }), item('/../x')])
    expect(result.success).toBe(1)
    expect(result.failed).toBe(1)
    expect(result.skipped).toBe(1)
    expect(result.total).toBe(3)
  })
})
