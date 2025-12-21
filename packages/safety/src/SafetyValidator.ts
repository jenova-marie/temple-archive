/**
 * Safety Validator - Composite validator orchestrating all safety detectors
 *
 * Uses a multi-stage approach:
 * 1. Fast PII detection (regex-based)
 * 2. Medical advice pre-filter (regex) + LLM confirmation
 * 3. Enabling language pre-filter (regex) + LLM confirmation
 * 4. Sanitization of detected violations
 *
 * Prioritizes speed for regex-based detection, using LLM only when needed.
 */

import type Anthropic from "@anthropic-ai/sdk";
import type {
  ISafetyValidator,
  SafetyValidationResult,
  SafetyError,
  SafetyViolation,
  AssembledContext,
  TraceContext,
  Result,
} from "@pippa/types";
import { ok, err } from "@pippa/types";
import { getLogger, withSpan, pipelineMetrics } from "@pippa/observability";
import { PIIDetector } from "./detectors/PIIDetector.js";
import { MedicalAdviceDetector } from "./detectors/MedicalAdviceDetector.js";
import { EnablingDetector } from "./detectors/EnablingDetector.js";

export interface SafetyValidatorConfig {
  /** Enable LLM-based detection for medical/enabling. Default: true */
  enableLLMDetection?: boolean;
  /** LLM model to use. Default: 'claude-3-haiku-20240307' */
  llmModel?: string;
  /** Redact PII in sanitized output. Default: true */
  redactPII?: boolean;
  /** Block response if sanitization fails. Default: true */
  blockOnFailedSanitization?: boolean;
  /** Run LLM detectors in parallel. Default: true */
  parallelLLMDetection?: boolean;
}

const DEFAULT_CONFIG: Required<SafetyValidatorConfig> = {
  enableLLMDetection: true,
  llmModel: "claude-3-haiku-20240307",
  redactPII: true,
  blockOnFailedSanitization: true,
  parallelLLMDetection: true,
};

export class SafetyValidator implements ISafetyValidator {
  private readonly config: Required<SafetyValidatorConfig>;
  private readonly piiDetector: PIIDetector;
  private readonly medicalDetector: MedicalAdviceDetector;
  private readonly enablingDetector: EnablingDetector;

  constructor(anthropic: Anthropic | null, config?: SafetyValidatorConfig) {
    this.config = { ...DEFAULT_CONFIG, ...config };

    // Initialize detectors
    this.piiDetector = new PIIDetector();
    this.medicalDetector = new MedicalAdviceDetector(
      this.config.enableLLMDetection ? anthropic : null,
      this.config.llmModel,
    );
    this.enablingDetector = new EnablingDetector(
      this.config.enableLLMDetection ? anthropic : null,
      this.config.llmModel,
    );
  }

  async validate(
    output: string,
    _context: AssembledContext,
    ctx: TraceContext,
  ): Promise<Result<SafetyValidationResult, SafetyError>> {
    return withSpan("SafetyValidator.validate", async () => {
      const startTime = performance.now();
      const logger = getLogger().child({ requestId: ctx.requestId });

      try {
        // Stage 1: Fast PII detection (always runs)
        const piiViolations = await this.piiDetector.detectViolations(
          output,
          ctx,
        );

        // Stage 2 & 3: Medical and Enabling detection
        // Run pre-filters first (fast), then LLM if needed
        let medicalViolations: SafetyViolation[] = [];
        let enablingViolations: SafetyViolation[] = [];

        // Check if pre-filters have matches
        const medicalPrefilter = this.medicalDetector.preFilter(output);
        const enablingPrefilter = this.enablingDetector.preFilter(output);

        if (medicalPrefilter.length > 0 || enablingPrefilter.length > 0) {
          // Run LLM detectors for confirmation
          if (this.config.parallelLLMDetection) {
            const [medViolations, enaViolations] = await Promise.all([
              medicalPrefilter.length > 0
                ? this.medicalDetector.detectViolations(
                    output,
                    ctx,
                    this.config.enableLLMDetection,
                  )
                : Promise.resolve([]),
              enablingPrefilter.length > 0
                ? this.enablingDetector.detectViolations(
                    output,
                    ctx,
                    this.config.enableLLMDetection,
                  )
                : Promise.resolve([]),
            ]);
            medicalViolations = medViolations;
            enablingViolations = enaViolations;
          } else {
            if (medicalPrefilter.length > 0) {
              medicalViolations = await this.medicalDetector.detectViolations(
                output,
                ctx,
                this.config.enableLLMDetection,
              );
            }
            if (enablingPrefilter.length > 0) {
              enablingViolations = await this.enablingDetector.detectViolations(
                output,
                ctx,
                this.config.enableLLMDetection,
              );
            }
          }
        }

        // Combine all violations
        const allViolations = [
          ...piiViolations,
          ...medicalViolations,
          ...enablingViolations,
        ];

        // Record metrics
        for (const violation of allViolations) {
          pipelineMetrics.safetyViolations.add(1, { type: violation.type });
        }

        // Attempt sanitization
        let sanitizedOutput: string | undefined;
        let sanitizationFailed = false;

        if (allViolations.length > 0) {
          logger.warn(
            {
              violationCount: allViolations.length,
              types: allViolations.map((v) => v.type),
            },
            "Safety violations detected, attempting sanitization",
          );

          const sanitizationResult = this.sanitize(output, allViolations, ctx);
          sanitizedOutput = sanitizationResult.output;
          sanitizationFailed = sanitizationResult.failed;

          if (sanitizationFailed) {
            logger.error("Sanitization failed for some violations");
          }
        }

        const processingTimeMs = performance.now() - startTime;

        // Determine pass/fail
        // Pass if: no violations OR (violations with successful sanitization)
        // Fail if: violations AND (no sanitization OR failed sanitization with blocking enabled)
        const passed =
          allViolations.length === 0 ||
          (sanitizedOutput !== undefined && !sanitizationFailed) ||
          (sanitizationFailed && !this.config.blockOnFailedSanitization);

        logger.debug(
          {
            violationCount: allViolations.length,
            passed,
            sanitized: sanitizedOutput !== undefined,
            processingTimeMs,
          },
          "Safety validation completed",
        );

        return ok({
          passed,
          violations: allViolations,
          sanitizedOutput,
          processingTimeMs,
        });
      } catch (error) {
        logger.error({ error }, "Safety validation error");
        return err({
          kind: "ValidationError",
          message:
            error instanceof Error ? error.message : "Unknown validation error",
          context: { requestId: ctx.requestId },
        });
      }
    });
  }

  /**
   * Attempt to sanitize output based on violations
   */
  private sanitize(
    output: string,
    violations: SafetyViolation[],
    ctx: TraceContext,
  ): { output: string; failed: boolean } {
    const logger = getLogger().child({ requestId: ctx.requestId });
    let result = output;
    let anyFailed = false;

    // Group violations by type
    const piiViolations = violations.filter((v) => v.type === "pii");
    const medicalViolations = violations.filter(
      (v) => v.type === "medical_advice",
    );
    const enablingViolations = violations.filter(
      (v) => v.type === "enabling_language",
    );

    // Sanitize PII (can be redacted)
    if (piiViolations.length > 0 && this.config.redactPII) {
      const piiMatches = this.piiDetector.detect(result);
      if (piiMatches.length > 0) {
        result = this.piiDetector.redact(result, piiMatches);
        logger.debug(
          { redactedCount: piiMatches.length },
          "PII redacted from output",
        );
      }
    }

    // Medical advice cannot be safely sanitized - mark as failed
    if (medicalViolations.length > 0) {
      logger.warn(
        { count: medicalViolations.length },
        "Medical advice detected - cannot sanitize, marking as failed",
      );
      anyFailed = true;
    }

    // Enabling language cannot be safely sanitized - mark as failed
    if (enablingViolations.length > 0) {
      logger.warn(
        { count: enablingViolations.length },
        "Enabling language detected - cannot sanitize, marking as failed",
      );
      anyFailed = true;
    }

    return { output: result, failed: anyFailed };
  }
}
