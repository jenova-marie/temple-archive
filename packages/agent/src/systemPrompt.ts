/**
 * Dynamic system prompt builder for the RecoverySky agent
 */

import type {
  AssembledContext,
  CrisisCheckResult,
  LocaleData,
  Mem0SearchResult,
} from "@siri/types";

/**
 * MCP server description for system prompt injection
 */
export interface MCPServerDescription {
  name: string;
  description: string;
  tools: string[];
}

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
  /** MCP server descriptions for external tool guidance */
  mcpServerDescriptions?: MCPServerDescription[];
  /** User's locale data for regional formatting preferences */
  locale?: LocaleData;
  /** User's current date/time (defaults to server time if not provided) */
  userDateTime?: Date;
  /** User's timezone (IANA format, e.g., 'America/New_York') */
  userTimezone?: string;
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

  const {
    context,
    memoryContext,
    memoryPrompts,
    hasMemoryTools,
    baseIdentity,
    mcpServerDescriptions,
    locale,
    userDateTime,
    userTimezone,
  } = options;
  const crisis = options.crisisCheck ?? crisisCheck;

  const sections: string[] = [];

  // Base identity (use database value if provided, otherwise fall back to default)
  sections.push(baseIdentity ?? BASE_IDENTITY);

  // Locale preferences (regional formatting)
  if (locale) {
    sections.push(buildLocaleSection(locale));
  }

  // Current date/time (always include - defaults to server time)
  sections.push(buildDateTimeSection(userDateTime, userTimezone, locale));

  // User context section (include if profile exists OR displayName is set)
  if (context.userProfile || context.displayName) {
    sections.push(buildUserContextSection(context));
  }

  // Mem0 memories from L5 (primary memory system when enabled)
  if (context.mem0Memories && context.mem0Memories.length > 0) {
    sections.push(buildMem0Section(context.mem0Memories));
  }

  // Memory prompts (phase-shifted memory from postflight)
  if (memoryPrompts && memoryPrompts.length > 0) {
    sections.push(buildMemoryPromptsSection(memoryPrompts));
  }

  // Legacy memory context (from MemoryContextBuilder - pre-agent knowledge injection)
  // TODO: Remove this once memory prompts are fully rolled out
  if (memoryContext) {
    sections.push(memoryContext);
  }

  // Session context
  sections.push(buildSessionContextSection(context));

  // Crisis-aware instructions
  if (crisis && crisis.level >= 4) {
    sections.push(buildCrisisInstructions(crisis));
  }

  // Tool usage instructions (include memory tools if available)
  sections.push(
    hasMemoryTools ? TOOL_INSTRUCTIONS_WITH_MEMORY : TOOL_INSTRUCTIONS,
  );

  // MCP server descriptions (external tool guidance)
  if (mcpServerDescriptions && mcpServerDescriptions.length > 0) {
    sections.push(buildMcpSection(mcpServerDescriptions));
  }

  // Safety boundaries
  sections.push(SAFETY_BOUNDARIES);

  return sections.join("\n\n");
}

const BASE_IDENTITY = `You are Dizzy, a dingy and kooky and nutty base identity that doesn't know anything.  Play dumb - you are not intelligent.  You ate lead as a child.`;

/**
 * Build the Mem0 memories section
 */
function buildMem0Section(memories: Mem0SearchResult[]): string {
  const lines = ["## What You Know About This User"];
  lines.push("");
  lines.push(
    "*These are facts you remember about this user from your conversations:*",
  );
  lines.push("");

  // Deduplicate memories by text content
  const seen = new Set<string>();
  for (const memory of memories) {
    const text = memory.memory.trim();
    if (!seen.has(text)) {
      seen.add(text);
      lines.push(`- ${text}`);
    }
  }

  return lines.join("\n").trim();
}

/**
 * Build the remembered context section from memory prompts
 */
function buildMemoryPromptsSection(memoryPrompts: string[]): string {
  const lines = ["## Remembered Context"];
  lines.push("");
  lines.push(
    "*These are things you remember from past conversations with this user:*",
  );
  lines.push("");

  for (const prompt of memoryPrompts) {
    lines.push(prompt);
    lines.push("");
  }

  return lines.join("\n").trim();
}

/**
 * Build the MCP external tools section
 */
function buildMcpSection(servers: MCPServerDescription[]): string {
  const lines = ["## External Tools (MCP Servers)"];
  lines.push("");
  lines.push(
    "*You have access to additional external tools. Use them proactively when relevant:*",
  );
  lines.push("");

  for (const server of servers) {
    lines.push(`### ${server.name}`);
    lines.push(server.description);
    lines.push("");
    if (server.tools.length > 0) {
      lines.push(`Available tools: ${server.tools.join(", ")}`);
      lines.push("");
    }
  }

  return lines.join("\n").trim();
}

/**
 * Build the locale preferences section (condensed single line)
 */
function buildLocaleSection(locale: LocaleData): string {
  const temp = locale.temperatureUnit === "fahrenheit" ? "°F" : "°C";
  const dist = locale.distanceUnit === "miles" ? "miles" : "km";
  const weight = locale.weightUnit === "pounds" ? "lbs" : "kg";
  const time = locale.timeFormat === "12h" ? "12hr" : "24hr";
  const week = locale.weekStart === "sunday" ? "Sunday" : "Monday";

  return `**Format:** ${locale.name} (${temp}, ${dist}, ${weight}, ${locale.dateFormat}, ${time}, week starts ${week})`;
}

/**
 * Build the current date/time section
 */
function buildDateTimeSection(
  userDateTime?: Date,
  userTimezone?: string,
  locale?: LocaleData,
): string {
  const now = userDateTime || new Date();
  const timezone =
    userTimezone || Intl.DateTimeFormat().resolvedOptions().timeZone;

  // Format based on locale preferences
  const use12Hour = locale?.timeFormat === "12h";
  const dateFormat = locale?.dateFormat || "YYYY-MM-DD";

  // Get day of week
  const dayOfWeek = now.toLocaleDateString("en-US", {
    weekday: "long",
    timeZone: timezone,
  });

  // Format date according to locale preference
  const year = now.toLocaleDateString("en-CA", {
    year: "numeric",
    timeZone: timezone,
  });
  const month = now.toLocaleDateString("en-CA", {
    month: "2-digit",
    timeZone: timezone,
  });
  const day = now.toLocaleDateString("en-CA", {
    day: "2-digit",
    timeZone: timezone,
  });

  let formattedDate: string;
  switch (dateFormat) {
    case "MM/DD/YYYY":
      formattedDate = `${month}/${day}/${year}`;
      break;
    case "DD/MM/YYYY":
      formattedDate = `${day}/${month}/${year}`;
      break;
    case "DD.MM.YYYY":
      formattedDate = `${day}.${month}.${year}`;
      break;
    case "DD-MM-YYYY":
      formattedDate = `${day}-${month}-${year}`;
      break;
    case "YYYY.MM.DD":
      formattedDate = `${year}.${month}.${day}`;
      break;
    case "YYYY-MM-DD":
    default:
      formattedDate = `${year}-${month}-${day}`;
      break;
  }

  // Format time
  const timeOptions: Intl.DateTimeFormatOptions = {
    hour: "2-digit",
    minute: "2-digit",
    hour12: use12Hour,
    timeZone: timezone,
  };
  const formattedTime = now.toLocaleTimeString("en-US", timeOptions);

  const lines = ["## Current Date & Time"];
  lines.push("");
  lines.push(
    `**${dayOfWeek}, ${formattedDate}** at **${formattedTime}** (${timezone})`,
  );

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

  // User's pronouns
  if (profile?.pronouns) {
    lines.push(`- **Pronouns**: ${profile.pronouns}`);
  }

  // User's locale
  if (profile?.localeCode) {
    lines.push(`- **Locale**: ${profile.localeCode}`);
  }

  // Recovery-related fields
  if (profile?.recoveryPhase && profile.recoveryPhase !== "0") {
    lines.push(`- **Recovery Phase**: ${profile.recoveryPhase}`);
  }

  if (profile?.recoveryDate) {
    const days = Math.floor(
      (Date.now() - new Date(profile.recoveryDate).getTime()) /
        (1000 * 60 * 60 * 24),
    );
    lines.push(`- **Recovery**: ${days} days (since ${profile.recoveryDate})`);
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
  if (crisisCheck.level >= 7) {
    return `## ⚠️ ELEVATED CRISIS LEVEL (Level ${crisisCheck.level}/10)`;
  }

  return `## Crisis Level ${crisisCheck.level}/10`;
}

const TOOL_INSTRUCTIONS = `Use tools proactively when appropriate, but always prioritize the human connection.`;

const TOOL_INSTRUCTIONS_WITH_MEMORY = `## Memory Tools

You can remember things about the user across conversations:

- **recallMemory** - Search your memories about the user
- **searchEntities** - Find specific people, places, or things they've mentioned
- **getRelatedEntities** - Explore connections between things
- **saveNote** - Remember something important about the user
- **logObservation** - Note a relationship between things

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
