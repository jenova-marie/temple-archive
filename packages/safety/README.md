# @recoverysky/safety

Response safety validation for the RecoverySky Agent system.

## Installation

```bash
pnpm add @recoverysky/safety
```

## Overview

This package validates AI-generated responses to ensure they meet safety requirements before being sent to users. It detects:

- **PII** (Personally Identifiable Information)
- **Medical advice** (dosage recommendations, treatment suggestions)
- **Enabling language** (glorifying substance use)
- **Harmful content**

## Quick Start

```typescript
import { StubSafetyValidator } from '@recoverysky/safety'

const validator = new StubSafetyValidator()

const result = await validator.validate(
  "Take 50mg of medication twice daily",
  assembledContext,
  traceContext,
)

if (result.ok) {
  if (!result.value.passed) {
    console.log('Violations:', result.value.violations)
    // [{ type: 'medical_advice', severity: 'high', description: '...' }]
  }
}
```

## API Reference

### ISafetyValidator Interface

```typescript
interface ISafetyValidator {
  validate(
    output: string,
    context: AssembledContext,
    ctx: TraceContext,
  ): Promise<Result<SafetyValidationResult, SafetyError>>
}

interface SafetyValidationResult {
  passed: boolean
  violations: SafetyViolation[]
  sanitizedOutput?: string  // Cleaned output if violations found
  processingTimeMs: number
}

interface SafetyViolation {
  type: 'pii' | 'medical_advice' | 'enabling_language' | 'harmful_content'
  severity: 'low' | 'medium' | 'high' | 'critical'
  description: string
  position?: { start: number; end: number }
}
```

### StubSafetyValidator

Current stub implementation with basic pattern matching:

```typescript
class StubSafetyValidator implements ISafetyValidator {
  // Validate output for safety violations
  validate(output, context, ctx): Promise<Result<SafetyValidationResult, SafetyError>>

  // Add mock violations for testing
  addMockViolation(violation: SafetyViolation): void

  // Clear mock violations
  clearMockViolations(): void
}
```

## Current Detection

The stub implementation detects:

### PII Detection
- Social Security Numbers (`\b\d{3}-\d{2}-\d{4}\b`)

### Medical Advice Detection
- Dosage recommendations (`\btake\s+\d+\s*(mg|ml|pills?|tablets?)\b`)

## Usage in Pipeline

```typescript
import { StubSafetyValidator } from '@recoverysky/safety'

const safety = new StubSafetyValidator()

// After agent generates response
const safetyResult = await safety.validate(
  agentResponse.content,
  assembledContext,
  traceContext,
)

if (safetyResult.ok && !safetyResult.value.passed) {
  // Use sanitized output if available
  const finalResponse = safetyResult.value.sanitizedOutput || fallbackResponse

  // Log violations
  for (const violation of safetyResult.value.violations) {
    logger.warn({ violation }, 'Safety violation detected')
  }
}
```

## Testing

```typescript
const validator = new StubSafetyValidator()

// Add mock violations for testing
validator.addMockViolation({
  type: 'enabling_language',
  severity: 'high',
  description: 'Response glorifies substance use',
})

const result = await validator.validate(output, context, ctx)
expect(result.ok && result.value.passed).toBe(false)

// Clean up
validator.clearMockViolations()
```

## Metrics

The package records:

- `safety_violations_total{type}` - Violations by type (pii, medical_advice, etc.)

## Development

```bash
# Build
pnpm build

# Type check
pnpm typecheck
```

## Future Implementations

The production validator will include:

- **Advanced PII Detection**
  - Names, emails, phone numbers
  - Addresses, credit cards
  - Medical record numbers

- **Medical Advice Detection**
  - Specific medication names
  - Dosage instructions
  - Treatment recommendations
  - "Stop taking" suggestions

- **Enabling Language Detection**
  - Glorifying substance use
  - Minimizing addiction risks
  - "Just one drink" patterns

- **Harmful Content Detection**
  - Self-harm instructions
  - Suicide methods
  - Drug acquisition information

- **Sanitization**
  - Automatic redaction of PII
  - Rephrasing of medical content
  - Safe response generation
