/**
 * TransferService 单元测试
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  copyDir,
  moveDir,
  sync,
} from '../TransferService'

// Mock 依赖模块
vi.mock('../../../utils/rclone/request', () => ({
  rclone_api_post: vi.fn(),
  rclone_api_exec_async: vi.fn(),
}))

vi.mock('../StorageManager', () => ({
  convertStoragePath: vi.fn((name, path) => path ? `${name}:${path}` : `${name}:`),
  formatPathRclone: vi.fn((path) => path?.replace(/^\//, '') || ''),
  getFileName: vi.fn((path) => path?.split('/').pop() || ''),
}))

describe('TransferService', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    // vitest 配置了 mockReset，factory 中的默认实现会被清除，这里重新设置
    const { convertStoragePath, formatPathRclone, getFileName } = await import('../StorageManager')
    vi.mocked(convertStoragePath).mockImplementation((name, path) => (path ? `${name}:${path}` : `${name}:`))
    vi.mocked(formatPathRclone).mockImplementation(path => path?.replace(/^\//, '') || '')
    vi.mocked(getFileName).mockImplementation(path => path?.split('/').pop() || '')
  })

  describe('copyDir', () => {
    it('should copy directory successfully', async () => {
      const { rclone_api_exec_async } = await import('../../../utils/rclone/request')
      vi.mocked(rclone_api_exec_async).mockResolvedValueOnce(true)

      await copyDir('src-storage', '/source-folder', 'dst-storage', '/dest-folder')

      expect(rclone_api_exec_async).toHaveBeenCalledWith('/sync/copy', expect.any(Object))
    })

    it('should throw error when storage name is empty', async () => {
      await expect(copyDir('', '/folder', 'dst', '/folder')).rejects.toThrow('Source or destination storage name is empty')
    })

    it('should throw error when path is empty', async () => {
      await expect(copyDir('src', '', 'dst', '/folder')).rejects.toThrow('Source path is empty')
    })

    it('should throw error when copy fails', async () => {
      const { rclone_api_exec_async } = await import('../../../utils/rclone/request')
      vi.mocked(rclone_api_exec_async).mockResolvedValueOnce(false)

      await expect(copyDir('src', '/folder', 'dst', '/folder')).rejects.toThrow('Copy directory failed')
    })
  })

  describe('moveDir', () => {
    it('should move directory successfully', async () => {
      const { rclone_api_exec_async } = await import('../../../utils/rclone/request')
      vi.mocked(rclone_api_exec_async).mockResolvedValueOnce(true)

      await moveDir('src-storage', '/source-folder', 'dst-storage', '/dest-folder')

      expect(rclone_api_exec_async).toHaveBeenCalledWith('/sync/move', expect.any(Object))
    })

    it('should support renaming during move', async () => {
      const { rclone_api_exec_async } = await import('../../../utils/rclone/request')
      vi.mocked(rclone_api_exec_async).mockResolvedValueOnce(true)

      await moveDir('src', '/folder', 'dst', '/dest', 'new-name')

      expect(rclone_api_exec_async).toHaveBeenCalled()
    })

    it('should throw error when move fails', async () => {
      const { rclone_api_exec_async } = await import('../../../utils/rclone/request')
      vi.mocked(rclone_api_exec_async).mockResolvedValueOnce(false)

      await expect(moveDir('src', '/folder', 'dst', '/folder')).rejects.toThrow('Move directory failed')
    })
  })

  describe('sync', () => {
    it('should perform one-way sync', async () => {
      const { rclone_api_exec_async } = await import('../../../utils/rclone/request')
      vi.mocked(rclone_api_exec_async).mockResolvedValueOnce(true)

      await sync('src', '/folder1', 'dst', '/folder2')

      expect(rclone_api_exec_async).toHaveBeenCalledWith('/sync/sync', expect.any(Object))
    })

    it('should perform bidirectional sync when bisync is true', async () => {
      const { rclone_api_exec_async } = await import('../../../utils/rclone/request')
      vi.mocked(rclone_api_exec_async).mockResolvedValueOnce(true)

      await sync('src', '/folder1', 'dst', '/folder2', true)

      expect(rclone_api_exec_async).toHaveBeenCalledWith('/sync/bisync', expect.any(Object))
    })

    it('should throw error when sync fails', async () => {
      const { rclone_api_exec_async } = await import('../../../utils/rclone/request')
      vi.mocked(rclone_api_exec_async).mockResolvedValueOnce(false)

      await expect(sync('src', '/folder1', 'dst', '/folder2')).rejects.toThrow('Sync failed')
    })

    it('should throw error for bidirectional sync failure', async () => {
      const { rclone_api_exec_async } = await import('../../../utils/rclone/request')
      vi.mocked(rclone_api_exec_async).mockResolvedValueOnce(false)

      await expect(sync('src', '/folder1', 'dst', '/folder2', true)).rejects.toThrow('双向同步失败')
    })
  })
})
