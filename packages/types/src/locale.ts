/**
 * Locale data for user preferences
 * Used to format dates, temperatures, distances, etc. based on user's region
 */

/**
 * Temperature unit preference
 */
export type TemperatureUnit = 'celsius' | 'fahrenheit'

/**
 * Distance unit preference
 */
export type DistanceUnit = 'miles' | 'kilometers'

/**
 * Weight unit preference
 */
export type WeightUnit = 'pounds' | 'kilograms'

/**
 * Volume unit preference
 */
export type VolumeUnit = 'gallons' | 'liters'

/**
 * Speed unit preference
 */
export type SpeedUnit = 'mph' | 'kmh'

/**
 * Time format preference
 */
export type TimeFormat = '12h' | '24h'

/**
 * Week start day preference
 */
export type WeekStart = 'sunday' | 'monday'

/**
 * Locale data defining regional preferences for formatting
 */
export interface LocaleData {
  /** Country name */
  name: string
  /** Temperature unit (fahrenheit or celsius) */
  temperatureUnit: TemperatureUnit
  /** Date format pattern (e.g., "MM/DD/YYYY", "DD.MM.YYYY") */
  dateFormat: string
  /** Time format (12h or 24h) */
  timeFormat: TimeFormat
  /** Currency code (e.g., "USD", "EUR") */
  currency: string
  /** Distance unit (miles or kilometers) */
  distanceUnit: DistanceUnit
  /** Weight unit (pounds or kilograms) */
  weightUnit: WeightUnit
  /** Volume unit (gallons or liters) */
  volumeUnit: VolumeUnit
  /** Speed unit (mph or kmh) */
  speedUnit: SpeedUnit
  /** First day of week (sunday or monday) */
  weekStart: WeekStart
  /** Decimal separator (. or ,) */
  decimalSeparator: string
  /** Thousands separator (,, ., or space) */
  thousandsSeparator: string
  /** Language code (e.g., "en", "es", "de") */
  language: string
}

/**
 * Locale data keyed by ISO 3166-1 alpha-2 country code
 */
export type LocaleDataMap = Record<string, LocaleData>
