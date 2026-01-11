/**
 * Server-only exports
 *
 * These exports use Node.js APIs and are NOT available in browser environments.
 * Import from '@pippa/shared/server' for server-side code only.
 */

// Container paths (uses Node.js 'path' and 'fs' modules)
export { getContainerRoot, containerPath, ContainerPaths, clearPathCache } from "./paths.js";
