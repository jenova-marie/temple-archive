/**
 * Zitadel JWT Authentication Middleware
 *
 * Validates JWTs issued by Zitadel using JWKS endpoint
 */

import type { Request, Response, NextFunction } from "express";
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import { getLogger } from "@pippa/observability";

/**
 * Zitadel JWT claims
 */
export interface ZitadelClaims extends JWTPayload {
  /** Subject - the user ID */
  sub: string;
  /** Email address */
  email?: string;
  /** Email verified flag */
  email_verified?: boolean;
  /** Full name */
  name?: string;
  /** Given name */
  given_name?: string;
  /** Family name */
  family_name?: string;
  /** Preferred username */
  preferred_username?: string;
  /** Locale */
  locale?: string;
  /** Zitadel roles (project-specific) */
  "urn:zitadel:iam:org:project:roles"?: Record<string, Record<string, string>>;
}

/**
 * Authenticated user attached to request
 */
export interface AuthenticatedUser {
  /** User ID from Zitadel (sub claim) */
  id: string;
  /** Email address */
  email?: string;
  /** Display name */
  name?: string;
  /** Roles from Zitadel */
  roles: string[];
  /** Raw JWT claims for advanced use cases */
  claims: ZitadelClaims;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Authenticated user (present if JWT is valid) */
      user?: AuthenticatedUser;
    }
  }
}

/**
 * Configuration for Zitadel auth middleware
 */
export interface ZitadelAuthConfig {
  /** Zitadel issuer URL (e.g., https://my-instance.zitadel.cloud) */
  issuer: string;
  /** Expected audience (client ID) */
  audience: string;
  /** JWKS cache time in ms (default: 10 minutes) */
  jwksCacheTime?: number;
}

// Cached JWKS fetcher (singleton per issuer)
const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function getJWKS(issuer: string): ReturnType<typeof createRemoteJWKSet> {
  const cached = jwksCache.get(issuer);
  if (cached) return cached;

  // Zitadel uses /oauth/v2/keys instead of /.well-known/jwks.json
  const jwksUri = `${issuer.replace(/\/$/, "")}/oauth/v2/keys`;
  const jwks = createRemoteJWKSet(new URL(jwksUri));
  jwksCache.set(issuer, jwks);
  return jwks;
}

/**
 * Extract roles from Zitadel claims
 */
function extractRoles(claims: ZitadelClaims): string[] {
  const rolesObj = claims["urn:zitadel:iam:org:project:roles"];
  if (!rolesObj) return [];

  // Zitadel stores roles as { "role_name": { "org_id": "org_name" } }
  return Object.keys(rolesObj);
}

/**
 * Userinfo response from Zitadel
 */
interface UserinfoResponse {
  sub: string;
  name?: string;
  given_name?: string;
  family_name?: string;
  preferred_username?: string;
  email?: string;
  email_verified?: boolean;
  locale?: string;
}

/**
 * Fetch user profile from Zitadel userinfo endpoint
 * This gets the profile claims that aren't in the access token
 */
async function fetchUserinfo(
  issuer: string,
  accessToken: string,
  logger: ReturnType<typeof getLogger>
): Promise<UserinfoResponse | null> {
  const userinfoUrl = `${issuer.replace(/\/$/, "")}/oidc/v1/userinfo`;

  try {
    const response = await fetch(userinfoUrl, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!response.ok) {
      logger.warn(
        { status: response.status, statusText: response.statusText },
        "Userinfo request failed"
      );
      return null;
    }

    const userinfo = (await response.json()) as UserinfoResponse;
    logger.debug(
      {
        sub: userinfo.sub,
        name: userinfo.name,
        email: userinfo.email,
        given_name: userinfo.given_name,
        family_name: userinfo.family_name,
      },
      "Userinfo fetched successfully"
    );
    return userinfo;
  } catch (error) {
    logger.warn({ error }, "Failed to fetch userinfo");
    return null;
  }
}

/**
 * Create authentication middleware for Zitadel
 *
 * Usage:
 * ```ts
 * const authMiddleware = createAuthMiddleware({
 *   issuer: process.env.ZITADEL_ISSUER!,
 *   audience: process.env.ZITADEL_CLIENT_ID!,
 * })
 *
 * // Require auth
 * app.use('/api', authMiddleware.required)
 *
 * // Optional auth
 * app.use('/public', authMiddleware.optional)
 * ```
 */
export function createAuthMiddleware(config: ZitadelAuthConfig) {
  const logger = getLogger().child({ middleware: "auth" });
  const jwks = getJWKS(config.issuer);

  logger.info(
    { issuer: config.issuer, audience: config.audience },
    "Auth middleware initialized",
  );

  /**
   * Verify JWT and attach user to request
   */
  async function verifyAndAttachUser(req: Request): Promise<boolean> {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return false;
    }

    const token = authHeader.slice(7);

    try {
      const { payload } = await jwtVerify(token, jwks, {
        issuer: config.issuer,
        audience: config.audience,
      });

      const claims = payload as ZitadelClaims;

      // Fetch profile data from userinfo endpoint (access tokens don't include profile claims)
      const userinfo = await fetchUserinfo(config.issuer, token, logger);

      // Build user object - prefer userinfo data, fall back to JWT claims
      req.user = {
        id: claims.sub,
        email: userinfo?.email || claims.email,
        name: userinfo?.name || userinfo?.given_name || claims.name || claims.preferred_username,
        roles: extractRoles(claims),
        claims,
      };

      logger.debug(
        {
          userId: req.user.id,
          roles: req.user.roles,
          name: req.user.name,
          email: req.user.email,
        },
        "User authenticated",
      );

      return true;
    } catch (error) {
      // jose errors don't serialize well, extract useful info
      const err = error as Error & { code?: string; claim?: string };
      logger.warn(
        {
          errorName: err.name,
          errorMessage: err.message,
          errorCode: err.code,
          claim: err.claim,
          issuer: config.issuer,
          audience: config.audience,
          // SECURITY TODO: Remove token logging before production
          token,
        },
        "JWT verification failed",
      );
      return false;
    }
  }

  return {
    /**
     * Require valid JWT - returns 401 if not present or invalid
     */
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

    /**
     * Optional JWT - attaches user if present, continues regardless
     */
    optional: async (
      req: Request,
      _res: Response,
      next: NextFunction,
    ): Promise<void> => {
      await verifyAndAttachUser(req);
      next();
    },

    /**
     * Require specific role(s) - must be used after required middleware
     */
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
 * Create a bypass middleware that skips JWT verification
 * Used when DISABLE_AUTH=true for local development
 */
function createBypassAuthMiddleware() {
  const logger = getLogger().child({ middleware: "auth" });

  return {
    required: async (
      req: Request,
      _res: Response,
      next: NextFunction,
    ): Promise<void> => {
      // Set a development user
      req.user = {
        id: "dev-user",
        email: "dev@recoverysky.app",
        name: "Development User",
        roles: ["admin"],
        claims: { sub: "dev-user" } as ZitadelClaims,
      };

      logger.debug({ userId: req.user.id }, "Auth bypassed (DISABLE_AUTH=true)");
      next();
    },

    optional: async (
      req: Request,
      _res: Response,
      next: NextFunction,
    ): Promise<void> => {
      req.user = {
        id: "dev-user",
        email: "dev@recoverysky.app",
        name: "Development User",
        roles: ["admin"],
        claims: { sub: "dev-user" } as ZitadelClaims,
      };
      next();
    },

    requireRole: () => {
      return (_req: Request, _res: Response, next: NextFunction): void => {
        next();
      };
    },
  };
}

/**
 * Get auth middleware instance (singleton pattern for convenience)
 * Returns bypass middleware if DISABLE_AUTH=true
 * Returns null if ZITADEL_ISSUER is not configured
 */
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

  // Check for auth bypass (local development)
  if (process.env.DISABLE_AUTH === "true") {
    getLogger().warn("Authentication DISABLED (DISABLE_AUTH=true) - using dev user");
    authMiddlewareInstance = createBypassAuthMiddleware();
    return authMiddlewareInstance;
  }

  const issuer = process.env.ZITADEL_ISSUER;
  const audience =
    process.env.ZITADEL_AUDIENCE || process.env.ZITADEL_CLIENT_ID;

  if (!issuer || !audience) {
    getLogger().warn(
      "Zitadel auth not configured (ZITADEL_ISSUER or ZITADEL_AUDIENCE missing)",
    );
    return null;
  }

  authMiddlewareInstance = createAuthMiddleware({ issuer, audience });
  return authMiddlewareInstance;
}
