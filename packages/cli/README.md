# @pippa/cli

Command-line interface for interacting with the RecoverySky Agent API.

## Installation

```bash
# From monorepo root
pnpm add @pippa/cli

# Build
pnpm --filter @pippa/cli build

# Link globally (optional)
cd packages/cli && pnpm link --global
```

## Quick Start

```bash
# Start interactive chat (default)
recoverysky

# Send a single message
recoverysky chat "I'm feeling anxious today"

# Check API health
recoverysky health

# Show configuration
recoverysky config show
```

## Commands

### Interactive Chat

Start an interactive chat session with the RecoverySky agent:

```bash
recoverysky
# or
recoverysky interactive
```

In interactive mode:
- Type messages and press Enter to send
- Type `exit` or `quit` to end the session
- Type `new` to start a new conversation

### Single Message

Send a single message and get a response:

```bash
recoverysky chat "How can I manage my cravings?"

# With verbose output (shows metrics)
recoverysky chat -v "I need help with anxiety"
```

### Health Check

Check if the API is running:

```bash
recoverysky health
```

Output:
```
API Health

  URL:       http://localhost:3333
  Status:    healthy
  Version:   0.1.0
  Uptime:    1h 23m 45s
  Timestamp: 2024-01-15T10:30:00.000Z
```

### Metrics

View API metrics:

```bash
recoverysky metrics
```

### Configuration

Manage CLI settings:

```bash
# Show current configuration
recoverysky config show

# Set API URL
recoverysky config set apiUrl http://localhost:3333

# Set user ID
recoverysky config set userId my-user-id

# Reset to defaults
recoverysky config reset
```

### New Conversation

Start a fresh conversation:

```bash
recoverysky new
```

## Configuration

The CLI stores configuration in:
- **macOS**: `~/Library/Preferences/recoverysky-cli-nodejs/config.json`
- **Linux**: `~/.config/recoverysky-cli-nodejs/config.json`
- **Windows**: `%APPDATA%\recoverysky-cli-nodejs\Config\config.json`

### Settings

| Key | Default | Description |
|-----|---------|-------------|
| `apiUrl` | `http://localhost:3333` | RecoverySky API URL |
| `userId` | Auto-generated | User identifier for conversations |
| `conversationId` | Auto-generated | Current conversation ID |

## Output

### Crisis Level Indicators

The CLI displays crisis levels when elevated:

- **Level 4-5**: Blue indicator
- **Level 6-7**: Yellow indicator
- **Level 8-10**: Red indicator

```
Sky: I hear that you're going through a difficult time...

[Crisis Level: 6/10]
```

### Emergency Protocol

When emergency protocol is triggered:

```
Sky: I'm very concerned about what you've shared...

[Crisis Level: 9/10]
*** EMERGENCY PROTOCOL TRIGGERED ***
```

### Verbose Output

With `-v` or `--verbose`:

```
Sky: Here are some coping strategies...

--- Metrics ---
Total Duration: 1250ms
Memory Duration: 15ms
Agent Duration: 1200ms
Memory Source: L1_REDIS
Tokens: 150 in / 200 out
Conversation: conv_abc123
```

## Examples

### Morning Check-in

```bash
$ recoverysky chat "Good morning, I woke up feeling anxious about the day"

Sky: Good morning! I hear that you're feeling anxious as you start your day.
That's a really common experience in recovery, and it takes courage to
acknowledge it. Would you like to try a quick grounding exercise together,
or would you prefer to talk about what's on your mind?
```

### Finding Meetings

```bash
$ recoverysky chat "Can you help me find an AA meeting nearby?"

Sky: I'd be happy to help you find a meeting! I found 3 AA meetings in your
area:

1. Early Birds AA Meeting - 7:00 AM today
   Community Center, 123 Main St (in-person)

2. Noon Recovery - 12:00 PM today
   Church Hall, 456 Oak Ave (in-person)

3. Evening Serenity - 8:00 PM today
   Online via Zoom

Would you like more details about any of these meetings?
```

### Crisis Support

```bash
$ recoverysky chat "I'm having thoughts of using again"

Sky: Thank you for reaching out and being honest about what you're
experiencing. Cravings and urges are a normal part of recovery, and
they will pass. Let's work through this together.

Have you been able to use any of your coping strategies? Sometimes
it helps to:
- Call your sponsor or a supportive friend
- Use the HALT check (Hungry, Angry, Lonely, Tired?)
- Try deep breathing or grounding exercises

Would you like me to find a meeting near you, or would you prefer
to talk through what triggered these thoughts?

[Crisis Level: 7/10]
```

## Development

```bash
# Build
pnpm build

# Watch mode
pnpm dev

# Type check
pnpm typecheck

# Run locally
node dist/index.js

# Or with ts-node (if installed)
npx tsx src/index.ts
```

## Dependencies

- [commander](https://github.com/tj/commander.js) - CLI framework
- [chalk](https://github.com/chalk/chalk) - Terminal styling
- [ora](https://github.com/sindresorhus/ora) - Spinner/loading indicator
- [inquirer](https://github.com/SBoudrias/Inquirer.js) - Interactive prompts
- [conf](https://github.com/sindresorhus/conf) - Configuration storage
