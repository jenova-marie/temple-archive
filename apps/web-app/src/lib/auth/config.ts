import type { AuthProviderProps } from 'react-oidc-context'

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

export const oidcConfig: AuthProviderProps = {
  authority: authority,
  client_id: clientId,
  redirect_uri: redirectUri,
  post_logout_redirect_uri: window.location.origin,
  scope,
  response_type: 'code',
  // Handle redirect after successful signin
  // Note: Don't use window.location.replace() immediately - let React handle navigation
  // The callback page will detect successful auth and redirect via TanStack Router
  onSigninCallback: () => {
    const returnUrl = sessionStorage.getItem('auth_return_url') || '/'
    sessionStorage.removeItem('auth_return_url')
    // Store redirect target for callback page to detect
    sessionStorage.setItem('auth_return_after_callback', returnUrl)
  },
  // Public client with PKCE - omit client_authentication and client_secret
  // Library auto-detects and sends client_id in token request
}
