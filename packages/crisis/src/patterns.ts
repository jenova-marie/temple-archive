/**
 * Crisis detection patterns
 *
 * These patterns are used for fast pre-flight crisis detection.
 * The goal is to detect potential crisis situations in <10ms.
 */

import type { CrisisPatternType, CrisisLevel } from '@recoverysky/types'

export interface CrisisPattern {
  /** Pattern type */
  type: CrisisPatternType
  /** Base crisis level if matched */
  baseLevel: CrisisLevel
  /** Regex patterns to match */
  patterns: RegExp[]
  /** Keywords that boost confidence */
  boostKeywords: string[]
  /** Phrases that reduce confidence (false positive reducers) */
  dampeners: string[]
}

/**
 * Crisis detection patterns organized by severity
 */
export const CRISIS_PATTERNS: CrisisPattern[] = [
  // CRITICAL (Level 9-10): Immediate danger
  {
    type: 'suicidal_ideation',
    baseLevel: 9,
    patterns: [
      /\b(want|going|plan|planning|thinking about|considering)\s+(to\s+)?(kill|end|take)\s+(myself|my life|my own life)\b/i,
      /\b(suicide|suicidal)\b/i,
      /\bi\s+(want|need|wish)\s+to\s+die\b/i,
      /\b(end|ending)\s+(it\s+)?all\b/i,
      /\bno\s+(point|reason)\s+(in\s+)?living\b/i,
      /\b(better|easier)\s+(off\s+)?dead\b/i,
      /\beveryone\s+(would be|will be)\s+better\s+off\s+without\s+me\b/i,
    ],
    boostKeywords: ['tonight', 'today', 'now', 'soon', 'decided', 'goodbye', 'farewell', 'note', 'letter'],
    dampeners: ['not', 'never', 'won\'t', 'wouldn\'t', 'don\'t want to'],
  },
  {
    type: 'self_harm',
    baseLevel: 8,
    patterns: [
      /\b(cut|cutting|harm|hurting|hurt)\s+(myself|me)\b/i,
      /\bself[- ]harm\b/i,
      /\b(burn|burning)\s+(myself|my skin|my arm)\b/i,
      /\b(hitting|punching|scratching)\s+myself\b/i,
    ],
    boostKeywords: ['blood', 'blade', 'razor', 'again', 'already'],
    dampeners: ['used to', 'in the past', 'years ago', 'stopped'],
  },
  {
    type: 'overdose_risk',
    baseLevel: 9,
    patterns: [
      /\b(take|took|taking)\s+(too\s+many|a lot of|all)\s+(pills|medications?|drugs?)\b/i,
      /\boverdose\b/i,
      /\bOD'?(d|ing)?\b/i,
      /\bmixed\s+(drugs?|medications?|substances?)\b/i,
    ],
    boostKeywords: ['intentionally', 'on purpose', 'want to', 'enough', 'lethal'],
    dampeners: ['accident', 'accidentally', 'mistake', 'prescribed'],
  },
  {
    type: 'violence_risk',
    baseLevel: 8,
    patterns: [
      /\b(hurt|kill|attack|harm)\s+(someone|them|him|her|people)\b/i,
      /\bviolent\s+(thoughts?|urges?|feelings?)\b/i,
      /\bwant\s+to\s+(fight|hit|punch)\b/i,
    ],
    boostKeywords: ['weapon', 'gun', 'knife', 'plan', 'target'],
    dampeners: ['video game', 'movie', 'dream', 'nightmare'],
  },

  // HIGH (Level 7-8): Elevated risk
  {
    type: 'active_relapse',
    baseLevel: 8,
    patterns: [
      /\b(relapsed?|using|used|drinking|drank)\s+(again|today|tonight|just now)\b/i,
      /\b(fell|falling)\s+off\s+(the\s+)?wagon\b/i,
      /\bback\s+(to|on)\s+(using|drinking|drugs?)\b/i,
      /\bhigh\s+right\s+now\b/i,
      /\bdrunk\s+right\s+now\b/i,
    ],
    boostKeywords: ['just', 'now', 'today', 'tonight', 'can\'t stop', 'again'],
    dampeners: ['almost', 'nearly', 'urge', 'craving', 'tempted'],
  },
  {
    type: 'imminent_relapse',
    baseLevel: 7,
    patterns: [
      /\b(about to|going to|want to|need to)\s+(use|drink|get high|score)\b/i,
      /\b(buying|bought|getting)\s+(drugs?|alcohol|booze)\b/i,
      /\bcontacted\s+(my\s+)?(dealer|plug|connect)\b/i,
      /\bcan'?t\s+resist\s+(the\s+)?urge\b/i,
    ],
    boostKeywords: ['now', 'today', 'tonight', 'already', 'on my way'],
    dampeners: ['thinking about', 'wondering', 'curious'],
  },

  // ELEVATED (Level 4-6): Monitor closely
  {
    type: 'severe_distress',
    baseLevel: 6,
    patterns: [
      /\bcan'?t\s+(take|handle|cope|deal)\s+(with\s+)?(it|this|anymore)\b/i,
      /\b(overwhelmed|drowning|suffocating)\b/i,
      /\b(breaking|falling)\s+apart\b/i,
      /\bpanic\s+(attack|mode)\b/i,
      /\bcrisis\b/i,
    ],
    boostKeywords: ['help', 'emergency', 'desperate', 'scared', 'terrified'],
    dampeners: ['a little', 'sometimes', 'occasionally'],
  },
  {
    type: 'hopelessness',
    baseLevel: 5,
    patterns: [
      /\b(no|lost)\s+(hope|point|purpose|reason)\b/i,
      /\bnothing\s+(matters|helps|works)\b/i,
      /\bgive(n)?\s+up\b/i,
      /\bwhat'?s\s+the\s+point\b/i,
      /\bnever\s+(get|feel)\s+better\b/i,
    ],
    boostKeywords: ['always', 'never', 'anymore', 'done'],
    dampeners: ['sometimes feel', 'occasionally think'],
  },
  {
    type: 'isolation',
    baseLevel: 4,
    patterns: [
      /\b(completely|totally)\s+(alone|isolated)\b/i,
      /\bno\s+one\s+(cares|understands|listens)\b/i,
      /\bpushed?\s+everyone\s+away\b/i,
      /\bhave\s+no\s+(friends|family|support)\b/i,
    ],
    boostKeywords: ['completely', 'totally', 'absolutely', 'always'],
    dampeners: ['feel like', 'sometimes'],
  },
]

/**
 * Crisis resources to share when crisis is detected
 */
export const CRISIS_RESOURCES = {
  national: [
    {
      name: '988 Suicide & Crisis Lifeline',
      description: 'Free, confidential support for people in distress',
      contactMethod: 'phone' as const,
      contactValue: '988',
      available24x7: true,
    },
    {
      name: 'Crisis Text Line',
      description: 'Text HOME to 741741 for free crisis counseling',
      contactMethod: 'text' as const,
      contactValue: '741741',
      available24x7: true,
    },
    {
      name: 'SAMHSA National Helpline',
      description: 'Treatment referrals and information for substance use',
      contactMethod: 'phone' as const,
      contactValue: '1-800-662-4357',
      available24x7: true,
    },
  ],
  recovery: [
    {
      name: 'AA Hotline',
      description: 'Alcoholics Anonymous 24-hour hotline',
      contactMethod: 'phone' as const,
      contactValue: '1-800-839-1686',
      available24x7: true,
    },
    {
      name: 'NA Helpline',
      description: 'Narcotics Anonymous helpline',
      contactMethod: 'phone' as const,
      contactValue: '1-818-773-9999',
      available24x7: true,
    },
  ],
}
