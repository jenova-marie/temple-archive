# Authentication

Pippa uses Zitadel for OIDC authentication, with a bypass mode for local development.

## The Problem

Pippa stores personal, sensitive data - conversations about mental health, relationships, struggles. This data must be protected. Only you should see your conversations with Pippa.

Authentication answers the question: "Who is making this request?" Without it, anyone with the URL could access anyone's data. With weak auth, attackers could impersonate users, steal tokens, or hijack sessions.

But authentication is also friction. Every login flow is a barrier to entry. Every expired token is a broken session. Every misconfigured redirect is a support ticket. We need security without making the app unusable.

And for development, auth is often pure overhead. You're iterating on features, not testing login flows. Requiring real auth for local dev slows everyone down.

## The Idea

Use a battle-tested identity provider (Zitadel) for production, with a complete bypass for development.

**Production**: Zitadel handles the hard parts - password storage, session management, token issuance, refresh flows, PKCE, JWKS rotation. We delegate trust to a system built for this purpose.

**Development**: Set `DISABLE_AUTH=true` and skip auth entirely. A mock user is injected, allowing full functionality without touching Zitadel.

This separation means:
- Production security doesn't compromise developer experience
- Local testing doesn't require infrastructure setup
- Auth bugs are isolated to the auth layer, not scattered throughout the codebase

The web app uses `react-oidc-context` to manage the OAuth flow. The API validates JWTs using Zitadel's public keys. Both check the bypass flag and short-circuit when disabled.

## Why This Matters

Authentication is foundational. Get it wrong and everything built on top is compromised.

By using Zitadel (a dedicated identity platform), we get:
- Industry-standard OAuth 2.0 / OIDC flows
- Secure token storage and rotation
- Multi-factor authentication (when needed)
- Audit logs and compliance features
- No passwords stored in our database

By providing a bypass mode, we get:
- Fast local iteration
- Easy CI/CD testing
- New developer onboarding without credentials
- Demo environments without auth complexity

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          Auth Architecture                                   │
│                                                                             │
│   ┌───────────────────────────────────────────────────────────────────────┐ │
│   │                           Web App                                      │ │
│   │                                                                        │ │
│   │   ┌─────────────┐         ┌─────────────┐         ┌─────────────┐    │ │
│   │   │ AuthProvider│ ──────▶ │   Zitadel   │ ──────▶ │ authStore   │    │ │
│   │   │(react-oidc) │ ◀────── │   (OIDC)    │         │  (Zustand)  │    │ │
│   │   └─────────────┘         └─────────────┘         └─────────────┘    │ │
│   │                                                                        │ │
│   │   Access token attached to all API requests                           │ │
│   │                                                                        │ │
│   └────────────────────────────────────┬──────────────────────────────────┘ │
│                                        │                                     │
│                                        │ Authorization: Bearer <token>       │
│                                        ▼                                     │
│   ┌───────────────────────────────────────────────────────────────────────┐ │
│   │                         Agent API                                      │ │
│   │                                                                        │ │
│   │   ┌─────────────┐         ┌─────────────┐         ┌─────────────┐    │ │
│   │   │ Auth        │ ──────▶ │   JWKS      │ ──────▶ │ req.user    │    │ │
│   │   │ Middleware  │         │  Validation │         │ { id, ... } │    │ │
│   │   └─────────────┘         └─────────────┘         └─────────────┘    │ │
│   │                                                                        │ │
│   └───────────────────────────────────────────────────────────────────────┘ │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Production Flow (OIDC with Zitadel)

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                         Zitadel OIDC Flow                                     │
│                                                                              │
│   1. User visits app                                                         │
│      │                                                                       │
│      ▼                                                                       │
│   2. AuthProvider checks for existing session                                │
│      │                                                                       │
│      │  No session                                                           │
│      ▼                                                                       │
│   3. Redirect to Zitadel login                                               │
│      │                                                                       │
│      │  ┌─────────────────────────────────────────────────────────────────┐ │
│      │  │  https://auth.rso/oauth/v2/authorize                            │ │
│      │  │  ?client_id=...                                                  │ │
│      │  │  &redirect_uri=.../callback                                      │ │
│      │  │  &scope=openid profile email                                     │ │
│      │  │  &response_type=code                                             │ │
│      │  │  &code_challenge=...  (PKCE)                                     │ │
│      │  └─────────────────────────────────────────────────────────────────┘ │
│      │                                                                       │
│      ▼                                                                       │
│   4. User authenticates with Zitadel                                         │
│      │                                                                       │
│      ▼                                                                       │
│   5. Zitadel redirects to /callback with auth code                           │
│      │                                                                       │
│      ▼                                                                       │
│   6. react-oidc-context exchanges code for tokens                            │
│      │                                                                       │
│      │  ┌─────────────────────────────────────────────────────────────────┐ │
│      │  │  Tokens received:                                                │ │
│      │  │  • access_token (JWT, sent to API)                              │ │
│      │  │  • id_token (user identity)                                      │ │
│      │  │  • refresh_token (for renewal)                                   │ │
│      │  └─────────────────────────────────────────────────────────────────┘ │
│      │                                                                       │
│      ▼                                                                       │
│   7. AuthStateSyncer fetches userinfo from Zitadel                           │
│      │                                                                       │
│      ▼                                                                       │
│   8. User stored in Zustand authStore                                        │
│      │                                                                       │
│      ▼                                                                       │
│   9. App renders authenticated state                                         │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

## API Token Validation

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                      Agent API Auth Middleware                                │
│                                                                              │
│   Request arrives                                                            │
│      │                                                                       │
│      ▼                                                                       │
│   Extract Authorization header                                               │
│      │                                                                       │
│      │  Authorization: Bearer eyJhbGciOiJSUzI1NiIs...                        │
│      │                                                                       │
│      ▼                                                                       │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │  JWT Validation                                                      │   │
│   │                                                                      │   │
│   │  1. Fetch JWKS from Zitadel                                         │   │
│   │     https://auth.rso/oauth/v2/keys                                  │   │
│   │                                                                      │   │
│   │  2. Verify signature using RS256                                     │   │
│   │                                                                      │   │
│   │  3. Check claims:                                                    │   │
│   │     • iss (issuer matches Zitadel)                                  │   │
│   │     • aud (audience matches client ID)                              │   │
│   │     • exp (not expired)                                             │   │
│   │                                                                      │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│      │                                                                       │
│      ▼                                                                       │
│   Set req.user                                                               │
│      │                                                                       │
│      │  req.user = {                                                         │
│      │    id: "user_123",      // from sub claim                            │
│      │    email: "...",                                                      │
│      │    name: "..."                                                        │
│      │  }                                                                    │
│      │                                                                       │
│      ▼                                                                       │
│   Continue to route handler                                                  │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

## Development Bypass (DISABLE_AUTH)

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                      Auth Bypass for Local Dev                                │
│                                                                              │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │  Web App (.env)                                                      │   │
│   │                                                                      │   │
│   │  VITE_DISABLE_AUTH=true                                             │   │
│   │                                                                      │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │  Agent API (environment or docker-compose)                           │   │
│   │                                                                      │   │
│   │  DISABLE_AUTH=true                                                   │   │
│   │                                                                      │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
│                                                                              │
│   When DISABLE_AUTH=true:                                                    │
│                                                                              │
│   ┌───────────────────────────────────────────────────────────────────────┐ │
│   │  Web App                                                               │ │
│   │                                                                        │ │
│   │  ┌─────────────────┐                                                  │ │
│   │  │ DevAuthBypass   │                                                  │ │
│   │  │                 │                                                  │ │
│   │  │ Sets mock user: │                                                  │ │
│   │  │ {               │                                                  │ │
│   │  │   sub: "dev-user",                                                 │ │
│   │  │   name: "Development User",                                        │ │
│   │  │   email: "dev@localhost"                                           │ │
│   │  │ }               │                                                  │ │
│   │  │                 │                                                  │ │
│   │  │ Skips OIDC      │                                                  │ │
│   │  │ provider        │                                                  │ │
│   │  │ entirely        │                                                  │ │
│   │  └─────────────────┘                                                  │ │
│   └───────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
│   ┌───────────────────────────────────────────────────────────────────────┐ │
│   │  Agent API                                                             │ │
│   │                                                                        │ │
│   │  ┌─────────────────┐                                                  │ │
│   │  │ Bypass          │                                                  │ │
│   │  │ Middleware      │                                                  │ │
│   │  │                 │                                                  │ │
│   │  │ Sets req.user:  │                                                  │ │
│   │  │ {               │                                                  │ │
│   │  │   id: "dev-user"│                                                  │ │
│   │  │ }               │                                                  │ │
│   │  │                 │                                                  │ │
│   │  │ No JWT          │                                                  │ │
│   │  │ validation      │                                                  │ │
│   │  └─────────────────┘                                                  │ │
│   └───────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

## Environment Variables

```
┌────────────────────────────────────────────────────────────────────────────┐
│                       Auth Environment Variables                            │
│                                                                            │
│  Web App (VITE_ prefix for Vite)                                           │
│  ─────────────────────────────────────────────────────────────────────────  │
│  VITE_DISABLE_AUTH         │ "true" to bypass auth                         │
│  VITE_ZITADEL_AUTHORITY    │ https://auth.rso                              │
│  VITE_ZITADEL_CLIENT_ID    │ OAuth client ID                               │
│  VITE_ZITADEL_REDIRECT_URI │ http://localhost:61666/callback               │
│                                                                            │
│  Agent API                                                                 │
│  ─────────────────────────────────────────────────────────────────────────  │
│  DISABLE_AUTH              │ "true" to bypass auth                         │
│  ZITADEL_AUTHORITY         │ https://auth.rso                              │
│  ZITADEL_CLIENT_ID         │ OAuth client ID (for audience validation)     │
│                                                                            │
└────────────────────────────────────────────────────────────────────────────┘
```

## Local Development Setup

```
┌──────────────────────────────────────────────────────────────────────────┐
│                    Full Local Dev (No Auth)                               │
│                                                                          │
│   1. Web App - apps/web-app/.env                                         │
│      ┌─────────────────────────────────────────────┐                    │
│      │ VITE_DISABLE_AUTH=true                       │                    │
│      └─────────────────────────────────────────────┘                    │
│                                                                          │
│   2. Agent API - docker-compose.yml or .env                              │
│      ┌─────────────────────────────────────────────┐                    │
│      │ DISABLE_AUTH=true                            │                    │
│      └─────────────────────────────────────────────┘                    │
│                                                                          │
│   3. Start services                                                      │
│      ┌─────────────────────────────────────────────┐                    │
│      │ docker-compose up -d                         │                    │
│      │ pnpm dev                                     │                    │
│      └─────────────────────────────────────────────┘                    │
│                                                                          │
│   Result:                                                                │
│   • App loads directly (no login redirect)                              │
│   • User menu shows "Development User"                                  │
│   • API accepts all requests with mock user                             │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

## Design Decisions

### Why Zitadel?

Many identity providers exist (Auth0, Okta, Keycloak, Firebase Auth). Why Zitadel?

1. **Self-hostable** - We control the infrastructure. No vendor lock-in.
2. **Open source** - Audit the code. No black boxes.
3. **Modern OIDC** - Full OAuth 2.0 / OIDC compliance, PKCE support.
4. **Lightweight** - Single binary, easy to deploy.
5. **Free tier** - Generous limits for small projects.

Alternatives considered:
- **Auth0** - Excellent but expensive at scale, SaaS-only.
- **Keycloak** - Powerful but heavy (Java, complex config).
- **Firebase Auth** - Google lock-in, limited customization.
- **Roll our own** - Security disaster waiting to happen.

### Why PKCE?

PKCE (Proof Key for Code Exchange) protects the OAuth flow from authorization code interception attacks. Even if an attacker captures the auth code, they can't exchange it for tokens without the code verifier.

This is especially important for single-page apps (SPAs) where the client secret can't be kept secret.

### Why JWT Validation on Every Request?

We could cache user sessions, trusting a token once validated. Instead, we validate the JWT on every API request. Why?

1. **Stateless** - The API doesn't need session storage.
2. **Immediate revocation** - Revoking a token at Zitadel immediately invalidates it.
3. **Distributed** - Multiple API instances don't need shared state.

The JWKS (JSON Web Key Set) is cached to avoid fetching public keys on every request. We refresh the cache periodically.

### Why Zustand for Auth State?

The web app stores auth state in Zustand (a lightweight state manager) in addition to `react-oidc-context`. Why the duplication?

1. **Decoupling** - Components don't need to import OIDC-specific hooks.
2. **Persistence** - Zustand can persist across page refreshes.
3. **Enrichment** - We fetch additional userinfo and merge it into the profile.

This creates a slight complexity (two sources of truth) but provides better separation of concerns.

### Why Complete Bypass (Not Mock Server)?

We could run a mock OAuth server locally. Instead, we bypass auth entirely. Why?

1. **Simpler** - No additional services to start.
2. **Faster** - No OAuth dance, even a fast one.
3. **Deterministic** - Same mock user every time.

The trade-off: we're not testing the real auth flow locally. For auth-specific bugs, we test against staging.

## Trade-offs

### Security vs. Developer Experience

Production auth is strict. Development auth is nonexistent. This gap means:

- Auth bugs might not surface until staging/production
- Developers might forget to test with real auth
- Misconfigured bypass in production would be catastrophic

Mitigations:
- Startup validation warns loudly if bypass is enabled without explicit environment
- CI runs tests with both auth modes
- Production deployments enforce auth configuration

### Token Lifetime vs. Security

Short-lived tokens (15 minutes) are more secure but cause frequent refresh flows. Long-lived tokens (hours) are convenient but risky if stolen.

Current balance: 1-hour access tokens with refresh tokens. Refresh tokens are rotated on use.

### Centralized vs. Distributed Auth

Zitadel is a central point of failure. If it's down, no one can log in.

Mitigations:
- Zitadel is highly available (clustered deployment)
- Existing sessions remain valid (JWTs validate locally)
- Graceful degradation for non-auth features

## Source Files

- [`apps/web-app/src/lib/auth/AuthProvider.tsx`](../apps/web-app/src/lib/auth/AuthProvider.tsx) - React auth provider
- [`apps/web-app/src/lib/auth/config.ts`](../apps/web-app/src/lib/auth/config.ts) - OIDC configuration
- [`apps/web-app/src/stores/authStore.ts`](../apps/web-app/src/stores/authStore.ts) - Zustand auth store
- [`apps/agent-api/src/middleware/auth.ts`](../apps/agent-api/src/middleware/auth.ts) - JWT middleware
