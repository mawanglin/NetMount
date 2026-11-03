import { rclone_api_post } from '../../utils/rclone/request'
import { FileInfo } from '../../type/rclone/rcloneInfo'
import { RequestOptions } from '@arco-design/web-react/es/Upload'
import { getRcloneApiHeaders } from '../../utils/rclone/request'
import { rcloneInfo } from '../../services/rclone'
import { searchStorage, convertStoragePath, formatPathRclone } from './StorageManager'
import { isRcloneFileItem } from '../../utils/validators/rcloneValidators'
import { logger } from '../../services/LoggerService'

/**
 * Refresh VFS directory cache for a specific path
 * This forces rclone to re-read the directory from the remote
 * @param storageName - Storage name
 * @param path - Directory path to refresh
 */
async function refreshVfsCache(storageName: string, path: string): Promise<void> {
  try {
    // rclone 返回的挂载列表里 storageName 是 fs 字符串（如 "name:"），需用同样的格式比较
    const fs = convertStoragePath(storageName, undefined, undefined, undefined, true)
    const mountItem = rcloneInfo.mountList.find(m => m.storageName === fs)

    if (!mountItem) {
      // 没有挂载就没有 VFS 缓存可刷新
      logger.debug('Storage is not mounted, skip VFS refresh', 'FileManager', { storageName, path })
      return
    }

    // 必须指定 fs：存在多个 VFS（多个挂载）时，rclone 不带 fs 的 /vfs/refresh 会报错
    // dir 是相对于该 fs 根目录的路径，空字符串表示根目录
    await rclone_api_post('/vfs/refresh', {
      fs,
      dir: path === '/' ? '' : path,
      recursive: false,
    }, true) // ignoreError = true, 刷新失败不影响列表加载
    logger.debug('VFS cache refreshed', 'FileManager', { storageName, path })
  } catch {
    // 忽略错误，VFS 刷新失败不影响主流程
  }
}

/**
 * Get file list from a storage
 * @param storageName - Storage name
 * @param path - Directory path to list
 * @param forceRefresh - If true, clear VFS cache before listing
 * @returns Array of file info or undefined
 */
async function getFileList(storageName: string, path: string, forceRefresh?: boolean): Promise<FileInfo[] | undefined> {
  const storage = searchStorage(storageName)
  let fileList: FileInfo[] | undefined = undefined

  // 如果强制刷新，先清除 VFS 目录缓存
  if (forceRefresh) {
    await refreshVfsCache(storageName, path)
  }

  // 移除路径末尾的斜杠，根目录直接传空字符串
  const backData = await rclone_api_post('/operations/list', {
    fs: convertStoragePath(storageName, undefined, undefined, undefined, true),
    remote: convertStoragePath(storageName, path, false, true),
  })
  
  // Validate response structure
  if (typeof backData !== 'object' || backData === null) {
    logger.warn('Invalid response from rclone list operation', 'FileManager', { 
      backData,
      storageName,
      path,
      apiEndpoint: '/operations/list'
    })
    return undefined
  }
  
  const backDataTyped = backData as { list?: unknown[] }
  
  if (backDataTyped.list && Array.isArray(backDataTyped.list)) {
    fileList = []
    for (const file of backDataTyped.list) {
      let filePath: string

      if (storage?.framework === 'rclone') {
        // Use type guard to safely access Path property
        const fileRecord = file as Record<string, unknown>
        const rawPath = typeof fileRecord.Path === 'string' ? fileRecord.Path : ''
        filePath = formatPathRclone(rawPath)
      } else {
        // OpenList 存储：从 file.Path 中提取相对路径
        // file.Path 格式可能是：百度网盘/视频/test.mp4 或 /百度网盘/视频/test.mp4
        // 需要去掉存储名前缀，得到：视频/test.mp4
        const fileRecord = file as Record<string, unknown>
        const rawPath = typeof fileRecord.Path === 'string' ? fileRecord.Path : ''
        const prefix = storageName + '/'

        if (rawPath.startsWith('/' + prefix)) {
          // 格式：/百度网盘/视频/test.mp4
          filePath = rawPath.substring(prefix.length + 1)
        } else if (rawPath.startsWith(prefix)) {
          // 格式：百度网盘/视频/test.mp4
          filePath = rawPath.substring(prefix.length)
        } else {
          // 兜底：直接使用原路径
          filePath = rawPath
        }
      }

      // Use type guard to validate file item structure
      if (!isRcloneFileItem(file)) {
        logger.warn('Skipping invalid file item in rclone response', 'FileManager', { file })
        continue
      }
      
      fileList.push({
        path: filePath,
        name: file.Name,
        size: file.Size,
        mimeType: file.MimeType,
        modTime: new Date(file.ModTime),
        isDir: file.IsDir,
      })
    }
  }

  return fileList
}

/**
 * Refresh callback type for file operations
 */
type RefreshCallback = () => void

/**
 * Delete a file from storage
 * @param storageName - Storage name
 * @param path - File path to delete
 * @param refreshCallback - Optional callback to refresh UI after deletion
 */
async function delFile(storageName: string, path: string, refreshCallback?: RefreshCallback) {
  if (path.substring(0, 1) == '/') {
    path = path.substring(1, path.length)
  }
  await rclone_api_post('/operations/deletefile', {
    fs: convertStoragePath(storageName, undefined, undefined, undefined, true),
    remote: convertStoragePath(storageName, path, false, true),
  })

  // 删除后刷新 VFS 缓存，确保列表更新
  const parentPath = path.includes('/') ? path.substring(0, path.lastIndexOf('/')) : '/'
  await refreshVfsCache(storageName, parentPath)

  if (refreshCallback) {
    refreshCallback()
  }
}

/**
 * Delete a directory from storage
 * @param storageName - Storage name
 * @param path - Directory path to delete
 * @param refreshCallback - Optional callback to refresh UI after deletion
 */
async function delDir(storageName: string, path: string, refreshCallback?: RefreshCallback) {
  await rclone_api_post('/operations/purge', {
    fs: convertStoragePath(storageName, undefined, undefined, undefined, true),
    remote: convertStoragePath(storageName, path, true, true),
  })

  // 删除后刷新 VFS 缓存，确保列表更新
  const parentPath = path.includes('/') ? path.substring(0, path.lastIndexOf('/')) : '/'
  await refreshVfsCache(storageName, parentPath)

  if (refreshCallback) {
    refreshCallback()
  }
}

/**
 * Create a directory in storage
 * @param storageName - Storage name
 * @param path - Directory path to create
 * @param refreshCallback - Optional callback to refresh UI after creation
 */
async function mkDir(storageName: string, path: string, refreshCallback?: RefreshCallback) {
  await rclone_api_post('/operations/mkdir', {
    fs: convertStoragePath(storageName, undefined, undefined, undefined, true),
    remote: convertStoragePath(storageName, path, true, true),
  })

  // 创建目录后刷新 VFS 缓存，确保列表更新
  const parentPath = path.includes('/') ? path.substring(0, path.lastIndexOf('/')) : '/'
  await refreshVfsCache(storageName, parentPath)

  if (refreshCallback) {
    refreshCallback()
  }
}

/**
 * Upload a file to storage
 * @param option - Upload options including file, progress, error, and success callbacks
 * @param storageName - Storage name
 * @param path - Destination path
 */
const uploadFileRequest = (option: RequestOptions, storageName: string, path: string) => {
  const { onProgress, onError, onSuccess, file } = option

  const formData = new FormData()
  formData.append('file', file)

  const xhr = new XMLHttpRequest()

  xhr.upload.onprogress = ({ lengthComputable, loaded, total }) => {
    if (lengthComputable) {
      const progress = Math.round((loaded / total) * 100)
      logger.debug(`Upload progress: ${progress}%`, 'FileManager', { loaded, total, progress })
      onProgress(progress)
    }
  }

  xhr.onload = async () => {
    if (xhr.status === 200) {
      // 上传成功后刷新 VFS 缓存，避免重复上传
      try {
        const parentPath = path.includes('/') ? path.substring(0, path.lastIndexOf('/')) : '/'
        await refreshVfsCache(storageName, parentPath)
        logger.debug('VFS cache refreshed after upload', 'FileManager', { storageName, path })
      } catch (e) {
        // 刷新失败不影响上传成功回调
        logger.warn('Failed to refresh VFS cache after upload', 'FileManager', { error: e })
      }
      onSuccess()
    } else {
      onError(xhr)
    }
  }

  xhr.onerror = () => onError(xhr)

  // 查询参数必须编码：文件名中的 & # % + 等字符否则会截断或篡改 remote
  const fsParam = encodeURIComponent(convertStoragePath(storageName, undefined, undefined, undefined, true))
  const remoteParam = encodeURIComponent(convertStoragePath(storageName, path, true, true, undefined))
  xhr.open(
    'POST',
    `${rcloneInfo.endpoint.url}/operations/uploadfile?fs=${fsParam}&remote=${remoteParam}`,
    true
  )
  xhr.setRequestHeader('Authorization', getRcloneApiHeaders().Authorization)
  xhr.send(formData)
}

export {
  getFileList,
  refreshVfsCache,
  delFile,
  delDir,
  mkDir,
  uploadFileRequest,
  type RefreshCallback,
}
