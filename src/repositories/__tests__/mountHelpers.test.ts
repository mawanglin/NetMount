import { describe, it, expect, vi, beforeEach } from 'vitest'

const { setMountList, rcloneInfoMock } = vi.hoisted(() => ({
  setMountList: vi.fn(),
  rcloneInfoMock: { mountList: [] as unknown[], version: { os: 'linux' } },
}))

vi.mock('../../services/LoggerService', () => ({
  logger: { warn: vi.fn(), withContext: () => ({ warn: vi.fn(), debug: vi.fn(), info: vi.fn(), error: vi.fn() }) },
}))
const { nmConfigMock } = vi.hoisted(() => ({ nmConfigMock: { mount: { lists: [] as unknown[] } } }))
vi.mock('../../services/ConfigService', () => ({ nmConfig: nmConfigMock }))
vi.mock('../../utils/tempCleanup', () => ({ cleanupVfsCacheOnUnmount: vi.fn() }))
vi.mock('../../services/rclone', () => ({ rcloneInfo: rcloneInfoMock }))
vi.mock('../../stores/mountStore', () => ({ useMountStore: { getState: () => ({ setMountList }) } }))
vi.mock('../../services/hook', () => ({ hooks: { upMount: vi.fn() } }))
vi.mock('../../utils/rclone/request', () => ({ rclone_api_post: vi.fn() }))
vi.mock('../../utils', () => ({ fs_exist_dir: vi.fn(), fs_make_dir: vi.fn() }))
vi.mock('../../services/storage/StorageManager', () => ({
  convertStoragePath: (name: string) => name + ':',
}))

import {
  generateMountId,
  parseMountId,
  refreshMountList,
  performUnmount,
  forgetAllVfsCache,
  isFsUsedByOtherMount,
} from '../mount/mountHelpers'
import { rclone_api_post } from '../../utils/rclone/request'
import { hooks } from '../../services/hook'
import { cleanupVfsCacheOnUnmount } from '../../utils/tempCleanup'

describe('generateMountId / parseMountId', () => {
  it.each([
    ['my_drive', '/mnt/my_drive'],
    ['a_b_c', 'C:\\Mounts\\x_y'],
    ['网盘 1', '/mnt/网盘 1'],
    ['plain', '/mnt/plain'],
  ])('往返一致: %s', (name, path) => {
    expect(parseMountId(generateMountId(name, path))).toEqual({ storageName: name, mountPath: path })
  })

  it('无分隔符时返回 null', () => {
    expect(parseMountId('nounderscore')).toBeNull()
  })
})

describe('refreshMountList', () => {
  beforeEach(() => {
    setMountList.mockClear()
    vi.mocked(hooks.upMount).mockClear()
    rcloneInfoMock.mountList = []
  })

  it('同步 rcloneInfo、store 并通知 UI', async () => {
    vi.mocked(rclone_api_post).mockResolvedValue({
      mountPoints: [{ fs: 's:', mountPoint: '/mnt/s', mountedOn: '2024-01-01T00:00:00Z' }],
    })
    await refreshMountList()
    expect(rcloneInfoMock.mountList).toHaveLength(1)
    expect(setMountList).toHaveBeenCalledTimes(1)
    expect(hooks.upMount).toHaveBeenCalledTimes(1)
  })

  it('noRefreshUI 时不通知 UI', async () => {
    vi.mocked(rclone_api_post).mockResolvedValue({ mountPoints: [] })
    await refreshMountList(true)
    expect(hooks.upMount).not.toHaveBeenCalled()
  })
})

const mp = (fs: string, mountPoint: string) => ({ fs, mountPoint, mountedOn: '2024-01-01T00:00:00Z' })
const cfgItem = (storageName: string, mountPath: string) => ({
  storageName,
  mountPath,
  parameters: { vfsOpt: {}, mountOpt: {} },
  autoMount: false,
})

describe('isFsUsedByOtherMount', () => {
  const live = [
    { storageName: 's:', mountPath: '/mnt/a', mountedTime: new Date(0) },
    { storageName: 's:', mountPath: '/mnt/b', mountedTime: new Date(0) },
  ]
  it('排除自身后仍有其他挂载点', () => {
    expect(isFsUsedByOtherMount(live, 's:', '/mnt/a')).toBe(true)
  })
  it('只有自身时为 false', () => {
    expect(isFsUsedByOtherMount([live[0]!], 's:', '/mnt/a/')).toBe(false)
  })
})

describe('performUnmount', () => {
  beforeEach(() => {
    vi.mocked(rclone_api_post).mockReset()
    vi.mocked(cleanupVfsCacheOnUnmount).mockReset()
    rcloneInfoMock.version.os = 'linux'
  })

  const paths = () => vi.mocked(rclone_api_post).mock.calls.map(c => c[0])

  it('同一存储被其他挂载点使用时跳过 vfs/forget 与缓存清理', async () => {
    nmConfigMock.mount.lists = [cfgItem('s', '/mnt/a'), cfgItem('s', '/mnt/b')]
    vi.mocked(rclone_api_post).mockImplementation(async (path: string) =>
      path === '/mount/listmounts'
        ? { mountPoints: [mp('s:', '/mnt/a'), mp('s:', '/mnt/b')] }
        : undefined
    )
    await performUnmount('/mnt/a')
    expect(paths()).toContain('/mount/unmount')
    expect(paths()).not.toContain('/vfs/forget')
    expect(cleanupVfsCacheOnUnmount).not.toHaveBeenCalled()
  })

  it('最后一个挂载点卸载时清理缓存', async () => {
    nmConfigMock.mount.lists = [cfgItem('s', '/mnt/a')]
    let unmounted = false
    vi.mocked(rclone_api_post).mockImplementation(async (path: string) => {
      if (path === '/mount/unmount') unmounted = true
      if (path === '/mount/listmounts') {
        return { mountPoints: unmounted ? [] : [mp('s:', '/mnt/a')] }
      }
      return undefined
    })
    await performUnmount('/mnt/a')
    expect(paths()).toContain('/vfs/forget')
    expect(cleanupVfsCacheOnUnmount).toHaveBeenCalledWith('s')
  })

  it('使用 rclone 记录的实际挂载点格式卸载（盘符 X: vs X:\\）', async () => {
    rcloneInfoMock.version.os = 'windows'
    nmConfigMock.mount.lists = [cfgItem('s', 'X:')]
    vi.mocked(rclone_api_post).mockImplementation(async (path: string) =>
      path === '/mount/listmounts' ? { mountPoints: [mp('s:', 'X:\\')] } : undefined
    )
    await performUnmount('X:')
    expect(rclone_api_post).toHaveBeenCalledWith('/mount/unmount', { mountPoint: 'X:\\' })
  })
})

describe('forgetAllVfsCache', () => {
  it('刷新后按 fs 去重 forget', async () => {
    vi.mocked(rclone_api_post).mockReset()
    vi.mocked(rclone_api_post).mockImplementation(async (path: string) =>
      path === '/mount/listmounts'
        ? { mountPoints: [mp('s:', '/mnt/a'), mp('s:', '/mnt/b'), mp('t:', '/mnt/c')] }
        : undefined
    )
    await forgetAllVfsCache()
    const forgets = vi.mocked(rclone_api_post).mock.calls.filter(c => c[0] === '/vfs/forget')
    expect(forgets.map(c => (c[1] as { fs: string }).fs).sort()).toEqual(['s:', 't:'])
  })
})
