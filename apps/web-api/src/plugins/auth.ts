/**
 * Auth0 JWT Authentication Plugin for Fastify
 *
 * Validates JWTs issued by Auth0 using the standard JWKS endpoint.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import fp from "fastify-plugin";
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

declare module "fastify" {
  interface FastifyRequest {
    user?: AuthenticatedUser;
  }
}

export interface AuthPluginOptions {
  /** Auth0 issuer base URL, e.g. https://your-tenant.us.auth0.com/ */
  issuerBaseURL: string;
  /** API audience identifier configured in Auth0 */
  audience: string;
  /** Routes to skip authentication (e.g., ['/health']) */
  skipRoutes?: string[];
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

async function authPlugin(
  fastify: FastifyInstance,
  options: AuthPluginOptions
): Promise<void> {
  const logger = getLogger().child({ plugin: "auth" });

  fastify.decorateRequest("user", undefined as AuthenticatedUser | undefined);

  const jwks = getJWKS(options.issuerBaseURL);
  const expectedIssuer = normalizeIssuer(options.issuerBaseURL);

  logger.info(
    { issuer: expectedIssuer, audience: options.audience },
    "Auth0 plugin initialized"
  );

  const skipPatterns = ["/health", ...(options.skipRoutes || [])];

  fastify.addHook(
    "onRequest",
    async (request: FastifyRequest, reply: FastifyReply) => {
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
          issuer: expectedIssuer,
          audience: options.audience,
        });

        const claims = payload as Auth0Claims;

        const userinfo = await fetchUserinfo(
          options.issuerBaseURL,
          token,
          logger
        );

        request.user = {
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
