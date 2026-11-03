import { nmConfig } from '../../services/ConfigService'
import { Notice } from '../../type/controller/update'
import { logger } from '../../services/LoggerService'
import { fetchWithTimeout } from '../../utils/fetchWithTimeout'

async function checkNotice() {
  try {
    const notice: Notice = await (
      await fetchWithTimeout(
        nmConfig.api.url + '/GetNotice/?lang=' + encodeURIComponent(nmConfig.settings.language ?? '')
      )
    ).json()
    if (notice.state === 'success') {
      if (
        nmConfig.notice === undefined ||
        (nmConfig.notice && notice.data.content !== nmConfig.notice.data.content)
      ) {
        nmConfig.notice = notice
      }
    }
  } catch (e) {
    logger.error('Failed to check notice', e as Error, 'Notice')
  }
}

export { checkNotice }
