/**
 * Zitadel JWT Authentication Plugin for Fastify
 *
 * Ported from apps/api Express middleware to Fastify plugin pattern.
 * Validates JWTs issued by Zitadel using JWKS endpoint.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import fp from "fastify-plugin";
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

// Extend Fastify's Request type
declare module "fastify" {
  interface FastifyRequest {
    /** Authenticated user (present if JWT is valid) */
    user?: AuthenticatedUser;
  }
}

/**
 * Auth plugin configuration
 */
export interface AuthPluginOptions {
  /** Zitadel issuer URL */
  issuer: string;
  /** Expected audience (client ID) */
  audience: string;
  /** Routes to skip authentication (e.g., ['/health']) */
  skipRoutes?: string[];
  /** Bypass auth entirely (for DISABLE_AUTH=true) */
  bypassAuth?: boolean;
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
      { sub: userinfo.sub, name: userinfo.name, email: userinfo.email },
      "Userinfo fetched"
    );
    return userinfo;
  } catch (error) {
    logger.warn({ error }, "Failed to fetch userinfo");
    return null;
  }
}

/**
 * Fastify authentication plugin
 */
async function authPlugin(
  fastify: FastifyInstance,
  options: AuthPluginOptions
): Promise<void> {
  const logger = getLogger().child({ plugin: "auth" });

  // Decorate request with user property
  fastify.decorateRequest("user", undefined as AuthenticatedUser | undefined);

  // Bypass mode for development
  if (options.bypassAuth) {
    logger.warn("Authentication DISABLED (bypassAuth=true) - using dev user");

    fastify.addHook("onRequest", async (request) => {
      request.user = {
        id: "dev-user",
        email: "dev@pippa.app",
        name: "Development User",
        roles: ["admin"],
        claims: { sub: "dev-user" } as ZitadelClaims,
      };
    });

    return;
  }

  // Normal auth mode
  const jwks = getJWKS(options.issuer);
  logger.info(
    { issuer: options.issuer, audience: options.audience },
    "Auth plugin initialized"
  );

  const skipPatterns = [
    "/health",
    ...(options.skipRoutes || []),
  ];

  fastify.addHook(
    "onRequest",
    async (request: FastifyRequest, reply: FastifyReply) => {
      // Skip auth for specified routes
      const shouldSkip = skipPatterns.some((pattern) =>
        request.url.startsWith(pattern)
      );

      if (shouldSkip) {
        return;
      }

      // WebSocket upgrade requests - handle separately in WS handler
      if (request.headers.upgrade === "websocket") {
        return;
      }

      const authHeader = request.headers.authorization;

      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return reply.status(401).send({
          error: "Unauthorized",
          message: "Bearer token required",
        });
      }

      const token = authHeader.slice(7);

      try {
        const { payload } = await jwtVerify(token, jwks, {
          issuer: options.issuer,
          audience: options.audience,
        });

        const claims = payload as ZitadelClaims;

        // Optionally fetch userinfo for profile data
        const userinfo = await fetchUserinfo(options.issuer, token, logger);

        request.user = {
          id: claims.sub,
          email: userinfo?.email || claims.email,
          name:
            userinfo?.name ||
            userinfo?.given_name ||
            claims.name ||
            claims.preferred_username,
          roles: extractRoles(claims),
          claims,
        };

        logger.debug(
          { userId: request.user.id, roles: request.user.roles },
          "User authenticated"
        );
      } catch (error) {
        const err = error as Error & { code?: string; claim?: string };
        logger.warn(
          {
            errorName: err.name,
            errorMessage: err.message,
            errorCode: err.code,
          },
          "JWT verification failed"
        );

        return reply.status(401).send({
          error: "Unauthorized",
          message: "Invalid token",
        });
      }
    }
  );
}

export default fp(authPlugin, {
  name: "auth-plugin",
  fastify: "5.x",
});
