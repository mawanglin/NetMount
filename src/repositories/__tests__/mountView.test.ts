import { describe, it, expect, vi } from 'vitest'
import type { MountListItem } from '../../type/config'
import type { MountList } from '../../type/rclone/rcloneInfo'

vi.mock('../../services/LoggerService', () => ({
  logger: { withContext: () => ({ warn: vi.fn(), debug: vi.fn(), info: vi.fn(), error: vi.fn() }) },
}))
vi.mock('../../services/ConfigService', () => ({ nmConfig: {} }))
vi.mock('../../services/rclone', () => ({ rcloneInfo: {} }))
vi.mock('../../stores/mountStore', () => ({ useMountStore: {} }))
vi.mock('../../services/hook', () => ({ hooks: {} }))
vi.mock('../../utils/rclone/request', () => ({ rclone_api_post: vi.fn() }))
vi.mock('../../utils', () => ({ fs_exist_dir: vi.fn(), fs_make_dir: vi.fn() }))
vi.mock('../../services/storage/StorageManager', () => ({ convertStoragePath: vi.fn() }))
vi.mock('../../type/rclone/api', () => ({ isMountListResponse: vi.fn() }))

import { buildMountRows, isSameMountPath, pickAutoMountTargets } from '../mount/mountView'

const cfg = (mountPath: string, autoMount = false, storageName = 's'): MountListItem => ({
  storageName,
  mountPath,
  parameters: { vfsOpt: {}, mountOpt: {} },
  autoMount,
})
const live = (mountPath: string, storageName = 's'): MountList => ({
  storageName,
  mountPath,
  mountedTime: new Date(0),
})

describe('isSameMountPath', () => {
  it('忽略末尾斜杠与分隔符差异', () => {
    expect(isSameMountPath('/mnt/a/', '/mnt/a')).toBe(true)
    expect(isSameMountPath('C:\\Mounts\\a', 'C:/Mounts/a')).toBe(true)
  })
  it('盘符 X: 与 X:\\ 视为相同且忽略大小写', () => {
    expect(isSameMountPath('X:', 'x:\\')).toBe(true)
    expect(isSameMountPath('X:', 'Y:')).toBe(false)
  })
  it('不同路径不相等', () => {
    expect(isSameMountPath('/mnt/a', '/mnt/b')).toBe(false)
  })
})

describe('buildMountRows', () => {
  it('未挂载的配置也会出现', () => {
    const rows = buildMountRows([cfg('/mnt/a')], [])
    expect(rows).toEqual([{ storageName: 's', mountPath: '/mnt/a', mounted: false, hasConfig: true }])
  })
  it('已挂载的配置标记 mounted', () => {
    const rows = buildMountRows([cfg('X:/')], [live('X:\\')])
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ mounted: true, hasConfig: true })
  })
  it('仅存在于 rclone 的挂载点标记为无配置', () => {
    const rows = buildMountRows([], [live('/mnt/x', 'ext')])
    expect(rows).toEqual([{ storageName: 'ext', mountPath: '/mnt/x', mounted: true, hasConfig: false }])
  })
})

describe('pickAutoMountTargets', () => {
  it('只选开启 autoMount 且未挂载的配置', () => {
    const configs = [cfg('/mnt/a', true), cfg('/mnt/b', false), cfg('/mnt/c', true)]
    const targets = pickAutoMountTargets(configs, [live('/mnt/c')])
    expect(targets.map(t => t.mountPath)).toEqual(['/mnt/a'])
  })
})
