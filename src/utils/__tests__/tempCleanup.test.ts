import { describe, it, expect, vi } from 'vitest'

vi.mock('../../services/ConfigService', () => ({
  nmConfig: { settings: { path: { cacheDir: '/cache' } } },
  osInfo: { platform: 'linux' },
}))
vi.mock('../../services/LoggerService', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))
vi.mock('../netmountPaths', () => ({ netmountLogDir: () => '/logs' }))

import { invoke } from '@tauri-apps/api/core'
import { isSafeStorageNameForPath, cleanupStorageOnDelete, cleanupVfsCacheOnUnmount } from '../tempCleanup'

describe('isSafeStorageNameForPath', () => {
  it.each(['mys3', '115 Cloud', '网盘', 'a.b', 'name_1'])('接受 %s', name => {
    expect(isSafeStorageNameForPath(name)).toBe(true)
  })
  it.each(['', ' ', '.', '..', '../x', 'a/b', 'a\\b', '-flag', '--config=x'])('拒绝 %j', name => {
    expect(isSafeStorageNameForPath(name)).toBe(false)
  })
})

describe('不安全的存储名不会触发任何清理', () => {
  it('cleanupStorageOnDelete / cleanupVfsCacheOnUnmount', async () => {
    vi.mocked(invoke).mockReset()
    await cleanupStorageOnDelete('../../etc')
    await cleanupVfsCacheOnUnmount('--config=x')
    expect(invoke).not.toHaveBeenCalled()
  })
})
