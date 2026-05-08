/**
 * API key authentication middleware.
 *
 * Compares the incoming `X-API-Key` header against a comma-separated list of
 * valid keys read from an env var (per-route). Comparisons are timing-safe.
 *
 * Used by the public /api/v1/ask endpoint, where full Auth0 JWT auth would
 * defeat the point of a "simple GET". Distinct from the JWT middleware so
 * each can evolve independently (rate limits, key rotation, etc.).
 */

import type { Request, Response, NextFunction } from "express";
import { timingSafeEqual } from "node:crypto";
import { getLogger } from "@siri/observability";

/**
 * Build a middleware that validates `X-API-Key` against the keys listed in
 * `process.env[envVarName]` (comma-separated, whitespace-trimmed).
 *
 * If the env var is unset or empty, every request is rejected with 503 —
 * this surfaces misconfiguration rather than silently falling open.
 */
export function getApiKeyMiddleware(envVarName: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const validKeys = (process.env[envVarName] ?? "")
      .split(",")
      .map((k) => k.trim())
      .filter((k) => k.length > 0);

    if (validKeys.length === 0) {
      getLogger().error(
        { envVarName },
        "API key middleware invoked but no keys are configured",
      );
      res.status(503).json({
        error: "Service Unavailable",
        message: "API key authentication is not configured",
      });
      return;
    }

    const provided = req.header("x-api-key");
    if (!provided) {
      res.status(401).json({
        error: "Unauthorized",
        message: "X-API-Key header is required",
      });
      return;
    }

    const providedBuf = Buffer.from(provided);
    const matched = validKeys.some((key) => {
      const keyBuf = Buffer.from(key);
      // timingSafeEqual requires equal-length buffers; bail early otherwise.
      if (keyBuf.length !== providedBuf.length) return false;
      return timingSafeEqual(keyBuf, providedBuf);
    });

    if (!matched) {
      res.status(401).json({
        error: "Unauthorized",
        message: "Invalid API key",
      });
      return;
    }

    next();
  };
}
