/**
 * FileManager 单元测试
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  delFile,
  delDir,
  mkDir,
  refreshVfsCache,
  uploadFileRequest,
} from '../FileManager'

// Mock 依赖模块
vi.mock('../../../utils/rclone/request', () => ({
  rclone_api_post: vi.fn(),
  getRcloneApiHeaders: vi.fn(() => ({ Authorization: 'Bearer test' })),
}))

vi.mock('../../services/rclone', () => ({
  rcloneInfo: {
    endpoint: { url: 'http://localhost:5572' },
  },
}))

vi.mock('../StorageManager', () => ({
  searchStorage: vi.fn(),
  convertStoragePath: vi.fn((name, path) => `${name}:${path || ''}`),
  formatPathRclone: vi.fn((path) => path?.replace(/^\//, '') || ''),
}))

describe('FileManager', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('delFile', () => {
    it('should delete file successfully', async () => {
      const { rclone_api_post } = await import('../../../utils/rclone/request')
      vi.mocked(rclone_api_post).mockResolvedValueOnce(undefined)

      await delFile('storage1', '/folder/file.txt')

      expect(rclone_api_post).toHaveBeenCalledWith(
        '/operations/deletefile',
        expect.any(Object)
      )
    })

    it('should remove leading slash from path', async () => {
      const { rclone_api_post } = await import('../../../utils/rclone/request')
      vi.mocked(rclone_api_post).mockResolvedValueOnce(undefined)

      await delFile('storage1', 'folder/file.txt')

      expect(rclone_api_post).toHaveBeenCalled()
    })

    it('should call refresh callback after deletion', async () => {
      const { rclone_api_post } = await import('../../../utils/rclone/request')
      vi.mocked(rclone_api_post).mockResolvedValueOnce(undefined)
      const refreshCallback = vi.fn()

      await delFile('storage1', '/file.txt', refreshCallback)

      expect(refreshCallback).toHaveBeenCalled()
    })
  })

  describe('delDir', () => {
    it('should delete directory successfully', async () => {
      const { rclone_api_post } = await import('../../../utils/rclone/request')
      vi.mocked(rclone_api_post).mockResolvedValueOnce(undefined)

      await delDir('storage1', '/folder')

      expect(rclone_api_post).toHaveBeenCalledWith(
        '/operations/purge',
        expect.any(Object)
      )
    })

    it('should call refresh callback after deletion', async () => {
      const { rclone_api_post } = await import('../../../utils/rclone/request')
      vi.mocked(rclone_api_post).mockResolvedValueOnce(undefined)
      const refreshCallback = vi.fn()

      await delDir('storage1', '/folder', refreshCallback)

      expect(refreshCallback).toHaveBeenCalled()
    })
  })

  describe('mkDir', () => {
    it('should create directory successfully', async () => {
      const { rclone_api_post } = await import('../../../utils/rclone/request')
      vi.mocked(rclone_api_post).mockResolvedValueOnce(undefined)

      await mkDir('storage1', '/new-folder')

      expect(rclone_api_post).toHaveBeenCalledWith(
        '/operations/mkdir',
        expect.any(Object)
      )
    })

    it('should call refresh callback after creation', async () => {
      const { rclone_api_post } = await import('../../../utils/rclone/request')
      vi.mocked(rclone_api_post).mockResolvedValueOnce(undefined)
      const refreshCallback = vi.fn()

      await mkDir('storage1', '/new-folder', refreshCallback)

      expect(refreshCallback).toHaveBeenCalled()
    })
  })

  describe('refreshVfsCache', () => {
    beforeEach(async () => {
      const { convertStoragePath } = await import('../StorageManager')
      vi.mocked(convertStoragePath).mockImplementation((name, path) => `${name}:${path || ''}`)
    })

    it('已挂载时带上 fs 参数刷新', async () => {
      const { rclone_api_post } = await import('../../../utils/rclone/request')
      const { rcloneInfo } = await import('../../rclone')
      rcloneInfo.mountList = [{ storageName: 's1:', mountPath: '/mnt/s1', mountedTime: new Date() }]

      await refreshVfsCache('s1', '/dir')

      expect(rclone_api_post).toHaveBeenCalledWith(
        '/vfs/refresh',
        { fs: 's1:', dir: '/dir', recursive: false },
        true
      )
    })

    it('根目录用空字符串', async () => {
      const { rclone_api_post } = await import('../../../utils/rclone/request')
      const { rcloneInfo } = await import('../../rclone')
      rcloneInfo.mountList = [{ storageName: 's1:', mountPath: '/mnt/s1', mountedTime: new Date() }]

      await refreshVfsCache('s1', '/')

      expect(vi.mocked(rclone_api_post).mock.calls[0]![1]).toMatchObject({ dir: '' })
    })

    it('未挂载时不发起刷新', async () => {
      const { rclone_api_post } = await import('../../../utils/rclone/request')
      const { rcloneInfo } = await import('../../rclone')
      rcloneInfo.mountList = []

      await refreshVfsCache('s1', '/dir')

      expect(rclone_api_post).not.toHaveBeenCalled()
    })
  })

  describe('uploadFileRequest', () => {
    it('对 fs 与 remote 查询参数进行编码', async () => {
      const { convertStoragePath } = await import('../StorageManager')
      const { rcloneInfo } = await import('../../rclone')
      const { getRcloneApiHeaders } = await import('../../../utils/rclone/request')
      vi.mocked(getRcloneApiHeaders).mockReturnValue({ Authorization: 'Bearer test' } as never)
      vi.mocked(convertStoragePath).mockImplementation((name, path) => `${name}:${path || ''}`)
      rcloneInfo.endpoint = { ...rcloneInfo.endpoint, url: 'http://localhost:5572' }

      const open = vi.fn()
      class FakeXhr {
        upload = {}
        open = open
        setRequestHeader = vi.fn()
        send = vi.fn()
      }
      vi.stubGlobal('XMLHttpRequest', FakeXhr)
      vi.stubGlobal('FormData', class { append() {} })

      uploadFileRequest(
        { file: new Blob(['x']), onProgress: vi.fn(), onError: vi.fn(), onSuccess: vi.fn() } as never,
        's1',
        'a&b #1/文件+.txt'
      )

      const url = open.mock.calls[0]![1] as string
      expect(url).toContain('fs=s1%3A')
      expect(url).toContain('remote=' + encodeURIComponent('s1:a&b #1/文件+.txt'))
      expect(url.split('?')[1]!.split('&')).toHaveLength(2)
      vi.unstubAllGlobals()
    })
  })
})
