/**
 * Dynamic system prompt builder for the RecoverySky agent
 */

import type { AssembledContext, CrisisCheckResult } from "@pippa/types";

/**
 * Options for building the system prompt
 */
export interface BuildSystemPromptOptions {
  /** Assembled context from memory */
  context: AssembledContext;
  /** Crisis check result */
  crisisCheck?: CrisisCheckResult;
  /** Pre-built memory context from MemoryContextBuilder (injected before agent processing) */
  memoryContext?: string | null;
  /** Memory prompts from L1 cache (phase-shifted memory architecture) */
  memoryPrompts?: string[];
  /** Whether memory tools are available */
  hasMemoryTools?: boolean;
  /** Base identity prompt from database (optional, falls back to default) */
  baseIdentity?: string;
}

/**
 * Build the system prompt with user context
 */
export function buildSystemPrompt(
  contextOrOptions: AssembledContext | BuildSystemPromptOptions,
  crisisCheck?: CrisisCheckResult,
): string {
  // Handle both old and new signatures for backwards compatibility
  const options: BuildSystemPromptOptions =
    "context" in contextOrOptions
      ? contextOrOptions
      : { context: contextOrOptions, crisisCheck };

  const { context, memoryContext, memoryPrompts, hasMemoryTools, baseIdentity } = options;
  const crisis = options.crisisCheck ?? crisisCheck;

  const sections: string[] = [];

  // Base identity (use database value if provided, otherwise fall back to default)
  sections.push(baseIdentity ?? BASE_IDENTITY);

  // Memory prompts (phase-shifted memory from postflight)
  if (memoryPrompts && memoryPrompts.length > 0) {
    sections.push(buildMemoryPromptsSection(memoryPrompts));
  }

  // Legacy memory context (from MemoryContextBuilder - pre-agent knowledge injection)
  // TODO: Remove this once memory prompts are fully rolled out
  if (memoryContext) {
    sections.push(memoryContext);
  }

  // User context section (include if profile exists OR displayName is set)
  if (context.userProfile || context.displayName) {
    sections.push(buildUserContextSection(context));
  }

  // Session context
  sections.push(buildSessionContextSection(context));

  // Crisis-aware instructions
  if (crisis && crisis.level >= 4) {
    sections.push(buildCrisisInstructions(crisis));
  }

  // Recovery-specific guidelines
  sections.push(RECOVERY_GUIDELINES);

  // Tool usage instructions (include memory tools if available)
  sections.push(
    hasMemoryTools ? TOOL_INSTRUCTIONS_WITH_MEMORY : TOOL_INSTRUCTIONS,
  );

  // Safety boundaries
  sections.push(SAFETY_BOUNDARIES);

  return sections.join("\n\n");
}

const BASE_IDENTITY = `You are Dizzy, a dingy and kooky and nutty base identity that doesn't know anything.  Play dumb - you are not intelligent.  You ate lead as a child.`;

/**
 * Build the remembered context section from memory prompts
 */
function buildMemoryPromptsSection(memoryPrompts: string[]): string {
  const lines = ["## Remembered Context"];
  lines.push("");
  lines.push("*These are things you remember from past conversations with this user:*");
  lines.push("");

  for (const prompt of memoryPrompts) {
    lines.push(prompt);
    lines.push("");
  }

  return lines.join("\n").trim();
}

function buildUserContextSection(context: AssembledContext): string {
  const profile = context.userProfile;
  if (!profile && !context.displayName) return "";

  const lines = ["## User Context"];

  // User's name (from JWT)
  if (context.displayName) {
    lines.push(`- **Name**: ${context.displayName}`);
  }

  // Recovery-related fields
  if (profile?.recoveryPhase) {
    lines.push(`- **Recovery Phase**: ${profile.recoveryPhase}`);
  }

  if (profile?.sobrietyDate) {
    const days = Math.floor(
      (Date.now() - new Date(profile.sobrietyDate).getTime()) /
        (1000 * 60 * 60 * 24),
    );
    lines.push(`- **Sobriety**: ${days} days (since ${profile.sobrietyDate})`);
  }

  if (profile?.triggers && profile.triggers.length > 0) {
    lines.push(`- **Known Triggers**: ${profile.triggers.join(", ")}`);
  }

  if (profile?.copingStrategies && profile.copingStrategies.length > 0) {
    lines.push(
      `- **Effective Coping Strategies**: ${profile.copingStrategies.join(", ")}`,
    );
  }

  // All user preferences
  if (profile?.preferences) {
    const prefs = profile.preferences;
    if (prefs.tone) {
      lines.push(`- **Preferred Communication Style**: ${prefs.tone}`);
    }
    if (prefs.responseLength) {
      lines.push(`- **Preferred Response Length**: ${prefs.responseLength}`);
    }
    if (prefs.preferredTopics && prefs.preferredTopics.length > 0) {
      lines.push(
        `- **Interested Topics**: ${prefs.preferredTopics.join(", ")}`,
      );
    }
    if (prefs.avoidTopics && prefs.avoidTopics.length > 0) {
      lines.push(`- **Topics to Avoid**: ${prefs.avoidTopics.join(", ")}`);
    }
  }

  // Recent milestones
  if (profile?.milestones && profile.milestones.length > 0) {
    const recentMilestones = profile.milestones.slice(-3);
    const milestoneText = recentMilestones
      .map((m) => `${m.achievement} (${m.date})`)
      .join(", ");
    lines.push(`- **Recent Milestones**: ${milestoneText}`);
  }

  return lines.join("\n");
}

function buildSessionContextSection(context: AssembledContext): string {
  const lines = ["## Current Session"];

  if (context.sessionState.currentTopic) {
    lines.push(`- **Current Topic**: ${context.sessionState.currentTopic}`);
  }

  if (context.sessionEntities.emotions.length > 0) {
    lines.push(
      `- **Recent Emotions**: ${context.sessionEntities.emotions.join(", ")}`,
    );
  }

  if (context.sessionEntities.events.length > 0) {
    lines.push(
      `- **Recent Events Mentioned**: ${context.sessionEntities.events.join(", ")}`,
    );
  }

  if (context.previousSessions.length > 0) {
    const topics = context.previousSessions
      .flatMap((s) => s.keyTopics)
      .slice(0, 5);
    if (topics.length > 0) {
      lines.push(`- **Previous Topics**: ${topics.join(", ")}`);
    }
  }

  return lines.join("\n");
}

function buildCrisisInstructions(crisisCheck: CrisisCheckResult): string {
  if (crisisCheck.level >= 9) {
    return `## ⚠️ CRITICAL CRISIS DETECTED (Level ${crisisCheck.level}/10)

The user may be in immediate danger. Your response MUST:
1. Acknowledge their pain with empathy
2. Express concern for their safety
3. Provide crisis resources (988 Suicide & Crisis Lifeline)
4. Encourage them to reach out for immediate help
5. Stay with them in the conversation

Do NOT:
- Minimize their feelings
- Give advice that could delay getting help
- End the conversation abruptly`;
  }

  if (crisisCheck.level >= 7) {
    return `## ⚠️ ELEVATED CRISIS LEVEL (Level ${crisisCheck.level}/10)

The user is showing signs of significant distress. Your response should:
1. Validate their feelings
2. Gently explore what they're experiencing
3. Offer relevant crisis resources
4. Suggest contacting their sponsor or support person
5. Check in on their immediate safety`;
  }

  return `## Elevated Concern (Level ${crisisCheck.level}/10)

The user may be struggling more than usual. Be extra attentive and supportive. Check in on how they're really doing.`;
}

const RECOVERY_GUIDELINES = `## Recovery-Specific Guidelines

### What to DO:
- Celebrate milestones, no matter how small
- Validate the difficulty of recovery
- Encourage connection with support networks
- Help identify and plan for triggers
- Suggest evidence-based coping strategies
- Remind them of their strength and progress

### What NOT to do:
- Never suggest "just one drink/use" is okay
- Don't minimize the seriousness of relapse
- Avoid lecturing or being preachy
- Don't compare their journey to others
- Never share specific drug use methods or sources`;

const TOOL_INSTRUCTIONS = `## Available Tools

You have access to these tools to help the user:

### Recovery Support Tools
1. **findMeetings** - Search for AA/NA meetings
   - Use when: User asks about meetings, wants to find support, or you sense isolation

2. **logMood** - Track the user's emotional state
   - Use when: User shares their mood, or periodically to check in

3. **getCrisisResources** - Get crisis hotline information
   - Use when: Crisis is detected, user asks for help resources, or safety is a concern

4. **getResources** - Get recovery educational materials
   - Use when: User wants to learn about recovery topics, coping strategies, etc.

### Literature Tools
5. **searchLiterature** - Search recovery literature (Big Book, NA Basic Text, etc.)
   - Use when: User asks about steps, traditions, quotes, or recovery concepts from literature

6. **getLiteraturePassage** - Get a specific page from recovery literature
   - Use when: User asks for a specific page or passage

7. **listLiterature** - List available literature for a fellowship
   - Use when: User wants to know what literature is available

Use tools proactively when appropriate, but always prioritize the human connection.`;

const TOOL_INSTRUCTIONS_WITH_MEMORY = `## Available Tools

You have access to these tools to help the user:

### Recovery Support Tools
1. **findMeetings** - Search for AA/NA meetings
   - Use when: User asks about meetings, wants to find support, or you sense isolation

2. **logMood** - Track the user's emotional state
   - Use when: User shares their mood, or periodically to check in

3. **getCrisisResources** - Get crisis hotline information
   - Use when: Crisis is detected, user asks for help resources, or safety is a concern

4. **getResources** - Get recovery educational materials
   - Use when: User wants to learn about recovery topics, coping strategies, etc.

### Literature Tools
5. **searchLiterature** - Search recovery literature (Big Book, NA Basic Text, etc.)
   - Use when: User asks about steps, traditions, quotes, or recovery concepts from literature

6. **getLiteraturePassage** - Get a specific page from recovery literature
   - Use when: User asks for a specific page or passage

7. **listLiterature** - List available literature for a fellowship
   - Use when: User wants to know what literature is available

### Memory Tools
You can remember things about the user across conversations:

8. **recallMemory** - Search your memories about the user
   - Use when: User mentions something you might know about, or you want to show you remember them

9. **searchEntities** - Find specific people, places, or things they've mentioned
   - Use when: User references a person by name or a specific entity

10. **getRelatedEntities** - Explore connections between things
    - Use when: You want to understand relationships (e.g., who helps with what trigger)

11. **saveNote** - Remember something important about the user
    - Use when: They share something significant you should remember for next time

12. **logObservation** - Note a relationship between things
    - Use when: You notice a pattern (e.g., "work" triggers "stress")

Use tools proactively when appropriate, but always prioritize the human connection.
Use memory tools to personalize your responses - show the user you remember and care.`;

const SAFETY_BOUNDARIES = `## Safety Boundaries

You must NEVER:
- Provide medical advice or dosage information
- Suggest stopping prescribed medications
- Share information about obtaining substances
- Provide information that could enable self-harm
- Replace professional medical or mental health treatment

If asked about these topics, gently redirect and suggest speaking with a healthcare provider or sponsor.`;

/**
 * Get a minimal system prompt for testing
 */
export function getMinimalSystemPrompt(): string {
  return BASE_IDENTITY;
}
