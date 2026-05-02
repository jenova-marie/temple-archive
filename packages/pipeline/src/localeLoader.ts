/**
 * Locale Data Loader
 *
 * Loads and caches locale data from the JSON file.
 * Used to inject regional preferences into the system prompt.
 *
 * Uses CONTAINER_ROOT environment variable to determine the base path:
 *   - Default: /container (production/Docker)
 *   - Override: CONTAINER_ROOT=./opt pnpm dev (development)
 */

import { readFileSync, existsSync } from 'fs'
import type { LocaleData, LocaleDataMap } from '@siri/types'
import { getLogger } from '@siri/observability'
import { containerPath, ContainerPaths } from '@siri/shared/server'

/** Default locale code */
const DEFAULT_LOCALE_CODE = 'US'

/** Cached locale data */
let localeDataCache: LocaleDataMap | null = null

/**
 * Load locale data from the JSON file.
 * Caches the result for subsequent calls.
 */
function loadLocaleData(): LocaleDataMap {
  if (localeDataCache) {
    return localeDataCache
  }

  const logger = getLogger().child({ component: 'localeLoader' })

  // Use containerPath to resolve the locale data file
  const localePath = containerPath(ContainerPaths.LOCALE_DATA)

  if (!existsSync(localePath)) {
    logger.warn({ path: localePath }, 'Locale data file not found, using empty map')
    localeDataCache = {}
    return localeDataCache
  }

  try {
    const content = readFileSync(localePath, 'utf8')
    localeDataCache = JSON.parse(content) as LocaleDataMap
    logger.info(
      { path: localePath, localeCount: Object.keys(localeDataCache).length },
      'Locale data loaded'
    )
    return localeDataCache
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    logger.error({ error: errorMessage, path: localePath }, 'Failed to load locale data')
    localeDataCache = {}
    return localeDataCache
  }
}

/**
 * Get locale data for a specific country code.
 *
 * @param code - ISO 3166-1 alpha-2 country code (e.g., 'US', 'DE')
 * @returns LocaleData for the code, or US fallback if not found
 */
export function getLocale(code?: string): LocaleData | undefined {
  const data = loadLocaleData()
  const localeCode = code?.toUpperCase() || DEFAULT_LOCALE_CODE

  // Try requested locale, then fall back to US
  if (data[localeCode]) {
    return data[localeCode]
  }

  if (data[DEFAULT_LOCALE_CODE]) {
    return data[DEFAULT_LOCALE_CODE]
  }

  return undefined
}

/**
 * Get all available locale codes.
 */
export function getAvailableLocaleCodes(): string[] {
  const data = loadLocaleData()
  return Object.keys(data)
}

/**
 * Clear the locale cache (useful for testing or hot-reload).
 */
export function clearLocaleCache(): void {
  localeDataCache = null
}
