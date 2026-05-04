/**
 * Auth0 Device Authorization Grant for the CLI
 *
 * https://auth0.com/docs/get-started/authentication-and-authorization-flow/device-authorization-flow
 *
 * Flow:
 *   1. POST {issuer}/oauth/device/code → device_code, user_code, verification_uri
 *   2. User visits verification_uri and enters user_code (CLI optionally opens it)
 *   3. CLI polls {issuer}/oauth/token until success or device_code expires
 *   4. On success, store tokens; refresh transparently when access_token expires
 */

import { Buffer } from 'node:buffer'
import { clearAuth, getAuth, setAuth, type AuthTokens } from './config.js'

/**
 * Debug logging — gated behind SIRI_DEBUG_AUTH=1 or DEBUG=siri:auth.
 * Writes to stderr so stdout JSON output stays clean when the CLI is
 * piped. Tokens, device codes, and refresh tokens are redacted to
 * tail-4 characters.
 */
const DEBUG_AUTH =
  process.env.SIRI_DEBUG_AUTH === '1' ||
  process.env.SIRI_DEBUG_AUTH === 'true' ||
  (process.env.DEBUG?.split(/[\s,]+/).includes('siri:auth') ?? false)

function debug(label: string, data?: Record<string, unknown>): void {
  if (!DEBUG_AUTH) return
  const payload = data ? ' ' + JSON.stringify(data) : ''
  process.stderr.write(`[auth] ${label}${payload}\n`)
}

/** Redact a secret to its last 4 characters with a length hint. */
function redact(secret: string | null | undefined): string {
  if (!secret) return '<none>'
  if (secret.length <= 4) return `<${secret.length}ch>`
  return `…${secret.slice(-4)} (${secret.length}ch)`
}

export interface AuthConfig {
  issuer: string
  clientId: string
  audience: string
  scope: string
}

export const AUTH_CONFIG: AuthConfig = {
  issuer:
    process.env.SIRI_AUTH0_ISSUER ?? 'https://templeofinannaslight.us.auth0.com',
  clientId:
    process.env.SIRI_AUTH0_CLIENT_ID ?? 'PDvBSpCfuVAszgyWgw762IBGkAA7sfpe',
  audience:
    process.env.SIRI_AUTH0_AUDIENCE ?? 'https://pippa.intra.recoverysky.net',
  // `offline_access` is what gets us the refresh_token.
  scope: process.env.SIRI_AUTH0_SCOPE ?? 'openid profile email offline_access',
}

debug('AUTH_CONFIG resolved', {
  issuer: AUTH_CONFIG.issuer,
  clientId: AUTH_CONFIG.clientId,
  audience: AUTH_CONFIG.audience,
  scope: AUTH_CONFIG.scope,
  envOverrides: {
    SIRI_AUTH0_ISSUER: !!process.env.SIRI_AUTH0_ISSUER,
    SIRI_AUTH0_CLIENT_ID: !!process.env.SIRI_AUTH0_CLIENT_ID,
    SIRI_AUTH0_AUDIENCE: !!process.env.SIRI_AUTH0_AUDIENCE,
    SIRI_AUTH0_SCOPE: !!process.env.SIRI_AUTH0_SCOPE,
  },
})

export interface DeviceCodeResponse {
  device_code: string
  user_code: string
  verification_uri: string
  verification_uri_complete: string
  expires_in: number
  interval: number
}

interface TokenResponse {
  access_token: string
  refresh_token?: string
  id_token?: string
  token_type: string
  expires_in: number
  scope?: string
}

interface TokenErrorResponse {
  error: string
  error_description?: string
}

function tokenUrl(): string {
  return `${AUTH_CONFIG.issuer.replace(/\/$/, '')}/oauth/token`
}

function deviceCodeUrl(): string {
  return `${AUTH_CONFIG.issuer.replace(/\/$/, '')}/oauth/device/code`
}

/**
 * Step 1: ask Auth0 for a device code that the user will type into the
 * verification URL on whatever device has a browser handy.
 */
export async function requestDeviceCode(): Promise<DeviceCodeResponse> {
  const url = deviceCodeUrl()
  const body = new URLSearchParams({
    client_id: AUTH_CONFIG.clientId,
    audience: AUTH_CONFIG.audience,
    scope: AUTH_CONFIG.scope,
  })

  debug('requestDeviceCode → POST', {
    url,
    clientId: AUTH_CONFIG.clientId,
    audience: AUTH_CONFIG.audience,
    scope: AUTH_CONFIG.scope,
  })

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })

  if (!response.ok) {
    const text = await response.text()
    debug('requestDeviceCode ← error', { status: response.status, body: text })
    throw new Error(
      `Device code request failed (${response.status}): ${text}`,
    )
  }

  const json = (await response.json()) as DeviceCodeResponse
  debug('requestDeviceCode ← ok', {
    status: response.status,
    user_code: json.user_code,
    verification_uri: json.verification_uri,
    verification_uri_complete: json.verification_uri_complete,
    device_code: redact(json.device_code),
    expires_in: json.expires_in,
    interval: json.interval,
  })
  return json
}

export interface PollOptions {
  /** Called every poll attempt while still pending. Useful for spinner. */
  onTick?: () => void
  /** AbortSignal for cancellation (e.g. Ctrl-C). */
  signal?: AbortSignal
}

/**
 * Step 2: poll the token endpoint until the user authorizes or the device
 * code expires. Honors `slow_down` (back off by 5s, per RFC 8628 §3.5).
 */
export async function pollForToken(
  device: DeviceCodeResponse,
  options: PollOptions = {},
): Promise<AuthTokens> {
  let intervalSec = device.interval
  const deadline = Date.now() + device.expires_in * 1000
  let attempt = 0

  debug('pollForToken → start', {
    intervalSec,
    expires_in: device.expires_in,
    deadline: new Date(deadline).toISOString(),
  })

  while (Date.now() < deadline) {
    if (options.signal?.aborted) throw new Error('Login cancelled')
    options.onTick?.()

    await sleep(intervalSec * 1000, options.signal)
    attempt += 1

    const body = new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      device_code: device.device_code,
      client_id: AUTH_CONFIG.clientId,
    })

    debug('pollForToken → POST', {
      attempt,
      intervalSec,
      remainingMs: deadline - Date.now(),
    })

    const response = await fetch(tokenUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    })

    if (response.ok) {
      const token = (await response.json()) as TokenResponse
      debug('pollForToken ← success', {
        attempt,
        status: response.status,
        token_type: token.token_type,
        expires_in: token.expires_in,
        scope: token.scope,
        hasIdToken: !!token.id_token,
        hasRefreshToken: !!token.refresh_token,
        accessToken: redact(token.access_token),
      })
      return tokensFromResponse(token)
    }

    const error = (await response.json().catch(() => null)) as
      | TokenErrorResponse
      | null

    if (!error) {
      debug('pollForToken ← non-JSON error', {
        attempt,
        status: response.status,
      })
      throw new Error(`Token poll failed (${response.status})`)
    }

    debug('pollForToken ← error', {
      attempt,
      status: response.status,
      error: error.error,
      description: error.error_description,
    })

    switch (error.error) {
      case 'authorization_pending':
        continue
      case 'slow_down':
        // Per RFC 8628: increase polling interval by 5s.
        intervalSec += 5
        debug('pollForToken slow_down → bumped interval', { intervalSec })
        continue
      case 'expired_token':
        throw new Error('Device code expired before authorization completed')
      case 'access_denied':
        throw new Error('Authorization denied')
      default:
        throw new Error(
          `Token poll failed: ${error.error}${
            error.error_description ? ` — ${error.error_description}` : ''
          }`,
        )
    }
  }

  throw new Error('Device code expired before authorization completed')
}

/**
 * Persist the freshly issued tokens. Returns the stored bundle.
 */
export function persistTokens(tokens: AuthTokens): AuthTokens {
  setAuth(tokens)
  return tokens
}

/**
 * Convert a raw Auth0 token response into the shape we store on disk.
 * Caches the JWT payload so `whoami` doesn't need a network call.
 */
function tokensFromResponse(response: TokenResponse): AuthTokens {
  const tokens: AuthTokens = {
    accessToken: response.access_token,
    refreshToken: response.refresh_token ?? null,
    expiresAt: Date.now() + response.expires_in * 1000,
    claims: decodeJwtClaims(response.id_token ?? response.access_token),
  }
  debug('tokensFromResponse', {
    expiresAt: new Date(tokens.expiresAt).toISOString(),
    hasRefreshToken: !!tokens.refreshToken,
    refreshToken: redact(tokens.refreshToken),
    claimKeys: tokens.claims ? Object.keys(tokens.claims) : null,
    sub: tokens.claims?.sub,
    aud: tokens.claims?.aud,
    iss: tokens.claims?.iss,
  })
  return tokens
}

/**
 * Decode the payload segment of a JWT (no signature verification — that's
 * the API server's job). Returns null if the token is malformed.
 */
export function decodeJwtClaims(jwt: string): Record<string, unknown> | null {
  const parts = jwt.split('.')
  if (parts.length !== 3) return null
  try {
    const payload = parts[1]!.replace(/-/g, '+').replace(/_/g, '/')
    const padded = payload + '='.repeat((4 - (payload.length % 4)) % 4)
    const json = Buffer.from(padded, 'base64').toString('utf8')
    return JSON.parse(json) as Record<string, unknown>
  } catch {
    return null
  }
}

/**
 * Refresh an expired access token using the refresh token. Throws if no
 * refresh token is available (caller should prompt for re-login).
 */
export async function refreshAccessToken(): Promise<AuthTokens> {
  const current = getAuth()
  if (!current?.refreshToken) {
    debug('refreshAccessToken → no refresh token in store')
    throw new Error('No refresh token available — run `siri login` again')
  }

  debug('refreshAccessToken → POST', {
    url: tokenUrl(),
    clientId: AUTH_CONFIG.clientId,
    refreshToken: redact(current.refreshToken),
    currentExpiresAt: new Date(current.expiresAt).toISOString(),
    nowMs: Date.now(),
  })

  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: AUTH_CONFIG.clientId,
    refresh_token: current.refreshToken,
  })

  const response = await fetch(tokenUrl(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })

  if (!response.ok) {
    const text = await response.text()
    debug('refreshAccessToken ← error', { status: response.status, body: text })
    throw new Error(`Token refresh failed (${response.status}): ${text}`)
  }

  const token = (await response.json()) as TokenResponse
  // Auth0 may rotate refresh tokens; preserve the old one if a new one
  // isn't issued so we don't lose the ability to refresh later.
  const refreshed: AuthTokens = {
    ...tokensFromResponse(token),
    refreshToken: token.refresh_token ?? current.refreshToken,
  }
  debug('refreshAccessToken ← ok', {
    status: response.status,
    rotatedRefreshToken: !!token.refresh_token,
    newExpiresAt: new Date(refreshed.expiresAt).toISOString(),
  })
  setAuth(refreshed)
  return refreshed
}

/**
 * Returns a non-expired access token, refreshing transparently when needed.
 * Throws if there's no stored token at all.
 *
 * The 30s skew accounts for clock drift and request-in-flight latency.
 */
export async function getAccessToken(): Promise<string> {
  const current = getAuth()
  if (!current) {
    debug('getAccessToken → no stored auth')
    throw new Error('Not logged in — run `siri login` first')
  }

  const skewMs = 30_000
  const remainingMs = current.expiresAt - Date.now()
  if (remainingMs - skewMs > 0) {
    debug('getAccessToken → cache hit', {
      remainingMs,
      expiresAt: new Date(current.expiresAt).toISOString(),
      accessToken: redact(current.accessToken),
    })
    return current.accessToken
  }

  debug('getAccessToken → cache miss (expired or within skew)', {
    remainingMs,
    skewMs,
    hasRefreshToken: !!current.refreshToken,
  })

  if (!current.refreshToken) {
    throw new Error('Session expired — run `siri login` again')
  }

  const refreshed = await refreshAccessToken()
  return refreshed.accessToken
}

export function logout(): void {
  debug('logout → clearing stored auth')
  clearAuth()
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error('Login cancelled'))
    const timer = setTimeout(() => resolve(), ms)
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        reject(new Error('Login cancelled'))
      },
      { once: true },
    )
  })
}
