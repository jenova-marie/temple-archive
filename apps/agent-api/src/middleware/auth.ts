/**
 * Auth0 JWT Authentication Middleware
 *
 * Validates JWTs issued by Auth0 using the standard JWKS endpoint.
 */

import type { Request, Response, NextFunction } from "express";
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import { getLogger } from "@siri/observability";

const ROLES_CLAIM = "https://siri.app/roles";

export interface Auth0Claims extends JWTPayload {
  sub: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  given_name?: string;
  family_name?: string;
  nickname?: string;
  picture?: string;
  locale?: string;
  permissions?: string[];
  [ROLES_CLAIM]?: string[];
}

export interface AuthenticatedUser {
  id: string;
  email?: string;
  name?: string;
  roles: string[];
  claims: Auth0Claims;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}

export interface Auth0AuthConfig {
  /** Auth0 issuer base URL, e.g. https://your-tenant.us.auth0.com/ (trailing slash optional) */
  issuerBaseURL: string;
  /** API audience identifier configured in Auth0 */
  audience: string;
  /** JWKS cache time in ms (default: 10 minutes) */
  jwksCacheTime?: number;
}

const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function normalizeIssuer(issuer: string): string {
  return issuer.endsWith("/") ? issuer : `${issuer}/`;
}

function getJWKS(issuer: string): ReturnType<typeof createRemoteJWKSet> {
  const cached = jwksCache.get(issuer);
  if (cached) return cached;

  const jwksUri = `${normalizeIssuer(issuer)}.well-known/jwks.json`;
  const jwks = createRemoteJWKSet(new URL(jwksUri));
  jwksCache.set(issuer, jwks);
  return jwks;
}

function extractRoles(claims: Auth0Claims): string[] {
  const roles = claims[ROLES_CLAIM];
  return Array.isArray(roles) ? roles : [];
}

interface UserinfoResponse {
  sub: string;
  name?: string;
  given_name?: string;
  family_name?: string;
  nickname?: string;
  email?: string;
  email_verified?: boolean;
  picture?: string;
  locale?: string;
}

async function fetchUserinfo(
  issuer: string,
  accessToken: string,
  logger: ReturnType<typeof getLogger>
): Promise<UserinfoResponse | null> {
  const userinfoUrl = `${normalizeIssuer(issuer)}userinfo`;

  try {
    const response = await fetch(userinfoUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!response.ok) {
      logger.warn(
        { status: response.status, statusText: response.statusText },
        "Userinfo request failed"
      );
      return null;
    }

    return (await response.json()) as UserinfoResponse;
  } catch (error) {
    logger.warn({ error }, "Failed to fetch userinfo");
    return null;
  }
}

export function createAuthMiddleware(config: Auth0AuthConfig) {
  const logger = getLogger().child({ middleware: "auth" });
  const jwks = getJWKS(config.issuerBaseURL);
  const expectedIssuer = normalizeIssuer(config.issuerBaseURL);

  logger.info(
    { issuer: expectedIssuer, audience: config.audience },
    "Auth0 middleware initialized"
  );

  async function verifyAndAttachUser(req: Request): Promise<boolean> {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return false;
    }

    const token = authHeader.slice(7);

    try {
      const { payload } = await jwtVerify(token, jwks, {
        issuer: expectedIssuer,
        audience: config.audience,
      });

      const claims = payload as Auth0Claims;

      // Auth0 access tokens often omit profile claims; userinfo fills them in.
      const userinfo = await fetchUserinfo(config.issuerBaseURL, token, logger);

      req.user = {
        id: claims.sub,
        email: userinfo?.email || claims.email,
        name:
          userinfo?.name ||
          userinfo?.given_name ||
          userinfo?.nickname ||
          claims.name ||
          claims.nickname,
        roles: extractRoles(claims),
        claims,
      };

      logger.debug(
        {
          userId: req.user.id,
          roles: req.user.roles,
          email: req.user.email,
        },
        "User authenticated"
      );

      return true;
    } catch (error) {
      const err = error as Error & { code?: string; claim?: string };
      logger.warn(
        {
          errorName: err.name,
          errorMessage: err.message,
          errorCode: err.code,
          claim: err.claim,
          issuer: expectedIssuer,
          audience: config.audience,
        },
        "JWT verification failed"
      );
      return false;
    }
  }

  return {
    required: async (
      req: Request,
      res: Response,
      next: NextFunction,
    ): Promise<void> => {
      const isAuthenticated = await verifyAndAttachUser(req);

      if (!isAuthenticated) {
        res.status(401).json({
          error: "Unauthorized",
          message: "Valid authentication token required",
        });
        return;
      }

      next();
    },

    optional: async (
      req: Request,
      _res: Response,
      next: NextFunction,
    ): Promise<void> => {
      await verifyAndAttachUser(req);
      next();
    },

    requireRole: (...roles: string[]) => {
      return (req: Request, res: Response, next: NextFunction): void => {
        if (!req.user) {
          res.status(401).json({
            error: "Unauthorized",
            message: "Authentication required",
          });
          return;
        }

        const hasRole = roles.some((role) => req.user!.roles.includes(role));

        if (!hasRole) {
          res.status(403).json({
            error: "Forbidden",
            message: `Required role: ${roles.join(" or ")}`,
          });
          return;
        }

        next();
      };
    },
  };
}

/**
 * Create a bypass middleware that skips JWT verification.
 * Used when DISABLE_AUTH=true for local development.
 *
 * Supports X-User-Id header to allow CLI and other tools to specify user ID.
 */
function createBypassAuthMiddleware() {
  const logger = getLogger().child({ middleware: "auth" });

  const createDevUser = (req: Request): AuthenticatedUser => {
    const userId = (req.headers["x-user-id"] as string) || "jenova";
    return {
      id: userId,
      email: "jenova-marie@proton.me",
      name: "Jenova",
      roles: ["admin"],
      claims: { sub: userId } as Auth0Claims,
    };
  };

  return {
    required: async (
      req: Request,
      _res: Response,
      next: NextFunction,
    ): Promise<void> => {
      req.user = createDevUser(req);
      logger.debug({ userId: req.user.id }, "Auth bypassed (DISABLE_AUTH=true)");
      next();
    },

    optional: async (
      req: Request,
      _res: Response,
      next: NextFunction,
    ): Promise<void> => {
      req.user = createDevUser(req);
      next();
    },

    requireRole: () => {
      return (_req: Request, _res: Response, next: NextFunction): void => {
        next();
      };
    },
  };
}

let authMiddlewareInstance: ReturnType<typeof createAuthMiddleware> | null =
  null;

/**
 * Reset the auth middleware singleton (for testing only)
 */
export function resetAuthMiddleware(): void {
  authMiddlewareInstance = null;
}

export function getAuthMiddleware(): ReturnType<
  typeof createAuthMiddleware
> | null {
  if (authMiddlewareInstance) return authMiddlewareInstance;

  if (process.env.DISABLE_AUTH === "true") {
    const logger = getLogger().child({ component: "auth" });
    logger.warn(
      { DISABLE_AUTH: process.env.DISABLE_AUTH },
      "⚠️  Authentication DISABLED - Using development bypass (should NOT be used in production)"
    );
    authMiddlewareInstance = createBypassAuthMiddleware();
    return authMiddlewareInstance;
  }

  const issuerBaseURL = process.env.AUTH0_ISSUER_BASE_URL;
  const audience = process.env.AUTH0_AUDIENCE;

  if (!issuerBaseURL || !audience) {
    const logger = getLogger().child({ component: "auth" });
    logger.error(
      {
        AUTH0_ISSUER_BASE_URL_SET: !!issuerBaseURL,
        AUTH0_AUDIENCE_SET: !!audience,
        NODE_ENV: process.env.NODE_ENV,
      },
      "❌ Auth0 authentication not configured - missing AUTH0_ISSUER_BASE_URL and/or AUTH0_AUDIENCE. Set these environment variables or use DISABLE_AUTH=true for local development"
    );
    return null;
  }

  authMiddlewareInstance = createAuthMiddleware({
    issuerBaseURL,
    audience,
  });
  return authMiddlewareInstance;
}
