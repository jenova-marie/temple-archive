/**
 * Fast pre-flight crisis detector using keyword/pattern matching
 *
 * Target: <10ms detection time
 */

import type {
  ICrisisDetector,
  CrisisCheckResult,
  CrisisLevel,
  DetectedPattern,
  CrisisError,
  TraceContext,
  Result,
} from "@siri/types";
import { ok } from "@siri/types";
import { getLogger, withSpan, pipelineMetrics } from "@siri/observability";
import { CRISIS_PATTERNS, type CrisisPattern } from "./patterns.js";

export interface KeywordCrisisDetectorConfig {
  /** Crisis level threshold for emergency (default: 9) */
  emergencyThreshold: CrisisLevel;
  /** Crisis level threshold for resource injection (default: 7) */
  resourceThreshold: CrisisLevel;
}

export class KeywordCrisisDetector implements ICrisisDetector {
  private readonly config: KeywordCrisisDetectorConfig;
  private readonly patterns: CrisisPattern[];

  constructor(config?: Partial<KeywordCrisisDetectorConfig>) {
    this.config = {
      emergencyThreshold: 9,
      resourceThreshold: 7,
      ...config,
    };
    this.patterns = CRISIS_PATTERNS;
  }

  async detect(
    message: string,
    ctx: TraceContext,
  ): Promise<Result<CrisisCheckResult, CrisisError>> {
    return withSpan("KeywordCrisisDetector.detect", async () => {
      const startTime = performance.now();
      const logger = getLogger().child({ requestId: ctx.requestId });

      const detectedPatterns: DetectedPattern[] = [];
      let maxLevel: CrisisLevel = 1;

      // Normalize message for matching
      const normalizedMessage = message.toLowerCase();

      // Check each pattern
      for (const pattern of this.patterns) {
        const matches = this.matchPattern(normalizedMessage, message, pattern);

        if (matches.length > 0) {
          for (const match of matches) {
            detectedPatterns.push(match);

            // Track highest level
            const adjustedLevel = this.adjustLevel(
              pattern.baseLevel,
              normalizedMessage,
              pattern,
            );
            if (adjustedLevel > maxLevel) {
              maxLevel = adjustedLevel as CrisisLevel;
            }
          }
        }
      }

      // Determine action based on level
      const action = this.determineAction(maxLevel);
      const triggerEmergency = maxLevel >= this.config.emergencyThreshold;

      const processingTimeMs = performance.now() - startTime;

      // Record metrics
      if (maxLevel > 1) {
        pipelineMetrics.crisisDetections.add(1, { level: String(maxLevel) });
      }

      logger.debug(
        {
          level: maxLevel,
          patternCount: detectedPatterns.length,
          processingTimeMs,
          triggerEmergency,
        },
        "Crisis detection completed",
      );

      return ok({
        level: maxLevel,
        patterns: detectedPatterns,
        triggerEmergency,
        action,
        processingTimeMs,
      });
    });
  }

  private matchPattern(
    normalizedMessage: string,
    originalMessage: string,
    pattern: CrisisPattern,
  ): DetectedPattern[] {
    const matches: DetectedPattern[] = [];

    for (const regex of pattern.patterns) {
      const match = originalMessage.match(regex);

      if (match) {
        // Check for dampeners (false positive reducers)
        const hasDampener = pattern.dampeners.some((dampener) =>
          normalizedMessage.includes(dampener.toLowerCase()),
        );

        if (hasDampener) {
          continue; // Skip this match due to dampener
        }

        // Calculate confidence based on boost keywords
        const boostCount = pattern.boostKeywords.filter((keyword) =>
          normalizedMessage.includes(keyword.toLowerCase()),
        ).length;

        const confidence = Math.min(0.6 + boostCount * 0.1, 1.0);

        matches.push({
          type: pattern.type,
          confidence,
          matchedText: match[0],
          position:
            match.index !== undefined
              ? { start: match.index, end: match.index + match[0].length }
              : undefined,
        });
      }
    }

    return matches;
  }

  private adjustLevel(
    baseLevel: CrisisLevel,
    normalizedMessage: string,
    pattern: CrisisPattern,
  ): number {
    let level = baseLevel;

    // Boost for urgency keywords
    const boostCount = pattern.boostKeywords.filter((keyword) =>
      normalizedMessage.includes(keyword.toLowerCase()),
    ).length;

    if (boostCount > 0) {
      level = Math.min(level + Math.floor(boostCount / 2), 10) as CrisisLevel;
    }

    // Reduce for dampeners
    const dampenerCount = pattern.dampeners.filter((dampener) =>
      normalizedMessage.includes(dampener.toLowerCase()),
    ).length;

    if (dampenerCount > 0) {
      level = Math.max(level - dampenerCount, 1) as CrisisLevel;
    }

    return level;
  }

  private determineAction(level: CrisisLevel): CrisisCheckResult["action"] {
    if (level >= this.config.emergencyThreshold) {
      return "emergency_protocol";
    }
    if (level >= this.config.resourceThreshold) {
      return "inject_resources";
    }
    if (level >= 4) {
      return "monitor";
    }
    return "none";
  }
}
