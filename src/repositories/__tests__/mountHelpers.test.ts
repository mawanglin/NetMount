import { describe, it, expect, vi, beforeEach } from 'vitest'

const { setMountList, rcloneInfoMock } = vi.hoisted(() => ({
  setMountList: vi.fn(),
  rcloneInfoMock: { mountList: [] as unknown[], version: { os: 'linux' } },
}))

vi.mock('../../services/LoggerService', () => ({
  logger: { warn: vi.fn(), withContext: () => ({ warn: vi.fn(), debug: vi.fn(), info: vi.fn(), error: vi.fn() }) },
}))
vi.mock('../../services/ConfigService', () => ({ nmConfig: {} }))
vi.mock('../../services/rclone', () => ({ rcloneInfo: rcloneInfoMock }))
vi.mock('../../stores/mountStore', () => ({ useMountStore: { getState: () => ({ setMountList }) } }))
vi.mock('../../services/hook', () => ({ hooks: { upMount: vi.fn() } }))
vi.mock('../../utils/rclone/request', () => ({ rclone_api_post: vi.fn() }))
vi.mock('../../utils', () => ({ fs_exist_dir: vi.fn(), fs_make_dir: vi.fn() }))
vi.mock('../../services/storage/StorageManager', () => ({ convertStoragePath: vi.fn() }))

import { generateMountId, parseMountId, refreshMountList } from '../mount/mountHelpers'
import { rclone_api_post } from '../../utils/rclone/request'
import { hooks } from '../../services/hook'

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
