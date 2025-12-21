/**
 * Stub crisis handler for testing
 */

import type {
  ICrisisHandler,
  CrisisCheckResult,
  CrisisHandlerResponse,
  CrisisError,
  TraceContext,
  Result,
} from "@pippa/types";
import { ok } from "@pippa/types";
import { CRISIS_RESOURCES } from "../patterns.js";

export class StubCrisisHandler implements ICrisisHandler {
  private handledCrises: Array<{
    result: CrisisCheckResult;
    userId: string;
    conversationId: string;
    timestamp: number;
  }> = [];

  async handle(
    result: CrisisCheckResult,
    userId: string,
    conversationId: string,
    _ctx: TraceContext,
  ): Promise<Result<CrisisHandlerResponse, CrisisError>> {
    // Record the crisis for testing
    this.handledCrises.push({
      result,
      userId,
      conversationId,
      timestamp: Date.now(),
    });

    const response: CrisisHandlerResponse = {
      teamAlerted: result.triggerEmergency,
      actionsTaken: [],
    };

    // Simulate actions based on crisis level
    if (result.level >= 9) {
      response.actionsTaken.push("emergency_team_alerted");
      response.prependMessage =
        "🆘 I can see you're going through something really difficult right now. " +
        "Your safety is the most important thing. Please reach out to one of these resources immediately:";
      response.resources = [...CRISIS_RESOURCES.national];
    } else if (result.level >= 7) {
      response.actionsTaken.push("resources_injected");
      response.prependMessage =
        "💙 I hear that you're struggling. You don't have to face this alone. " +
        "Here are some resources that can help:";
      response.resources = [
        ...CRISIS_RESOURCES.national,
        ...CRISIS_RESOURCES.recovery,
      ];
    } else if (result.level >= 4) {
      response.actionsTaken.push("flagged_for_review");
    }

    return ok(response);
  }

  /**
   * Get all handled crises (for testing)
   */
  getHandledCrises() {
    return [...this.handledCrises];
  }

  /**
   * Clear handled crises (for testing)
   */
  clear(): void {
    this.handledCrises = [];
  }
}
