import { compareVersions } from '../../utils'
import { ResItem } from '../../type/controller/update'
import { nmConfig, osInfo } from '../../services/ConfigService'
import { getVersion } from '@tauri-apps/api/app'
import { logger } from '../../services/LoggerService'
import { fetchWithTimeout } from '../../utils/fetchWithTimeout'

async function checkUpdate(updateCall: (resList: ResItem, localVersions: string) => void) {
  const localVersions = await getVersion()
  try {
    const resList: ResItem = (
      await (
        await fetchWithTimeout(
          nmConfig.api.url + '/GetUpdate/?arch=' + osInfo.arch + '&osType=' + osInfo.osType
        )
      ).json()
    ).data
    if (resList.id && compareVersions(resList.id, localVersions) === 1) {
      updateCall(resList, localVersions)
    }
  } catch {
    logger.error('checkUpdate error', undefined, 'Update')
  }
}

export { checkUpdate }
