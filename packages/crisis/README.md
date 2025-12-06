# @recoverysky/crisis

Real-time crisis detection for the RecoverySky Agent system.

## Installation

```bash
pnpm add @recoverysky/crisis
```

## Overview

This package provides fast pre-flight crisis detection using keyword and pattern matching. It's designed to identify potential crisis situations in **<10ms** to enable immediate response.

## Quick Start

```typescript
import { KeywordCrisisDetector, CRISIS_PATTERNS, CRISIS_RESOURCES } from '@recoverysky/crisis'

const detector = new KeywordCrisisDetector({
  emergencyThreshold: 9,
  resourceThreshold: 7,
})

const result = await detector.detect(
  "I don't want to live anymore",
  traceContext,
)

if (result.ok) {
  console.log('Crisis Level:', result.value.level) // 9
  console.log('Emergency:', result.value.triggerEmergency) // true
  console.log('Action:', result.value.action) // 'emergency_protocol'
}
```

## Crisis Levels

| Level | Severity | Action | Examples |
|-------|----------|--------|----------|
| 1-3 | Normal | None | Routine conversation |
| 4-6 | Elevated | Monitor | Hopelessness, isolation |
| 7-8 | High | Inject Resources | Active relapse, self-harm |
| 9-10 | Critical | Emergency Protocol | Suicidal ideation, overdose risk |

## Detection Patterns

The package includes 9 crisis pattern types:

### Critical (Level 9-10)
- **suicidal_ideation**: Thoughts of suicide or ending life
- **overdose_risk**: Taking too many pills, mixing substances
- **violence_risk**: Threats to harm others

### High (Level 7-8)
- **self_harm**: Cutting, burning, hurting self
- **active_relapse**: Currently using/drinking
- **imminent_relapse**: About to use, contacted dealer

### Elevated (Level 4-6)
- **severe_distress**: Can't cope, overwhelmed, panic
- **hopelessness**: No hope, giving up, nothing matters
- **isolation**: Completely alone, no support

## API Reference

### KeywordCrisisDetector

```typescript
interface KeywordCrisisDetectorConfig {
  emergencyThreshold: CrisisLevel  // Default: 9
  resourceThreshold: CrisisLevel   // Default: 7
}

class KeywordCrisisDetector implements ICrisisDetector {
  constructor(config?: Partial<KeywordCrisisDetectorConfig>)

  detect(
    message: string,
    ctx: TraceContext,
  ): Promise<Result<CrisisCheckResult, CrisisError>>
}
```

### CrisisCheckResult

```typescript
interface CrisisCheckResult {
  level: CrisisLevel           // 1-10 severity
  patterns: DetectedPattern[]  // Matched patterns
  triggerEmergency: boolean    // Whether to trigger emergency protocol
  action: 'none' | 'monitor' | 'inject_resources' | 'emergency_protocol'
  processingTimeMs: number     // Detection time in ms
}

interface DetectedPattern {
  type: CrisisPatternType      // Pattern category
  confidence: number           // 0-1 confidence score
  matchedText: string          // The text that matched
  position?: { start: number; end: number }
}
```

## Pattern Matching Logic

Each pattern has:

- **Base Level**: Starting severity if pattern matches
- **Patterns**: Regex patterns to match
- **Boost Keywords**: Words that increase severity (e.g., "tonight", "now")
- **Dampeners**: Words that reduce severity (e.g., "used to", "in the past")

```typescript
interface CrisisPattern {
  type: CrisisPatternType
  baseLevel: CrisisLevel
  patterns: RegExp[]
  boostKeywords: string[]
  dampeners: string[]
}
```

### Confidence Calculation

```
confidence = 0.6 + (boostKeywordCount * 0.1)
```

Maximum confidence is 1.0.

### Level Adjustment

```
finalLevel = baseLevel + floor(boostCount / 2) - dampenerCount
```

Clamped between 1 and 10.

## Crisis Resources

Pre-defined crisis resources for emergency responses:

```typescript
import { CRISIS_RESOURCES } from '@recoverysky/crisis'

// National resources
CRISIS_RESOURCES.national
// - 988 Suicide & Crisis Lifeline
// - Crisis Text Line
// - SAMHSA National Helpline

// Recovery-specific
CRISIS_RESOURCES.recovery
// - AA Hotline
// - NA Helpline
```

## Stub Implementations

For testing:

```typescript
import { StubCrisisDetector, StubCrisisHandler } from '@recoverysky/crisis'

// Detector that returns configurable results
const detector = new StubCrisisDetector()
detector.setMockResult({
  level: 8,
  triggerEmergency: false,
  action: 'inject_resources',
})

// Handler that returns configurable responses
const handler = new StubCrisisHandler()
```

## Metrics

The package records:

- `crisis_detections_total{level}` - Detections by severity level

## Example: Full Flow

```typescript
import { KeywordCrisisDetector, CRISIS_RESOURCES } from '@recoverysky/crisis'

const detector = new KeywordCrisisDetector()

async function handleMessage(message: string, ctx: TraceContext) {
  const result = await detector.detect(message, ctx)

  if (!result.ok) {
    // Handle detection error
    return
  }

  const { level, action, patterns } = result.value

  switch (action) {
    case 'emergency_protocol':
      // Immediate intervention needed
      return {
        prependMessage: buildCrisisResponse(CRISIS_RESOURCES.national),
        skipNormalFlow: true,
      }

    case 'inject_resources':
      // Include resources in response
      return {
        injectResources: CRISIS_RESOURCES.national,
      }

    case 'monitor':
      // Log for review, continue normally
      logger.info({ level, patterns }, 'Elevated crisis detected')
      return {}

    default:
      return {}
  }
}
```

## Development

```bash
# Build
pnpm build

# Test
pnpm test

# Type check
pnpm typecheck
```

## Future Enhancements

- LLM-based deep evaluation for nuanced detection
- User history analysis for personalized thresholds
- Multi-language support
- Webhook alerting for critical detections
