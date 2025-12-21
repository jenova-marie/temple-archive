import type { AuthProviderProps } from 'react-oidc-context'

// Build scope with optional project ID for JWT access tokens
const baseScopes = 'openid profile email offline_access'
const projectId = import.meta.env.VITE_ZITADEL_PROJECT_ID
const scope = projectId
  ? `${baseScopes} urn:zitadel:iam:org:project:id:${projectId}:aud`
  : baseScopes

// Debug: Log the configured scope
console.log('[Auth Config] Project ID:', projectId || '(not set)')
console.log('[Auth Config] Scope:', scope)

export const oidcConfig: AuthProviderProps = {
  authority: import.meta.env.VITE_ZITADEL_AUTHORITY,
  client_id: import.meta.env.VITE_ZITADEL_CLIENT_ID,
  redirect_uri: import.meta.env.VITE_ZITADEL_REDIRECT_URI,
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
