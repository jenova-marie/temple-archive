/**
 * Crisis detection patterns
 *
 * These patterns are used for fast pre-flight crisis detection.
 * The goal is to detect potential crisis situations in <10ms.
 */

import type { CrisisPatternType, CrisisLevel } from '@siri/types'

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
 * Common dampener phrases used across patterns to reduce false positives
 */
const COMMON_DAMPENERS = {
  /** Past tense indicators - person is describing history, not current state */
  pastTense: ['used to', 'in the past', 'years ago', 'back when', 'before', 'previously', 'when i was'],
  /** Hypothetical indicators - person is asking questions, not stating intent */
  hypothetical: ['what if', 'wondering if', 'just curious', 'hypothetically', 'asking for'],
  /** Media references - person is describing fiction */
  media: ['in the movie', 'in the book', 'in the show', 'the character', 'in the game', 'on tv'],
  /** Helping others context - person is asking about someone else */
  helpingOthers: ['my friend', 'someone i know', 'helping them', 'a family member', 'my sister', 'my brother', 'my parent'],
  /** Negation - person explicitly denying the crisis indicator */
  negation: ['not', 'never', "won't", "wouldn't", "don't want to", 'no longer', 'stopped'],
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
    boostKeywords: [
      'tonight', 'today', 'now', 'soon', 'decided', 'goodbye', 'farewell', 'note', 'letter',
      'right now', 'at this moment', 'as we speak', 'final', 'last', 'goodbye forever',
    ],
    dampeners: [
      ...COMMON_DAMPENERS.negation,
      ...COMMON_DAMPENERS.pastTense,
      ...COMMON_DAMPENERS.hypothetical,
      ...COMMON_DAMPENERS.media,
      ...COMMON_DAMPENERS.helpingOthers,
    ],
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
    boostKeywords: ['blood', 'blade', 'razor', 'again', 'already', 'right now', 'tonight'],
    dampeners: [
      ...COMMON_DAMPENERS.pastTense,
      ...COMMON_DAMPENERS.hypothetical,
      ...COMMON_DAMPENERS.media,
      ...COMMON_DAMPENERS.helpingOthers,
      'stopped', 'recovered', 'clean for',
    ],
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
    boostKeywords: ['intentionally', 'on purpose', 'want to', 'enough', 'lethal', 'right now', 'tonight'],
    dampeners: [
      'accident', 'accidentally', 'mistake', 'prescribed',
      ...COMMON_DAMPENERS.pastTense,
      ...COMMON_DAMPENERS.hypothetical,
      ...COMMON_DAMPENERS.media,
      ...COMMON_DAMPENERS.helpingOthers,
      'survived', 'warning signs', 'symptoms of',
    ],
  },
  {
    type: 'violence_risk',
    baseLevel: 8,
    patterns: [
      /\b(hurt|kill|attack|harm)\s+(someone|them|him|her|people)\b/i,
      /\bviolent\s+(thoughts?|urges?|feelings?)\b/i,
      /\bwant\s+to\s+(fight|hit|punch)\b/i,
    ],
    boostKeywords: ['weapon', 'gun', 'knife', 'plan', 'target', 'right now', 'tonight'],
    dampeners: [
      'video game', 'movie', 'dream', 'nightmare',
      ...COMMON_DAMPENERS.pastTense,
      ...COMMON_DAMPENERS.hypothetical,
      ...COMMON_DAMPENERS.media,
      'fiction', 'story', 'novel', 'intrusive thoughts',
    ],
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
    boostKeywords: ['just', 'now', 'today', 'tonight', "can't stop", 'again', 'right now', 'as we speak'],
    dampeners: [
      'almost', 'nearly', 'urge', 'craving', 'tempted',
      ...COMMON_DAMPENERS.pastTense,
      ...COMMON_DAMPENERS.hypothetical,
      ...COMMON_DAMPENERS.helpingOthers,
      'worried about', 'scared of', 'fear of',
    ],
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
    boostKeywords: ['now', 'today', 'tonight', 'already', 'on my way', 'right now'],
    dampeners: [
      'thinking about', 'wondering', 'curious',
      ...COMMON_DAMPENERS.pastTense,
      ...COMMON_DAMPENERS.hypothetical,
      ...COMMON_DAMPENERS.helpingOthers,
      'afraid i might', 'worried i might',
    ],
  },
  {
    type: 'withdrawal_symptoms',
    baseLevel: 7,
    patterns: [
      /\b(shaking|trembling|sweating|vomiting)\s+(badly|uncontrollably|so much)?\b/i,
      /\bcan'?t\s+stop\s+(shaking|sweating|trembling)\b/i,
      /\bwithdrawal\s+(symptoms?|is killing|is bad|is terrible)\b/i,
      /\bdetox(ing)?\s+(at home|alone|by myself)\b/i,
      /\bseizures?\s+from\s+(stopping|quitting|withdrawal)\b/i,
    ],
    boostKeywords: ['bad', 'severe', 'hospital', 'scared', 'dying', 'alone', 'help', 'dangerous'],
    dampeners: [
      'cold', 'flu', 'nervous', 'presentation', 'interview', 'anxious about',
      ...COMMON_DAMPENERS.pastTense,
      ...COMMON_DAMPENERS.hypothetical,
      ...COMMON_DAMPENERS.helpingOthers,
      'medical supervision', 'doctor', 'treatment center',
    ],
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
    boostKeywords: ['help', 'emergency', 'desperate', 'scared', 'terrified', 'right now'],
    dampeners: [
      'a little', 'sometimes', 'occasionally',
      ...COMMON_DAMPENERS.pastTense,
      ...COMMON_DAMPENERS.hypothetical,
      ...COMMON_DAMPENERS.media,
      'midlife crisis', 'quarter-life crisis', 'identity crisis',
    ],
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
    boostKeywords: ['always', 'never', 'anymore', 'done', 'completely'],
    dampeners: [
      'sometimes feel', 'occasionally think',
      ...COMMON_DAMPENERS.pastTense,
      ...COMMON_DAMPENERS.hypothetical,
      ...COMMON_DAMPENERS.media,
      ...COMMON_DAMPENERS.helpingOthers,
      'momentarily', 'briefly',
    ],
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
    dampeners: [
      'feel like', 'sometimes',
      ...COMMON_DAMPENERS.pastTense,
      ...COMMON_DAMPENERS.hypothetical,
      ...COMMON_DAMPENERS.media,
      'during covid', 'pandemic', 'lockdown',
    ],
  },
  {
    type: 'medication_noncompliance',
    baseLevel: 5,
    patterns: [
      /\bstopped\s+taking\s+(my\s+)?(meds?|medications?|pills?|prescriptions?)\b/i,
      /\bflushed\s+(my\s+)?(meds?|medications?|pills?)\b/i,
      /\boff\s+(my\s+)?(meds?|medications?)\b/i,
      /\bdon'?t\s+need\s+(my\s+)?(meds?|medications?)\b/i,
      /\bskipping\s+(my\s+)?(doses?|meds?|medications?)\b/i,
    ],
    boostKeywords: ['bipolar', 'schizophrenia', 'antipsychotic', 'mood stabilizer', 'suboxone', 'methadone'],
    dampeners: [
      'doctor told me', 'with my doctor', 'tapering', 'weaning off',
      ...COMMON_DAMPENERS.pastTense,
      ...COMMON_DAMPENERS.hypothetical,
      ...COMMON_DAMPENERS.helpingOthers,
      'side effects', 'switching to',
    ],
  },
  {
    type: 'financial_crisis',
    baseLevel: 4,
    patterns: [
      /\b(need|desperate for)\s+money\s+(for|to buy)\s+(drugs?|pills?|score)\b/i,
      /\b(stealing|pawning|selling)\s+.+\s+(to|for)\s+(use|get high|score|drugs?)\b/i,
      /\b(lost|losing)\s+(my\s+)?(job|house|apartment).+(using|drinking|addiction)\b/i,
      /\bevicted.+(relapse|using|drinking)\b/i,
    ],
    boostKeywords: ['homeless', 'evicted', 'desperate', 'nowhere to go', 'on the street'],
    dampeners: [
      ...COMMON_DAMPENERS.pastTense,
      ...COMMON_DAMPENERS.hypothetical,
      ...COMMON_DAMPENERS.media,
      ...COMMON_DAMPENERS.helpingOthers,
      'documentary', 'news story', 'article about',
    ],
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
