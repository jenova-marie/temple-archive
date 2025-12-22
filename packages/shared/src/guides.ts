/**
 * Guide configuration for selecting system prompts
 */
export interface Guide {
  id: string;
  name: string;
  description: string;
}

/**
 * Available guides (system prompt configurations)
 */
export const GUIDES: Guide[] = [
  {
    id: "pippa",
    name: "Pippa",
    description: "Your personal AI companion",
  },
];

/**
 * Default guide ID
 */
export const DEFAULT_GUIDE_ID = "pippa";
