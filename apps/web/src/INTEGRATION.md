# Integrating Zoom SDK Hooks into Your React App

This guide explains how to transform an existing React application into a Zoom App using the modular hooks from this repository.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Architecture Overview](#architecture-overview)
- [Dual Execution Mode](#dual-execution-mode) ← Run in Zoom AND regular browsers
- [Quick Start](#quick-start)
- [Integration Tiers](#integration-tiers)
- [Backend Requirements](#backend-requirements)
- [Environment Variables](#environment-variables)
- [Docker Compose Setup](#docker-compose-setup)
- [Zoom Marketplace Configuration](#zoom-marketplace-configuration)
- [Troubleshooting](#troubleshooting)

---

## Prerequisites

Before you begin, ensure you have:

1. **A Zoom Marketplace App** - Create one at [marketplace.zoom.us](https://marketplace.zoom.us)
2. **A Backend Server** - Zoom Apps require a backend for OAuth token exchange (see [Backend Requirements](#backend-requirements))
3. **Redis** - For session and token storage
4. **ngrok or similar** - For local development with HTTPS tunneling

---

## Architecture Overview

A functioning Zoom App requires a **frontend + backend + Redis** architecture:

```
┌─────────────────────────────────────────────────────────────────────┐
│                         ZOOM CLIENT                                  │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                    Your Zoom App                              │   │
│  │   (React frontend running in Zoom's embedded browser)        │   │
│  └───────────────────────────┬─────────────────────────────────┘   │
└──────────────────────────────┼──────────────────────────────────────┘
                               │ HTTPS (ngrok)
                               ▼
┌──────────────────────────────────────────────────────────────────────┐
│                        YOUR INFRASTRUCTURE                            │
│                                                                       │
│  ┌────────────────┐    proxy    ┌────────────────┐                  │
│  │    Backend     │◄───────────►│    Frontend    │                  │
│  │  (Port 3000)   │             │   (Port 9090)  │                  │
│  │                │             │                │                  │
│  │  • OAuth       │             │  • React App   │                  │
│  │  • Sessions    │             │  • Zoom SDK    │                  │
│  │  • API Proxy   │             │  • Hooks       │                  │
│  └───────┬────────┘             └────────────────┘                  │
│          │                                                           │
│          │ tokens/sessions                                           │
│          ▼                                                           │
│  ┌────────────────┐                                                 │
│  │     Redis      │                                                 │
│  │  (Port 6379)   │                                                 │
│  └────────────────┘                                                 │
│                                                                       │
└──────────────────────────────────────────────────────────────────────┘
```

### Port Assignments

| Service | Internal Port | External (localhost) | Purpose |
|---------|---------------|---------------------|---------|
| Backend | 3000 | 8000 | OAuth, sessions, API proxy |
| Frontend | 9090 | 3001 | React dev server |
| Redis | 6379 | 6379 | Token/session storage |
| ngrok | - | 443 | HTTPS tunnel to backend |

### Request Flow

1. **User opens app in Zoom** → Zoom requests `https://your-ngrok.io/api/zoomapp/home`
2. **Backend decrypts context** → Extracts user ID from `x-zoom-app-context` header
3. **Backend redirects** → `/api/zoomapp/proxy` → proxies to frontend on port 9090
4. **Frontend loads** → React app initializes, calls `zoomSdk.config()`
5. **User authorizes** → Frontend calls `/api/zoomapp/authorize` → OAuth flow
6. **API calls** → Frontend calls `/zoom/api/v2/*` → Backend proxies to Zoom with tokens

---

## Dual Execution Mode

You can build a React app that runs **both inside Zoom and in a regular web browser**. This is useful for:

- Developing/testing without Zoom
- Providing a web-based version of your app
- Progressive enhancement (basic features outside Zoom, full features inside)

### How It Works

The Zoom SDK (`zoomSdk`) is only available when running inside Zoom's embedded browser. The hooks detect this and provide fallback behavior:

```
┌─────────────────────────────────────────────────────────────────┐
│                     YOUR REACT APP                               │
│                                                                  │
│  ┌──────────────────────┐    ┌──────────────────────┐          │
│  │   Running in Zoom    │    │  Running in Browser  │          │
│  │                      │    │                      │          │
│  │  zoomSdk = ✓         │    │  zoomSdk = undefined │          │
│  │  Full functionality  │    │  Graceful fallback   │          │
│  │  SDK features work   │    │  Web-only features   │          │
│  └──────────────────────┘    └──────────────────────┘          │
│                                                                  │
│              useZoomApp() detects environment                    │
│              and returns appropriate state                       │
└─────────────────────────────────────────────────────────────────┘
```

### Detection Helper

Create a utility to detect the Zoom environment:

```javascript
// src/utils/zoomDetect.js

/**
 * Check if running inside Zoom's embedded browser
 */
export function isInsideZoom() {
  return typeof window !== 'undefined' && typeof window.zoomSdk !== 'undefined'
}

/**
 * Check if the Zoom SDK script is loaded
 */
export function isZoomSdkLoaded() {
  return typeof zoomSdk !== 'undefined'
}
```

### Modified Hooks for Dual Execution

Wrap the existing hooks to handle non-Zoom environments:

```javascript
// src/hooks/useZoomAppSafe.js
import { useState, useEffect } from 'react'
import { isInsideZoom } from '../utils/zoomDetect'

// Import the real hook
import { useZoomApp as useZoomAppReal } from './useZoomApp'

/**
 * Safe wrapper for useZoomApp that works outside Zoom
 */
export function useZoomApp(capabilities = [], options = {}) {
  const [isZoom, setIsZoom] = useState(false)

  useEffect(() => {
    setIsZoom(isInsideZoom())
  }, [])

  // Use the real hook when inside Zoom
  const zoomState = useZoomAppReal(
    isZoom ? capabilities : [],
    isZoom ? options : { autoReconfigure: false }
  )

  // Return fallback state when outside Zoom
  if (!isZoom) {
    return {
      // State
      configured: true,        // Pretend we're configured
      runningContext: 'browser', // Custom context for web
      userContextStatus: null,
      error: null,

      // Methods
      reconfigure: () => {},

      // Helpers
      isInMeeting: false,
      isInClient: false,
      isAuthorized: false,
      isGuest: false,
      isInZoom: false,         // NEW: indicates Zoom environment
      isInBrowser: true,       // NEW: indicates browser environment
    }
  }

  return {
    ...zoomState,
    isInZoom: true,
    isInBrowser: false,
  }
}
```

```javascript
// src/hooks/useZoomAuthSafe.js
import { isInsideZoom } from '../utils/zoomDetect'
import { useZoomAuth as useZoomAuthReal } from './useZoomAuth'

/**
 * Safe wrapper for useZoomAuth that works outside Zoom
 */
export function useZoomAuth(options = {}) {
  const isZoom = isInsideZoom()

  // Use real hook inside Zoom
  const zoomAuth = useZoomAuthReal(isZoom ? options : {})

  if (!isZoom) {
    return {
      // State
      isAuthorized: false,
      isGuest: false,
      userContextStatus: null,
      error: null,
      isAuthorizing: false,

      // Methods - no-ops outside Zoom
      authorize: async () => {
        console.warn('authorize() called outside Zoom - no-op')
        return false
      },
      promptAuthorize: async () => {
        console.warn('promptAuthorize() called outside Zoom - no-op')
        return false
      },
      startAuth: async () => {
        console.warn('startAuth() called outside Zoom - no-op')
        return false
      },

      // Helpers
      isInZoom: false,
    }
  }

  return { ...zoomAuth, isInZoom: true }
}
```

```javascript
// src/hooks/useZoomConnectSafe.js
import { isInsideZoom } from '../utils/zoomDetect'
import { useZoomConnect as useZoomConnectReal } from './useZoomConnect'

/**
 * Safe wrapper for useZoomConnect that works outside Zoom
 */
export function useZoomConnect(runningContext, options = {}) {
  const isZoom = isInsideZoom()

  const zoomConnect = useZoomConnectReal(
    isZoom ? runningContext : null,
    isZoom ? options : {}
  )

  if (!isZoom) {
    return {
      // State
      connected: false,
      lastMessage: null,
      error: null,

      // Methods
      sendMessage: async (payload) => {
        console.warn('sendMessage() called outside Zoom - no-op', payload)
        return false
      },

      // Helpers
      isInMeeting: false,
      isInClient: false,
      canSendMessage: false,
      isInZoom: false,
    }
  }

  return { ...zoomConnect, isInZoom: true }
}
```

### Safe API Utilities

```javascript
// src/utils/zoomApiSafe.js
import { isInsideZoom } from './zoomDetect'
import * as zoomApi from './zoomApi'

/**
 * Wrap any Zoom API call to be safe outside Zoom
 */
export async function callZoomApiSafe(apiName, options = null) {
  if (!isInsideZoom()) {
    console.warn(`${apiName}() called outside Zoom - returning mock response`)
    return {
      success: false,
      error: new Error('Not running inside Zoom'),
      isInZoom: false,
    }
  }
  return zoomApi.callZoomApi(apiName, options)
}

// Safe versions of all utilities
export async function showNotification(title, message, type = 'info') {
  if (!isInsideZoom()) {
    // Fallback: use browser notification or console
    console.log(`[Zoom Notification] ${title}: ${message}`)
    if (Notification.permission === 'granted') {
      new Notification(title, { body: message })
    }
    return { success: true, isInZoom: false }
  }
  return zoomApi.showNotification(title, message, type)
}

export async function openUrl(url) {
  if (!isInsideZoom()) {
    // Fallback: open in new tab
    window.open(url, '_blank')
    return { success: true, isInZoom: false }
  }
  return zoomApi.openUrl(url)
}

// Export all others with safety wrapper
export const getMeetingContext = () => callZoomApiSafe('getMeetingContext')
export const getRunningContext = () => callZoomApiSafe('getRunningContext')
export const getMeetingParticipants = () => callZoomApiSafe('getMeetingParticipants')
// ... etc
```

### Updated Barrel Exports

```javascript
// src/hooks/index.js
// Export both safe and original versions

// Safe versions (recommended for dual-execution apps)
export { useZoomApp } from './useZoomAppSafe'
export { useZoomAuth } from './useZoomAuthSafe'
export { useZoomConnect } from './useZoomConnectSafe'

// Original versions (for Zoom-only apps)
export { useZoomApp as useZoomAppStrict } from './useZoomApp'
export { useZoomAuth as useZoomAuthStrict } from './useZoomAuth'
export { useZoomConnect as useZoomConnectStrict } from './useZoomConnect'
```

### Complete Dual-Execution Example

```javascript
import { useZoomApp, useZoomAuth } from './hooks'
import { showNotification, openUrl } from './utils/zoomApiSafe'

function App() {
  const {
    configured,
    runningContext,
    isInZoom,
    isInBrowser,
  } = useZoomApp([
    'getSupportedJsApis',
    'showNotification',
    'openUrl',
  ])

  const { isAuthorized, startAuth } = useZoomAuth({
    onAuthorized: () => console.log('Authorized!'),
  })

  const handleNotify = async () => {
    await showNotification('Hello', 'This works in both environments!')
  }

  const handleOpenDocs = async () => {
    await openUrl('https://developers.zoom.us/docs/')
  }

  return (
    <div>
      <h1>My Hybrid App</h1>

      {/* Environment indicator */}
      <div className="environment-badge">
        {isInZoom ? '🎥 Running in Zoom' : '🌐 Running in Browser'}
      </div>

      <p>Context: {runningContext}</p>

      {/* Features available everywhere */}
      <button onClick={handleNotify}>Show Notification</button>
      <button onClick={handleOpenDocs}>Open Docs</button>

      {/* Zoom-only features */}
      {isInZoom && (
        <div className="zoom-features">
          <h2>Zoom Features</h2>
          {!isAuthorized && (
            <button onClick={startAuth}>Authorize with Zoom</button>
          )}
          {isAuthorized && <p>✓ Authorized</p>}
        </div>
      )}

      {/* Browser-only features */}
      {isInBrowser && (
        <div className="browser-features">
          <h2>Web Features</h2>
          <p>Some features require running inside Zoom.</p>
          <a href="/install">Install Zoom App</a>
        </div>
      )}
    </div>
  )
}
```

### Conditional SDK Script Loading

You can optionally load the SDK only when needed:

```html
<!-- public/index.html -->
<head>
  <script>
    // Only load Zoom SDK if we might be in Zoom
    // (check for Zoom user agent or query param)
    if (
      navigator.userAgent.includes('ZoomWebKit') ||
      window.location.search.includes('source=zoom')
    ) {
      var script = document.createElement('script');
      script.src = 'https://appssdk.zoom.us/sdk.min.js';
      document.head.appendChild(script);
    }
  </script>
</head>
```

Or always load it (simpler, minimal overhead):

```html
<head>
  <script src="https://appssdk.zoom.us/sdk.min.js"></script>
</head>
```

### Testing Dual Execution

```bash
# Test in browser (no Zoom)
npm start
# Open http://localhost:3000 - should show "Running in Browser"

# Test in Zoom
docker compose up
ngrok http 8000
# Open app in Zoom client - should show "Running in Zoom"
```

### Feature Availability Matrix

| Feature | In Zoom | In Browser | Fallback |
|---------|---------|------------|----------|
| `useZoomApp` | Full SDK config | Mock state | `runningContext: 'browser'` |
| `useZoomAuth` | OAuth flow | No-op | Returns `isAuthorized: false` |
| `useZoomConnect` | Cross-instance | No-op | Returns `connected: false` |
| `showNotification` | Zoom notification | Browser Notification API | Console log |
| `openUrl` | Opens in browser | `window.open()` | Same behavior |
| `getMeetingContext` | Meeting data | Error | `{ success: false }` |
| `cloudRecording` | Controls recording | Error | `{ success: false }` |
| `setVirtualBackground` | Sets background | Error | `{ success: false }` |

### Best Practices for Dual Execution

1. **Always check `isInZoom`** before using Zoom-specific features
2. **Provide meaningful fallbacks** for essential features
3. **Show clear UI indicators** for which environment the user is in
4. **Don't block the app** if Zoom features aren't available
5. **Use feature detection**, not environment detection, where possible
6. **Test in both environments** regularly

---

## Quick Start

### Step 1: Add the Zoom SDK Script

Add the Zoom Apps SDK to your `public/index.html`:

```html
<head>
  <!-- ... other head elements ... -->
  <script src="https://appssdk.zoom.us/sdk.min.js"></script>
</head>
```

### Step 2: Copy the Hooks

Copy these directories to your project:

```
src/
├── hooks/
│   ├── index.js
│   ├── useZoomApp.js
│   ├── useZoomAuth.js
│   └── useZoomConnect.js
└── utils/
    ├── index.js
    └── zoomApi.js
```

### Step 3: Configure ESLint (Optional)

Add the global declaration to files using the SDK:

```javascript
/* globals zoomSdk */
```

Or add to your `.eslintrc`:

```json
{
  "globals": {
    "zoomSdk": "readonly"
  }
}
```

---

## Integration Tiers

Choose which tiers you need based on your app's requirements:

| Tier | Hook/Utility | When to Use |
|------|--------------|-------------|
| 1 | `useZoomApp` | **Always required** - Initializes SDK |
| 2 | `useZoomAuth` | Need Zoom REST API access |
| 3 | `useZoomConnect` | App runs in meetings with cross-instance messaging |
| 4 | `zoomApi` utilities | Calling SDK methods (notifications, recording, etc.) |

---

## Tier 1: Basic Zoom App (Required)

Every Zoom App needs SDK initialization. This is the minimum to run inside Zoom.

### Usage

```javascript
import { useZoomApp } from './hooks'

function App() {
  const { configured, runningContext, error } = useZoomApp([
    'getSupportedJsApis',
    'openUrl',
  ])

  if (error) return <div>Error: {error.message}</div>
  if (!configured) return <div>Loading...</div>

  return (
    <div>
      <h1>My Zoom App</h1>
      <p>Running in: {runningContext}</p>
    </div>
  )
}
```

### API Reference

```typescript
const {
  // State
  configured,        // boolean - SDK successfully initialized
  runningContext,    // 'inMainClient' | 'inMeeting' | 'inWebinar' | etc.
  userContextStatus, // 'authorized' | 'authenticated' | 'unauthenticated'
  error,             // Error | null

  // Methods
  reconfigure,       // () => void - Manually trigger re-configuration

  // Helpers
  isInMeeting,       // boolean - true if runningContext === 'inMeeting'
  isInClient,        // boolean - true if runningContext === 'inMainClient'
  isAuthorized,      // boolean - true if userContextStatus === 'authorized'
  isGuest,           // boolean - true if user is guest/unauthenticated
} = useZoomApp(capabilities, options)
```

### Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `capabilities` | `string[]` | SDK capabilities your app needs (must match Marketplace config) |
| `options.version` | `string` | SDK version (default: `'0.16.0'`) |
| `options.autoReconfigure` | `boolean` | Re-configure before 2-hour timeout (default: `true`) |

### Required Capabilities

Add to your Zoom Marketplace app's "Features" section:

```javascript
const BASIC_CAPABILITIES = [
  'getSupportedJsApis',
  'openUrl',
  'showNotification',
]
```

---

## Tier 2: OAuth for REST API Access

If your app needs to call Zoom REST APIs (get user info, manage meetings, etc.), you need OAuth.

### Usage

```javascript
import { useZoomApp, useZoomAuth } from './hooks'

function App() {
  const { configured, userContextStatus } = useZoomApp(CAPABILITIES)
  const { isAuthorized, isGuest, startAuth, error } = useZoomAuth({
    onAuthorized: () => fetchUserData(),
    onError: (err) => console.error('Auth failed:', err),
  })

  // Trigger auth when status is known but not authorized
  useEffect(() => {
    if (userContextStatus && !isAuthorized) {
      startAuth() // Automatically uses authorize or promptAuthorize
    }
  }, [userContextStatus, isAuthorized])

  if (!isAuthorized) return <div>Authorizing...</div>

  return <div>Welcome, authorized user!</div>
}
```

### API Reference

```typescript
const {
  // State
  isAuthorized,      // boolean - User has completed OAuth
  isGuest,           // boolean - User is a guest
  userContextStatus, // 'authorized' | 'authenticated' | 'unauthenticated'
  error,             // Error | null
  isAuthorizing,     // boolean - OAuth flow in progress

  // Methods
  authorize,         // () => Promise<void> - Start OAuth (for hosts/participants)
  promptAuthorize,   // () => Promise<void> - Start OAuth (for guests)
  startAuth,         // () => Promise<void> - Auto-selects authorize or promptAuthorize
} = useZoomAuth(options)
```

### Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `authorizeEndpoint` | `string` | `'/api/zoomapp/authorize'` | Backend endpoint for PKCE challenge |
| `tokenEndpoint` | `string` | `'/api/zoomapp/onauthorized'` | Backend endpoint for token exchange |
| `onAuthorized` | `function` | - | Callback when auth completes |
| `onError` | `function` | - | Callback when error occurs |

### Required Capabilities

```javascript
const AUTH_CAPABILITIES = [
  'authorize',
  'onAuthorized',
  'promptAuthorize',
  'getUserContext',
  'onMyUserContextChange',
]
```

### Backend Endpoints Required

Your backend must implement these endpoints for `useZoomAuth` to work. See [full Backend Requirements](#backend-requirements) below.

---

## Tier 3: Cross-Instance Messaging

When your app runs in meetings, Zoom creates two instances:
- **Client instance** - In the main Zoom client (sidebar)
- **Meeting instance** - Inside the meeting

Use `useZoomConnect` to communicate between them.

### Usage

```javascript
import { useZoomApp, useZoomConnect } from './hooks'
import { useNavigate } from 'react-router-dom'

function App() {
  const navigate = useNavigate()
  const { configured, runningContext } = useZoomApp(CAPABILITIES)

  const { connected, sendMessage, lastMessage } = useZoomConnect(runningContext, {
    onMessage: (payload) => {
      // Sync navigation between instances
      if (payload.startsWith('/')) {
        navigate(payload)
      }
    },
    onConnected: () => {
      // Send current route to new instance
      sendMessage(window.location.hash)
    },
  })

  return (
    <div>
      <p>Connection: {connected ? 'Connected' : 'Disconnected'}</p>
      <button onClick={() => sendMessage('/settings')}>
        Open Settings (both instances)
      </button>
    </div>
  )
}
```

### API Reference

```typescript
const {
  // State
  connected,         // boolean - Instances are connected
  lastMessage,       // any - Last received message payload
  error,             // Error | null

  // Methods
  sendMessage,       // (payload: any) => Promise<boolean> - Send to other instance

  // Helpers
  isInMeeting,       // boolean - true if in meeting context
  isInClient,        // boolean - true if in client context
  canSendMessage,    // boolean - true if sending is possible
} = useZoomConnect(runningContext, options)
```

### Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `runningContext` | `string` | **required** | From `useZoomApp().runningContext` |
| `onMessage` | `function` | - | Callback when message received |
| `onConnected` | `function` | - | Callback when instances connect |
| `autoSyncState` | `boolean` | `false` | Auto-sync state on connect |
| `getInitialState` | `function` | - | Returns state to sync (used with autoSyncState) |

### Required Capabilities

```javascript
const CONNECT_CAPABILITIES = [
  'connect',
  'onConnect',
  'postMessage',
  'onMessage',
]
```

### Auto State Sync

For automatic state synchronization:

```javascript
const { connected } = useZoomConnect(runningContext, {
  autoSyncState: true,
  getInitialState: () => ({
    currentPage: location.pathname,
    selectedItem: selectedId,
  }),
  onMessage: (state) => {
    // Received state from other instance
    navigate(state.currentPage)
    setSelectedId(state.selectedItem)
  },
})
```

---

## Tier 4: SDK API Utilities

Convenience functions for calling Zoom SDK methods with consistent error handling.

### Usage

```javascript
import { showNotification, openUrl, cloudRecording, callZoomApi } from './utils'

// Show notification
const result = await showNotification('Hello', 'Welcome to the app!', 'info')
if (!result.success) console.error(result.error)

// Open URL
await openUrl('https://zoom.us')

// Control recording
await cloudRecording('start')
await cloudRecording('pause')
await cloudRecording('resume')
await cloudRecording('stop')

// Generic API call
const apis = await callZoomApi('getSupportedJsApis')
console.log(apis.data)
```

### Available Functions

| Function | Description |
|----------|-------------|
| `callZoomApi(name, options)` | Generic wrapper for any SDK method |
| `showNotification(title, message, type)` | Display notification |
| `openUrl(url)` | Open URL in browser |
| `getMeetingContext()` | Get meeting info |
| `getRunningContext()` | Get running context |
| `getMeetingParticipants()` | List participants |
| `getMeetingUUID()` | Get meeting UUID |
| `getMeetingJoinUrl()` | Get join URL |
| `expandApp()` | Expand app panel |
| `setVirtualBackground(fileUrl)` | Set background image |
| `removeVirtualBackground()` | Remove background |
| `cloudRecording(action)` | Control recording |
| `shareApp(action)` | Share app screen |
| `setVideoMirrorEffect(mirror)` | Mirror video |
| `sendAppInvitationToAllParticipants()` | Invite all |
| `showAppInvitationDialog()` | Show invite dialog |
| `getSupportedJsApis()` | List supported APIs |
| `listCameras()` | List cameras |
| `startRTMS()` | Start real-time streaming |
| `stopRTMS()` | Stop real-time streaming |

### Response Format

All functions return:

```typescript
{
  success: boolean
  data?: any    // Present on success
  error?: Error // Present on failure
}
```

---

## Backend Requirements

Your Zoom App needs a backend server that handles OAuth, proxies your frontend, and manages sessions. Below are all required routes and their implementations.

### Required Routes Summary

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/zoomapp/home` | GET | Entry point when app opens in Zoom |
| `/api/zoomapp/proxy` | GET | Proxies requests to frontend dev server |
| `/api/zoomapp/install` | GET | Initiates browser-based OAuth install flow |
| `/api/zoomapp/auth` | GET | OAuth redirect callback from Zoom |
| `/api/zoomapp/authorize` | GET | Returns PKCE challenge for in-client OAuth |
| `/api/zoomapp/onauthorized` | POST | Exchanges auth code for access token |
| `/zoom/api/v2/*` | ALL | Proxies Zoom REST API calls with auth header |

### Route Details

#### GET `/api/zoomapp/home`

**Entry point when user opens your app in Zoom.**

This is the URL configured as "Home URL" in your Zoom Marketplace app. When Zoom opens your app, it sends an encrypted context header.

```javascript
// Express handler
async home(req, res, next) {
  try {
    // 1. Decrypt the x-zoom-app-context header
    const decryptedContext = decryptZoomAppContext(
      req.headers['x-zoom-app-context'],
      process.env.ZOOM_APP_CLIENT_SECRET
    )

    // 2. Verify context is not expired
    if (decryptedContext.exp < Date.now()) {
      throw new Error('x-zoom-app-context header is expired')
    }

    // 3. Store user ID and meeting UUID in session
    req.session.user = decryptedContext.uid
    req.session.meetingUUID = decryptedContext.mid

    // 4. Redirect to frontend proxy
    res.redirect('/api/zoomapp/proxy')
  } catch (error) {
    next(error)
  }
}
```

**Decrypted context contains:**
```javascript
{
  uid: 'zoom-user-id',      // User ID
  mid: 'meeting-uuid',      // Meeting UUID (if in meeting)
  exp: 1234567890000,       // Expiration timestamp
  // ... other fields
}
```

#### GET `/api/zoomapp/proxy`

**Proxies all frontend requests through the backend.**

```javascript
const { createProxyMiddleware } = require('http-proxy-middleware')

// Proxy to frontend dev server
const proxy = createProxyMiddleware({
  target: process.env.ZOOM_APP_CLIENT_URL, // http://frontend:9090
  changeOrigin: true,
  ws: true, // Enable WebSocket proxying for hot reload
})
```

#### GET `/api/zoomapp/authorize`

**Returns PKCE challenge for in-client OAuth (used by `useZoomAuth`).**

```javascript
async inClientAuthorize(req, res, next) {
  try {
    // 1. Generate PKCE code verifier and challenge
    const codeVerifier = crypto.randomBytes(32).toString('base64url')
    const codeChallenge = codeVerifier // For plain method

    // 2. Generate random state
    const state = crypto.randomBytes(32).toString('base64url')

    // 3. Save to session for verification
    req.session.codeVerifier = codeVerifier
    req.session.state = state

    // 4. Return to frontend
    res.json({ codeChallenge, state })
  } catch (error) {
    next(error)
  }
}
```

#### POST `/api/zoomapp/onauthorized`

**Exchanges authorization code for tokens (used by `useZoomAuth`).**

```javascript
async inClientOnAuthorized(req, res, next) {
  const { code, state, href } = req.body
  const sessionState = req.session.state
  const codeVerifier = req.session.codeVerifier

  try {
    // 1. Verify state matches
    if (decodeURIComponent(state) !== sessionState) {
      throw new Error('State mismatch')
    }

    // 2. Exchange code for tokens
    const tokenResponse = await axios.post(
      'https://zoom.us/oauth/token',
      new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: href,
        code_verifier: codeVerifier,
      }),
      {
        headers: {
          Authorization: `Basic ${Buffer.from(
            `${process.env.ZOOM_APP_CLIENT_ID}:${process.env.ZOOM_APP_CLIENT_SECRET}`
          ).toString('base64')}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      }
    )

    // 3. Get user info
    const userResponse = await axios.get('https://api.zoom.us/v2/users/me', {
      headers: { Authorization: `Bearer ${tokenResponse.data.access_token}` },
    })

    // 4. Store tokens in Redis (keyed by user ID)
    await redis.set(`user:${userResponse.data.id}`, JSON.stringify({
      accessToken: tokenResponse.data.access_token,
      refreshToken: tokenResponse.data.refresh_token,
      expiresAt: Date.now() + tokenResponse.data.expires_in * 1000,
    }))

    // 5. Store user in session
    req.session.user = userResponse.data.id

    res.json({ result: 'Success' })
  } catch (error) {
    next(error)
  }
}
```

#### ALL `/zoom/api/v2/*`

**Proxies Zoom REST API calls with user's access token.**

```javascript
// Middleware chain: getUser → refreshToken → setZoomAuthHeader → proxy

// 1. Get user from session and fetch tokens from Redis
async function getUser(req, res, next) {
  const userId = req.session.user
  if (!userId) return res.status(401).json({ error: 'Not authenticated' })

  const userData = await redis.get(`user:${userId}`)
  if (!userData) return res.status(401).json({ error: 'User not found' })

  req.zoomUser = JSON.parse(userData)
  next()
}

// 2. Refresh token if expired
async function refreshToken(req, res, next) {
  if (req.zoomUser.expiresAt > Date.now()) return next()

  const response = await axios.post('https://zoom.us/oauth/token', /* ... */)
  req.zoomUser.accessToken = response.data.access_token
  // Update Redis...
  next()
}

// 3. Set authorization header
function setZoomAuthHeader(req, res, next) {
  req.headers.authorization = `Bearer ${req.zoomUser.accessToken}`
  next()
}

// 4. Proxy to Zoom API
const zoomApiProxy = createProxyMiddleware({
  target: 'https://api.zoom.us',
  changeOrigin: true,
  pathRewrite: { '^/zoom': '' }, // /zoom/api/v2/users/me → /v2/users/me
})
```

### Backend Router Structure

```javascript
// server.js
const express = require('express')
const app = express()

// Middleware
app.use(express.json())
app.use(session({ /* Redis session store */ }))

// Zoom App routes
app.use('/api/zoomapp', zoomAppRouter)  // OAuth, home, proxy
app.use('/zoom', zoomApiRouter)          // API proxy

// zoomAppRouter.js
router
  .use('/proxy', controller.proxy)
  .get('/install', controller.install)
  .get('/auth', controller.auth)
  .get('/home', controller.home)
  .get('/authorize', controller.inClientAuthorize)
  .post('/onauthorized', controller.inClientOnAuthorized)

// zoomApiRouter.js
router.use(
  '/api',
  getUser,
  refreshToken,
  setZoomAuthHeader,
  controller.proxy
)
```

---

## Environment Variables

### Backend Environment Variables

Create a `.env` file in your backend directory:

```bash
# Server
PORT=3000

# Zoom App Credentials (from Marketplace)
ZOOM_APP_CLIENT_ID=your_client_id
ZOOM_APP_CLIENT_SECRET=your_client_secret
ZOOM_HOST=https://zoom.us

# URLs (update with your ngrok URL)
PUBLIC_URL=https://abc123.ngrok.io
ZOOM_APP_REDIRECT_URI=https://abc123.ngrok.io/api/zoomapp/auth

# Frontend URL (for proxy)
ZOOM_APP_CLIENT_URL=http://frontend:9090  # Docker
# ZOOM_APP_CLIENT_URL=http://localhost:9090  # Local

# Session & Security
SESSION_SECRET=generate-a-random-string-here
ZOOM_APP_OAUTH_STATE_SECRET=another-random-string

# Redis
REDIS_URL=redis://redis:6379  # Docker
# REDIS_URL=redis://localhost:6379  # Local
REDIS_ENCRYPTION_KEY=32-character-encryption-key-here

# Optional: Third-party OAuth (Auth0)
AUTH0_CLIENT_ID=
AUTH0_CLIENT_SECRET=
AUTH0_ISSUER_BASE_URL=
```

### Frontend Environment Variables

Create a `.env` file in your frontend directory:

```bash
# Dev server port
PORT=9090

# Enable file watching in Docker
CHOKIDAR_USEPOLLING=true

# Public URL (set by Docker Compose)
PUBLIC_URL=https://abc123.ngrok.io/api/zoomapp/proxy
REACT_APP_PUBLIC_ROOT=https://abc123.ngrok.io
```

### Generating Secrets

```bash
# Generate SESSION_SECRET
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# Generate REDIS_ENCRYPTION_KEY (must be 32 characters)
node -e "console.log(require('crypto').randomBytes(16).toString('hex'))"

# Generate ZOOM_APP_OAUTH_STATE_SECRET
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

---

## Docker Compose Setup

Here's a complete `docker-compose.yml` for running the full stack:

```yaml
services:
  backend:
    build: ./backend/.
    working_dir: /home/node/app
    command: ["npm", "run", "start:dev"]
    ports:
      - "127.0.0.1:8000:3000"     # Backend API
      - "127.0.0.1:9229:9229"     # Node debugger
    env_file:
      - .env
    environment:
      - PORT=3000
      - ZOOM_APP_CLIENT_URL=http://frontend:9090
      - ZOOM_APP_REDIRECT_URI=${PUBLIC_URL}/api/zoomapp/auth
    volumes:
      - ./backend:/home/node/app
      - /home/node/app/node_modules
    depends_on:
      - redis

  frontend:
    build: ./frontend/.
    working_dir: /home/node/app
    command: "npm start"
    ports:
      - "127.0.0.1:3001:9090"     # Frontend dev server
    environment:
      - PORT=9090
      - PUBLIC_URL=${PUBLIC_URL}/api/zoomapp/proxy
      - REACT_APP_PUBLIC_ROOT=${PUBLIC_URL}
    volumes:
      - ./frontend:/home/node/app
      - /home/node/app/node_modules

  redis:
    image: redis:alpine
    ports:
      - "127.0.0.1:6379:6379"
    volumes:
      - ./data:/data
```

### Running the Stack

```bash
# Start all services
docker compose up --build

# Start with ngrok in another terminal
ngrok http 8000

# Update .env with ngrok URL, then restart
docker compose down && docker compose up
```

### Running Without Docker

```bash
# Terminal 1: Redis
redis-server

# Terminal 2: Backend
cd backend
npm install
npm run start:dev

# Terminal 3: Frontend
cd frontend
npm install
npm start

# Terminal 4: ngrok
ngrok http 3000
```

---

## Frontend Configuration

### CORS Headers for Development

Create `config-overrides.js` in your frontend root (requires `react-app-rewired`):

```javascript
module.exports = {
  devServer: (configFunction) => {
    return (proxy, allowedHost) => {
      const config = configFunction(proxy, allowedHost)
      config.headers = {
        'access-control-allow-origin': '*',
      }
      return config
    }
  },
}
```

Update `package.json` scripts:

```json
{
  "scripts": {
    "start": "react-app-rewired start",
    "build": "react-scripts build",
    "test": "react-scripts test"
  }
}
```

Install the dependency:

```bash
npm install react-app-rewired --save-dev
```

---

## Complete Integration Example

Here's a minimal but complete Zoom App:

```javascript
/* globals zoomSdk */
import { useEffect } from 'react'
import { useZoomApp, useZoomAuth, useZoomConnect } from './hooks'
import { showNotification } from './utils'

const CAPABILITIES = [
  // Tier 1: Required
  'getSupportedJsApis',
  // Tier 2: OAuth
  'authorize', 'onAuthorized', 'promptAuthorize',
  'getUserContext', 'onMyUserContextChange',
  // Tier 3: Messaging
  'connect', 'onConnect', 'postMessage', 'onMessage',
  // Tier 4: Features
  'showNotification', 'openUrl',
]

function App() {
  // Tier 1: Initialize SDK
  const {
    configured,
    runningContext,
    userContextStatus,
    error: sdkError,
  } = useZoomApp(CAPABILITIES)

  // Tier 2: Handle OAuth
  const {
    isAuthorized,
    startAuth,
    error: authError,
  } = useZoomAuth({
    onAuthorized: () => {
      showNotification('Success', 'You are now authorized!', 'info')
    },
  })

  // Tier 3: Cross-instance messaging
  const { connected, sendMessage } = useZoomConnect(runningContext, {
    onMessage: (payload) => {
      console.log('Received:', payload)
    },
  })

  // Auto-start auth when needed
  useEffect(() => {
    if (configured && userContextStatus && !isAuthorized) {
      startAuth()
    }
  }, [configured, userContextStatus, isAuthorized, startAuth])

  // Loading state
  if (!configured) {
    return <div>Initializing Zoom SDK...</div>
  }

  // Error state
  if (sdkError || authError) {
    return <div>Error: {(sdkError || authError).message}</div>
  }

  // Auth pending
  if (!isAuthorized) {
    return <div>Waiting for authorization...</div>
  }

  // Ready!
  return (
    <div>
      <h1>My Zoom App</h1>
      <p>Context: {runningContext}</p>
      <p>Connected: {connected ? 'Yes' : 'No'}</p>
      <button onClick={() => sendMessage({ action: 'hello' })}>
        Send Message
      </button>
    </div>
  )
}

export default App
```

---

## Zoom Marketplace Configuration

Your Zoom Marketplace app settings must match your code. Log in at [marketplace.zoom.us](https://marketplace.zoom.us).

### Create Your App

1. Go to **Develop** → **Build App**
2. Select **Zoom Apps** as the app type
3. Fill in basic information

### Configure URLs

In the **Configuration** tab, set these URLs (replace with your ngrok URL):

| Setting | Value | Notes |
|---------|-------|-------|
| **Home URL** | `https://abc123.ngrok.io/api/zoomapp/home` | Entry point when app opens |
| **Redirect URL for OAuth** | `https://abc123.ngrok.io/api/zoomapp/auth` | OAuth callback |
| **Add allow lists: Domain** | `https://abc123.ngrok.io` | Required for SDK |

### Configure Scopes

In the **Scopes** tab, add the OAuth scopes your app needs:

| Scope | Purpose |
|-------|---------|
| `user:read` | Read user profile |
| `meeting:read` | Read meeting info |
| `recording:read` | Read recordings |
| `zoomapp:inmeeting` | In-meeting capabilities |

### Configure Features

In the **Features** tab, enable the SDK capabilities your app uses. These must match your `useZoomApp([...])` call:

**Basic (always needed):**
- `getSupportedJsApis`

**OAuth (if using `useZoomAuth`):**
- `authorize`
- `onAuthorized`
- `promptAuthorize`
- `getUserContext`
- `onMyUserContextChange`

**Messaging (if using `useZoomConnect`):**
- `connect`
- `onConnect`
- `postMessage`
- `onMessage`

**Common features:**
- `openUrl`
- `showNotification`
- `cloudRecording`
- `setVirtualBackground`
- `shareApp`
- `sendAppInvitation`
- `onSendAppInvitation`
- `onShareApp`
- `getMeetingContext`
- `getMeetingParticipants`

### Install the App

1. Go to the **Test** tab
2. Click **Add** to install the app to your Zoom account
3. The app will appear in your Zoom client under **Apps**

---

## Common Patterns

### Conditional Rendering by Context

```javascript
function App() {
  const { isInMeeting, isInClient } = useZoomApp(CAPABILITIES)

  return (
    <div>
      {isInMeeting && <MeetingControls />}
      {isInClient && <ClientDashboard />}
    </div>
  )
}
```

### Guest vs Host Features

```javascript
function Controls() {
  const { isGuest, isAuthorized } = useZoomAuth()

  return (
    <div>
      {isAuthorized && <HostControls />}
      {isGuest && <GuestLimitedView />}
    </div>
  )
}
```

### Syncing State Between Instances

```javascript
function App() {
  const [sharedState, setSharedState] = useState({ count: 0 })

  const { sendMessage } = useZoomConnect(runningContext, {
    onMessage: (state) => setSharedState(state),
  })

  const increment = () => {
    const newState = { count: sharedState.count + 1 }
    setSharedState(newState)
    sendMessage(newState)
  }

  return <button onClick={increment}>Count: {sharedState.count}</button>
}
```

---

## Troubleshooting

### "zoomSdk is not defined"

- Ensure the SDK script is in `public/index.html`
- Check that the script loads before your React app
- Add `/* globals zoomSdk */` to files using it

### "SDK config failed"

- Verify capabilities match your Marketplace app's Features
- Check that your app URL is in the OAuth Allow List
- Ensure you're accessing via HTTPS (use ngrok)

### "Authorization failed"

- Check backend endpoints are running
- Verify OAuth redirect URL matches Marketplace config
- Check browser console for CORS errors

### Messages not received

- Ensure both instances have `connect`, `postMessage`, `onMessage` capabilities
- Check that `runningContext` is being passed to `useZoomConnect`
- Meeting instance must call `connect()` first (hook does this automatically)

---

## Migration from Inline Code

If you're migrating from inline `zoomSdk` calls:

| Old Pattern | New Pattern |
|-------------|-------------|
| `zoomSdk.config({...})` | `useZoomApp(capabilities)` |
| `zoomSdk.authorize({...})` | `useZoomAuth().authorize()` |
| `zoomSdk.connect()` | `useZoomConnect(context)` |
| `zoomSdk.postMessage({...})` | `useZoomConnect().sendMessage()` |
| `zoomSdk.addEventListener(...)` | Handled internally by hooks |
| `zoomSdk.removeEventListener(...)` | Automatic cleanup in hooks |

The hooks handle:
- Event listener cleanup (prevents memory leaks)
- Duplicate listener prevention
- 2-hour config timeout refresh
- Error handling and state management

---

## Further Reading

- [Zoom Apps SDK Documentation](https://developers.zoom.us/docs/zoom-apps/)
- [Zoom Apps SDK GitHub](https://github.com/zoom/appssdk)
- [Backend Implementation](../backend)
