import type { AuthProviderProps } from 'react-oidc-context'

// Check if auth is disabled
export const isAuthEnabled = import.meta.env.VITE_DISABLE_AUTH !== 'true'

// Get auth config variables
const authority = import.meta.env.VITE_ZITADEL_AUTHORITY
const clientId = import.meta.env.VITE_ZITADEL_CLIENT_ID
const redirectUri = import.meta.env.VITE_ZITADEL_REDIRECT_URI
const projectId = import.meta.env.VITE_ZITADEL_PROJECT_ID

// Build scope with optional project ID for JWT access tokens
const baseScopes = 'openid profile email offline_access'
const scope = projectId
  ? `${baseScopes} urn:zitadel:iam:org:project:id:${projectId}:aud`
  : baseScopes

// Debug: Log the auth configuration
console.log('[Auth Config] Auth enabled:', isAuthEnabled)
if (isAuthEnabled) {
  console.log('[Auth Config] Authority:', authority || '(not set)')
  console.log('[Auth Config] Client ID:', clientId || '(not set)')
  console.log('[Auth Config] Project ID:', projectId || '(not set)')
  console.log('[Auth Config] Scope:', scope)
}

export const oidcConfig: AuthProviderProps = {
  authority: authority || 'https://dummy.local',
  client_id: clientId || 'dummy',
  redirect_uri: redirectUri || window.location.origin,
  post_logout_redirect_uri: window.location.origin,
  scope,
  // Handle redirect after successful signin
  onSigninCallback: () => {
    const returnUrl = sessionStorage.getItem('auth_return_url') || '/'
    sessionStorage.removeItem('auth_return_url')
    window.location.replace(returnUrl)
  },
  // Public client settings (no client secret, uses PKCE)
  client_authentication: 'client_secret_post',
}
