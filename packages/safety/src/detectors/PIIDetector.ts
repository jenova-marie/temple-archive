/**
 * PII Detector - Regex-based detection and redaction of personally identifiable information
 *
 * Detects:
 * - SSN (Social Security Numbers)
 * - Phone numbers (various formats)
 * - Email addresses
 * - Credit card numbers (with Luhn validation)
 * - Bank account/routing numbers
 * - Medical identifiers (NPI, DEA, MRN)
 * - Physical addresses
 */

import { getLogger, withSpan, pipelineMetrics } from '@siri/observability'
import type { TraceContext, SafetyViolation } from '@siri/types'

export type PIIType =
  | 'ssn'
  | 'phone'
  | 'email'
  | 'credit_card'
  | 'bank_account'
  | 'routing_number'
  | 'npi'
  | 'dea'
  | 'mrn'
  | 'address'

export interface PIIMatch {
  type: PIIType
  value: string
  position: { start: number; end: number }
  confidence: number
  redactionText: string
}

interface PIIPattern {
  type: PIIType
  pattern: RegExp
  severity: 'low' | 'medium' | 'high' | 'critical'
  redactionText: string
  validate?: (match: string, fullText: string) => boolean
  confidenceBoost?: number
}

/**
 * Luhn algorithm for credit card validation
 */
function isValidLuhn(digits: string): boolean {
  const nums = digits.replace(/\D/g, '').split('').map(Number).reverse()
  if (nums.length < 13 || nums.length > 19) return false

  const sum = nums.reduce((acc, digit, i) => {
    if (i % 2 === 1) {
      digit *= 2
      if (digit > 9) digit -= 9
    }
    return acc + digit
  }, 0)
  return sum % 10 === 0
}

/**
 * Check if a 9-digit number looks like a routing number (has valid checksum)
 */
function isValidRoutingNumber(digits: string): boolean {
  const nums = digits.replace(/\D/g, '')
  if (nums.length !== 9) return false

  // ABA routing number checksum: 3(d1 + d4 + d7) + 7(d2 + d5 + d8) + (d3 + d6 + d9) mod 10 = 0
  const d = nums.split('').map(Number)
  const checksum = (3 * (d[0] + d[3] + d[6]) + 7 * (d[1] + d[4] + d[7]) + (d[2] + d[5] + d[8])) % 10
  return checksum === 0
}

/**
 * Check if NPI has valid check digit (Luhn on prefix + number)
 */
function isValidNPI(npi: string): boolean {
  // NPI uses Luhn on "80840" prefix + 9 digits + check digit
  const prefixed = '80840' + npi
  return isValidLuhn(prefixed)
}

const PII_PATTERNS: PIIPattern[] = [
  // SSN: xxx-xx-xxxx or xxx xx xxxx or xxxxxxxxx
  {
    type: 'ssn',
    pattern: /\b\d{3}[-\s]?\d{2}[-\s]?\d{4}\b/g,
    severity: 'critical',
    redactionText: '[SSN REDACTED]',
    validate: (match) => {
      const digits = match.replace(/\D/g, '')
      // SSN cannot start with 000, 666, or 900-999
      const area = parseInt(digits.slice(0, 3))
      if (area === 0 || area === 666 || area >= 900) return false
      // Group cannot be 00
      const group = parseInt(digits.slice(3, 5))
      if (group === 0) return false
      // Serial cannot be 0000
      const serial = parseInt(digits.slice(5))
      if (serial === 0) return false
      return true
    },
    confidenceBoost: 0.2,
  },

  // Phone: various formats including international
  {
    type: 'phone',
    pattern: /\b(?:\+1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)?\d{3}[-.\s]?\d{4}\b/g,
    severity: 'high',
    redactionText: '[PHONE REDACTED]',
    validate: (match) => {
      const digits = match.replace(/\D/g, '')
      // Must have 10 or 11 digits (with country code)
      return digits.length >= 10 && digits.length <= 11
    },
  },

  // Email
  {
    type: 'email',
    pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
    severity: 'high',
    redactionText: '[EMAIL REDACTED]',
    confidenceBoost: 0.3, // Very high confidence for emails
  },

  // Credit Card: 13-19 digits with optional separators
  {
    type: 'credit_card',
    pattern: /\b(?:\d{4}[-\s]?){3,4}\d{1,4}\b/g,
    severity: 'critical',
    redactionText: '[CARD REDACTED]',
    validate: (match) => isValidLuhn(match),
    confidenceBoost: 0.3,
  },

  // Bank Account with context keywords
  {
    type: 'bank_account',
    pattern: /\b(?:account|acct|checking|savings)[\s#:]*\d{8,17}\b/gi,
    severity: 'critical',
    redactionText: '[ACCOUNT REDACTED]',
    confidenceBoost: 0.2,
  },

  // Routing Number (9 digits with valid checksum)
  {
    type: 'routing_number',
    pattern: /\b(?:routing|aba|rtn)[\s#:]*\d{9}\b/gi,
    severity: 'critical',
    redactionText: '[ROUTING REDACTED]',
    validate: (match) => {
      const digits = match.match(/\d{9}/)
      return digits ? isValidRoutingNumber(digits[0]) : false
    },
    confidenceBoost: 0.2,
  },

  // NPI (National Provider Identifier): 10 digits starting with 1 or 2
  {
    type: 'npi',
    pattern: /\b(?:npi|provider)[\s#:]*[12]\d{9}\b/gi,
    severity: 'high',
    redactionText: '[NPI REDACTED]',
    validate: (match) => {
      const digits = match.match(/[12]\d{9}/)
      return digits ? isValidNPI(digits[0]) : false
    },
  },

  // DEA Number: 2 letters + 7 digits (with specific format)
  {
    type: 'dea',
    pattern: /\b(?:dea)[\s#:]*[A-Za-z]{2}\d{7}\b/gi,
    severity: 'high',
    redactionText: '[DEA REDACTED]',
    validate: (match) => {
      // DEA format: first letter is registrant type, second is first letter of last name
      // Check digit formula exists but is complex
      const deaMatch = match.match(/[A-Za-z]{2}\d{7}/)
      if (!deaMatch) return false
      const code = deaMatch[0].toUpperCase()
      // Valid registrant types: A, B, C, D, E, F, G, H, J, K, L, M, P, R, S, T, U, X
      const validTypes = 'ABCDEFGHJKLMPRSTUX'
      return validTypes.includes(code[0])
    },
  },

  // Medical Record Number with context
  {
    type: 'mrn',
    pattern: /\b(?:mrn|medical\s*record|patient\s*id)[\s#:]*[A-Za-z0-9]{6,15}\b/gi,
    severity: 'high',
    redactionText: '[MRN REDACTED]',
  },

  // Street Address: number + street name + street type
  {
    type: 'address',
    pattern: /\b\d+\s+[\w\s]{2,30}\s+(?:street|st|avenue|ave|road|rd|drive|dr|lane|ln|way|court|ct|boulevard|blvd|place|pl|circle|cir|terrace|ter)\b/gi,
    severity: 'medium',
    redactionText: '[ADDRESS REDACTED]',
    validate: (match) => {
      // Must have a reasonable structure (number + at least 2 words + type)
      const parts = match.trim().split(/\s+/)
      return parts.length >= 3 && /^\d+$/.test(parts[0])
    },
  },
]

export class PIIDetector {
  /**
   * Detect all PII in the given text
   */
  detect(text: string, _ctx?: TraceContext): PIIMatch[] {
    const matches: PIIMatch[] = []

    for (const piiPattern of PII_PATTERNS) {
      // Reset regex state for global patterns
      piiPattern.pattern.lastIndex = 0

      let match: RegExpExecArray | null
      while ((match = piiPattern.pattern.exec(text)) !== null) {
        const value = match[0]
        const position = { start: match.index, end: match.index + value.length }

        // Run validation if provided
        if (piiPattern.validate && !piiPattern.validate(value, text)) {
          continue
        }

        // Calculate confidence based on validation and pattern specificity
        let confidence = 0.7 // Base confidence
        if (piiPattern.validate) {
          confidence += 0.15 // Validation passed
        }
        if (piiPattern.confidenceBoost) {
          confidence += piiPattern.confidenceBoost
        }
        confidence = Math.min(confidence, 1.0)

        matches.push({
          type: piiPattern.type,
          value,
          position,
          confidence,
          redactionText: piiPattern.redactionText,
        })
      }
    }

    // Sort by position and remove overlapping matches (keep higher confidence)
    return this.deduplicateMatches(matches)
  }

  /**
   * Remove overlapping matches, keeping the one with higher confidence
   */
  private deduplicateMatches(matches: PIIMatch[]): PIIMatch[] {
    if (matches.length <= 1) return matches

    // Sort by start position
    const sorted = [...matches].sort((a, b) => a.position.start - b.position.start)

    const result: PIIMatch[] = []
    for (const match of sorted) {
      const last = result[result.length - 1]
      if (!last || match.position.start >= last.position.end) {
        // No overlap
        result.push(match)
      } else if (match.confidence > last.confidence) {
        // Overlapping, but new match has higher confidence
        result[result.length - 1] = match
      }
      // Otherwise, keep the existing match
    }

    return result
  }

  /**
   * Redact PII from text, returning the sanitized version
   */
  redact(text: string, matches: PIIMatch[]): string {
    if (matches.length === 0) return text

    // Sort by position descending to replace from end to start
    const sorted = [...matches].sort((a, b) => b.position.start - a.position.start)

    let result = text
    for (const match of sorted) {
      result =
        result.slice(0, match.position.start) +
        match.redactionText +
        result.slice(match.position.end)
    }

    return result
  }

  /**
   * Detect PII and return as SafetyViolation array
   */
  async detectViolations(
    text: string,
    ctx: TraceContext
  ): Promise<SafetyViolation[]> {
    return withSpan('PIIDetector.detectViolations', async () => {
      const logger = getLogger().child({ requestId: ctx.requestId })
      const matches = this.detect(text, ctx)

      // Record metrics
      for (const match of matches) {
        pipelineMetrics.safetyViolations.add(1, { type: `pii_${match.type}` })
      }

      if (matches.length > 0) {
        logger.warn(
          {
            piiTypes: matches.map((m) => m.type),
            count: matches.length,
          },
          'PII detected in output'
        )
      }

      // Convert to SafetyViolation format
      return matches.map((match) => {
        const severity = PII_PATTERNS.find((p) => p.type === match.type)?.severity ?? 'high'
        return {
          type: 'pii' as const,
          severity,
          description: `${match.type.toUpperCase()} detected: "${match.value.slice(0, 4)}..."`,
          position: match.position,
        }
      })
    })
  }
}
