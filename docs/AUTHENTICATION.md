# Authentication

Siri uses Auth0 for OIDC authentication, with a bypass mode for local development.

## The Problem

Siri stores personal, sensitive data — conversations about mental health, relationships, struggles. This data must be protected. Only the right user should see their conversations with Siri.

Authentication answers "who is making this request?" Without it, anyone with the URL could access anyone's data. With weak auth, attackers could impersonate users, steal tokens, or hijack sessions.

But authentication is also friction. Every login flow is a barrier to entry. Every expired token is a broken session. Every misconfigured redirect is a support ticket. We need security without making the app unusable.

For development, auth is often pure overhead. You're iterating on features, not testing login flows. Requiring real auth for local dev slows everyone down.

## The Idea

Use a battle-tested identity platform (Auth0) for production, with a complete bypass for development.

**Production**: Auth0 handles password storage, session management, token issuance, refresh flows, PKCE, JWKS rotation, MFA. We delegate trust to a system built for this purpose.

**Development**: Set `DISABLE_AUTH=true` and skip auth entirely. A mock user is injected, allowing full functionality without touching Auth0.

This separation means:
- Production security doesn't compromise developer experience
- Local testing doesn't require infrastructure setup
- Auth bugs are isolated to the auth layer, not scattered throughout the codebase

The web-app uses `@auth0/auth0-react` to manage the OAuth flow. The agent-api and web-api validate JWTs using Auth0's published JWKS. Both check the bypass flag and short-circuit when disabled.

## Architecture Overview

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                            Auth Architecture                                  │
│                                                                              │
│   ┌────────────────────────────────────────────────────────────────────────┐ │
│   │                              Web App                                    │ │
│   │                                                                         │ │
│   │   ┌──────────────┐         ┌──────────────┐         ┌──────────────┐   │ │
│   │   │ AuthProvider │ ──────▶ │    Auth0     │ ──────▶ │  authStore   │   │ │
│   │   │ (auth0-react)│ ◀────── │ Universal    │         │  (Zustand)   │   │ │
│   │   └──────────────┘         │   Login      │         └──────────────┘   │ │
│   │                            └──────────────┘                            │ │
│   │   Access token attached to all API requests                            │ │
│   └────────────────────────────────────┬───────────────────────────────────┘ │
│                                        │                                      │
│                                        │ Authorization: Bearer <token>        │
│                                        ▼                                      │
│   ┌────────────────────────────────────────────────────────────────────────┐ │
│   │                            Agent API / Web API                          │ │
│   │                                                                         │ │
│   │   ┌──────────────┐         ┌──────────────┐         ┌──────────────┐   │ │
│   │   │ Auth         │ ──────▶ │  Auth0       │ ──────▶ │  req.user    │   │ │
│   │   │ Middleware   │         │  JWKS        │         │ { id, ... }  │   │ │
│   │   │ (jose)       │         │  Validation  │         │              │   │ │
│   │   └──────────────┘         └──────────────┘         └──────────────┘   │ │
│   └────────────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────────────┘
```

## Auth0 Tenant Setup

Before deploying with auth enabled, create the resources in the Auth0 dashboard:

1. **Create API**
   - Name: `Siri API`
   - Identifier (audience): `https://api.siri.app` *(this is just a unique URL — does not need to resolve)*
   - Signing Algorithm: `RS256`
   - Enable RBAC: **on**
   - Add Permissions in the Access Token: **on**

2. **Define permissions** (start small)
   - `admin`

3. **Define roles**
   - `admin` → grants the `admin` permission

4. **Create SPA application**
   - Name: `Siri Web App`
   - Application Type: `Single Page Application`
   - Allowed Callback URLs: `http://localhost:5173/callback,https://your-prod-domain/callback`
   - Allowed Logout URLs: `http://localhost:5173,https://your-prod-domain`
   - Allowed Web Origins: same as callback URLs (without `/callback`)

5. **Assign your user a role** (Users → select user → Roles → assign `admin`)

6. **Create an Action that injects roles into tokens**
   - Library → Actions → Custom → Build Custom Action → Trigger: Login / Post Login
   - Code:
     ```js
     exports.onExecutePostLogin = async (event, api) => {
       const namespace = 'https://siri.app/';
       if (event.authorization) {
         api.idToken.setCustomClaim(`${namespace}roles`, event.authorization.roles);
         api.accessToken.setCustomClaim(`${namespace}roles`, event.authorization.roles);
       }
     };
     ```
   - Deploy the Action and add it to the Login flow.

After this is done, an access token issued for the SPA → API will contain a `https://siri.app/roles` claim with the user's roles.

## Production Flow (OIDC with Auth0)

```
1. User visits app
   └─▶ AuthProvider checks for existing session (cached in localStorage)
2. No session → redirect to Auth0 Universal Login
   https://your-tenant.us.auth0.com/authorize
     ?client_id=...
     &redirect_uri=.../callback
     &audience=https://api.siri.app
     &scope=openid profile email offline_access
     &response_type=code
     &code_challenge=...                       (PKCE)
3. User authenticates with Auth0
4. Auth0 redirects back to /callback with the auth code
5. @auth0/auth0-react exchanges the code for tokens
   └─▶ access_token (JWT, sent to API)
   └─▶ id_token (user identity claims)
   └─▶ refresh_token (renewal — `useRefreshTokens: true`)
6. AuthStateSyncer pushes the user + access token into Zustand
7. App reads from authStore for any subsequent API call
   Authorization: Bearer <access_token>
8. Backend verifies the JWT against Auth0's JWKS
   └─▶ jose.createRemoteJWKSet(`https://your-tenant.us.auth0.com/.well-known/jwks.json`)
   └─▶ checks issuer, audience, signature, expiry
9. Roles extracted from `https://siri.app/roles` claim → req.user.roles
```

## Development Flow (Bypass)

When `DISABLE_AUTH=true` (backend) or `VITE_DISABLE_AUTH=true` (frontend):

- The web-app skips `Auth0Provider` entirely and injects a mock dev user into the auth store.
- Backends inject a hardcoded dev user into `req.user` on every request, with `roles: ['admin']`.
- The agent-api also honors an `X-User-Id` header to let CLI tools target a specific user.

No tokens are validated, no JWKS is fetched, no Auth0 traffic is generated.

## Configuration

### Backend env vars

| Variable | Purpose |
|---|---|
| `AUTH0_ISSUER_BASE_URL` | Tenant URL with trailing slash, e.g. `https://your-tenant.us.auth0.com/` |
| `AUTH0_AUDIENCE` | API identifier from the Auth0 dashboard, e.g. `https://api.siri.app` |
| `AUTH0_CLIENT_ID` | SPA client ID (used by web-api env validation; not strictly required by the JWT verifier) |
| `DISABLE_AUTH` | Set to `true` to bypass JWT verification entirely |

### Frontend env vars (Vite)

| Variable | Purpose |
|---|---|
| `VITE_AUTH0_DOMAIN` | Tenant domain without protocol, e.g. `your-tenant.us.auth0.com` |
| `VITE_AUTH0_CLIENT_ID` | SPA client ID |
| `VITE_AUTH0_AUDIENCE` | Same as backend `AUTH0_AUDIENCE` — required so access tokens are issued for the API, not just the SPA |
| `VITE_DISABLE_AUTH` | Set to `true` to bypass Auth0 in the SPA and inject a mock dev user |

## Roles and Permissions

Roles are read from a namespaced custom claim, **not** from Auth0's standard `permissions` claim. Auth0 requires custom claims to use a non-Auth0 domain as a namespace; we use `https://siri.app/` (the URL doesn't need to resolve — it's just a unique identifier).

```ts
// Backend (apps/agent-api/src/middleware/auth.ts)
const ROLES_CLAIM = "https://siri.app/roles";

function extractRoles(claims: Auth0Claims): string[] {
  const roles = claims[ROLES_CLAIM];
  return Array.isArray(roles) ? roles : [];
}
```

To add a new role:
1. Define it in Auth0 Dashboard → Roles
2. Assign it to users in Dashboard → Users
3. Reference it in code via `auth.requireRole('your-role')`

Permissions (the standard `permissions` array claim) are also available on the JWT and could be checked separately if you'd rather gate routes on permissions than on roles.

## Token Lifetime

Auth0 access tokens default to a 24-hour TTL (configurable per API in the dashboard). The web-app uses `useRefreshTokens: true` and `cacheLocation: 'localstorage'`, so the SPA seamlessly refreshes silently in the background and survives full-page reloads.

## Key Implementation Files

- `apps/agent-api/src/middleware/auth.ts` — Express JWT middleware
- `apps/web-api/src/plugins/auth.ts` — Fastify JWT plugin
- `apps/web-app/src/lib/auth/AuthProvider.tsx` — React `Auth0Provider` wrapper + `useAuth()` hook
- `apps/web-app/src/stores/authStore.ts` — Zustand store mirroring the auth state
- `packages/config/src/schema.ts` — `auth.auth0` config schema
