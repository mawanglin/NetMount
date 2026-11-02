import type { MountListItem } from '../../type/config'
import type { MountList } from '../../type/rclone/rcloneInfo'
import { normalizeMountPath } from './mountHelpers'

export interface MountRow {
  storageName: string
  mountPath: string
  /** rclone 中是否正在挂载 */
  mounted: boolean
  /** NetMount 配置中是否存在（false 表示在 NetMount 之外挂载的） */
  hasConfig: boolean
}

/**
 * 比较两个挂载路径是否指向同一位置
 * 兼容 Windows 盘符 `X:` / `X:\` / `x:/` 与路径末尾斜杠的差异
 */
export function isSameMountPath(a: string, b: string): boolean {
  const key = (p: string) => {
    let n = normalizeMountPath(p)
    if (/^[A-Za-z]:\/?$/.test(n)) return n.slice(0, 2).toLowerCase()
    if (/^[A-Za-z]:\//.test(n)) n = n[0]!.toLowerCase() + n.slice(1)
    return n
  }
  return key(a) === key(b)
}

/**
 * 以配置为基础，合并 rclone 实时挂载状态，供挂载页展示
 * 未挂载的配置也会出现；仅存在于 rclone 的挂载点标记为 hasConfig=false
 */
export function buildMountRows(configs: MountListItem[], live: MountList[]): MountRow[] {
  const rows: MountRow[] = configs.map(cfg => ({
    storageName: cfg.storageName,
    mountPath: cfg.mountPath,
    mounted: live.some(item => isSameMountPath(item.mountPath, cfg.mountPath)),
    hasConfig: true,
  }))

  for (const item of live) {
    if (!configs.some(cfg => isSameMountPath(cfg.mountPath, item.mountPath))) {
      rows.push({
        storageName: item.storageName,
        mountPath: item.mountPath,
        mounted: true,
        hasConfig: false,
      })
    }
  }
  return rows
}

/**
 * 启动时需要自动挂载的配置：autoMount 开启且当前尚未挂载
 */
export function pickAutoMountTargets(configs: MountListItem[], live: MountList[]): MountListItem[] {
  return configs.filter(
    cfg => cfg.autoMount && !live.some(item => isSameMountPath(item.mountPath, cfg.mountPath))
  )
}
