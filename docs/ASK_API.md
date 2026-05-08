# Temple Archive — `/ask` API Spec

> *For the [𒀭Ninshubur](https://github.com/jenova-marie/ninshubur) team. Last updated: 2026-05-08.*

A simple, anonymous-friendly HTTP endpoint that lets you ask a question and get back a sourced answer from the **Archivist** — the quiet guide whose only job is to quote what the archive preserves and stop when it falls silent.

This is the read-side contract between the **Temple Archive** (this repo — agent + guides + RAG client) and **Ninshubur** (the scribe that gathered and embedded the archive in the first place). The Archivist's answers are drawn directly from the Postgres + Qdrant stores Ninshubur wrote during her backfills.

---

## 📋 Table of Contents

1. [TL;DR](#tldr)
2. [Endpoint](#endpoint)
3. [Authentication](#authentication)
4. [Request](#request)
5. [Response](#response)
6. [Errors](#errors)
7. [Behavior](#behavior)
8. [Examples](#examples)
9. [Operational notes](#operational-notes)
10. [Testing your integration](#testing-your-integration)

---

## TL;DR

```sh
curl -X POST https://archive.templeofinannaslight.org/api/v1/ask \
  -H "Content-Type: application/json" \
  -H "X-API-Key: <your-key>" \
  -d '{"q": "What does the Temple teach about 𒀭Inanna?"}'
```

```json
{
  "question": "What does the Temple teach about 𒀭Inanna?",
  "answer": "\"𒀭Inanna is the lady of the morning star, the lady of the evening star, the lady of love and battle in equal measure...\" — Entu Siri Ninkurgarra, [source](https://discord.com/channels/.../...)\n\n\"...\"",
  "guide": "archivist",
  "conversationId": "8b7e...",
  "crisisLevel": 1,
  "metrics": { "preflightMs": 42, "totalMs": 1830 }
}
```

That's the whole interface. Read on for the contract.

---

## Endpoint

| | |
|---|---|
| **Method** | `POST` |
| **Path** | `/api/v1/ask` |
| **Production base URL** | `https://archive.templeofinannaslight.org` |
| **Dev base URL** | `http://localhost:3333` (when running `pnpm dev` locally) |
| **Content-Type** | `application/json` (request and response) |
| **Idempotent** | No — each call invokes the LLM and is independently billed |
| **Cacheable** | No — same question may yield different prose on repeated calls |

### Why `POST`, not `GET`?

The question travels in the request body, not the URL. This:

- Keeps questions out of access logs, browser history, and proxy logs.
- Lifts the URL-length cap (you can ask multi-paragraph questions).
- Matches HTTP semantics — an LLM call is neither idempotent nor side-effect-free (it incurs cost, fires observability writes, and may fire a crisis webhook).

---

## Authentication

Every request must include an `X-API-Key` header. The key is compared (timing-safe) against the comma-separated list in the server's `ASK_API_KEYS` env var. Unknown or missing keys → `401`.

```http
X-API-Key: a1b2c3d4...
```

### Getting a key

Keys are issued by Jenova. Each consumer (script, integration, person) gets its own key so revocation is surgical. Ask in the Temple's guild or DM — keys arrive over a private channel, not in code.

### Key hygiene (please)

- **Don't commit keys.** Read them from your own env / secret store at runtime.
- **One key per consumer.** Don't share. Rotation is per-key.
- **Treat them like passwords.** If you suspect leakage, ping Jenova for revocation.

### Why `X-API-Key` and not Auth0 JWT?

The `/api/v1/chat` endpoint requires a real Auth0 JWT — that path holds user-scoped memory across requests, so it needs a real identity. `/ask` is anonymous and stateless; demanding OAuth would defeat the "simple GET-replacement" framing. API keys are the lightweight middle ground.

---

## Request

### Headers

| Header | Required | Notes |
|---|:---:|---|
| `X-API-Key` | ✅ | Your issued key. |
| `Content-Type` | ✅ | Must be `application/json`. |
| `X-Trace-Id` | optional | Propagates into the server's OpenTelemetry trace; pass your own to correlate logs end-to-end. |
| `X-Request-Id` | optional | Free-form correlation id. Echoed in server logs. |

### Body

```json
{
  "q": "<your question>"
}
```

| Field | Type | Required | Constraints | Description |
|---|---|:---:|---|---|
| `q` | string | ✅ | non-empty, ≤ 2000 chars | The question to ask. Plain text. Cuneiform / unicode is welcome. |

That's the whole schema. Extra fields are ignored (Zod `.passthrough()` is *not* set on this schema — extra fields don't cause errors but aren't acted on either).

---

## Response

### `200 OK`

```json
{
  "question": "What does the Temple teach about 𒀭Inanna?",
  "answer": "\"𒀭Inanna is...\" — Entu Siri Ninkurgarra, [source](https://discord.com/channels/.../...)",
  "guide": "archivist",
  "conversationId": "8b7e1c4a-3d2f-4f8e-9c1b-2a3d4e5f6a7b",
  "crisisLevel": 1,
  "metrics": {
    "preflightMs": 42,
    "totalMs": 1830
  }
}
```

| Field | Type | Always present | Description |
|---|---|:---:|---|
| `question` | string | ✅ | Echo of the request's `q`. |
| `answer` | string | ✅ | The Archivist's prose. **Source links are embedded inline** as markdown — `[source](URL)` follows each attribution. May be empty if the archive is genuinely silent on the question (rare; the Archivist's prompt instructs her to say `"The tablets do not preserve this."` instead). |
| `guide` | string | ✅ | Always `"archivist"` for this endpoint. Future-proofs the response for variants. |
| `conversationId` | string (UUID) | ✅ | Server-assigned per request. Useful for correlating with server logs / traces. **Not** a session id — there is no session. |
| `crisisLevel` | integer (1–10) | ✅ | The pre-flight crisis-detection score for the question. `1`–`3` is routine; `≥ 8` short-circuits with a safety reply. |
| `metrics.preflightMs` | integer | ✅ | Time spent on pre-flight (system prompt resolution + crisis check). |
| `metrics.totalMs` | integer | ✅ | Wall-clock time for the entire request, including the LLM call. |

### Source-link contract

The Archivist's system prompt requires that **every quoted line be followed by an attribution and a `[source](URL)` markdown link** when one is available. The URL points back to the original Discord message Ninshubur archived — i.e., the actual `messages.message_url` (or per-member `sourceUrl` for grouped lessons) on Ninshubur's side.

```
"<the quoted line>" — Entu Siri Ninkurgarra, [source](https://discord.com/channels/.../...)
```

If a passage came from a grouped lesson (a `teaching` hit), the link points at the **specific member** whose content contains the quoted line — not the group-level URL. The group URL is a fallback only.

If the archive yields no URL at all, the Archivist attributes by name and date and skips the link rather than fabricating one.

### Crisis short-circuit

When `crisisLevel ≥ 8`, the response looks like this *without* invoking the LLM:

```json
{
  "question": "<your question>",
  "answer": "If you are in crisis, please reach out to someone you trust or call 988 (US Suicide & Crisis Lifeline). The archive is silent on this question.",
  "guide": "archivist",
  "conversationId": "...",
  "crisisLevel": 9,
  "metrics": { "preflightMs": 18, "totalMs": 19 }
}
```

The webhook on the server side may fire (`CRISIS_WEBHOOK_URL` if configured) so a human can reach out.

---

## Errors

All errors return JSON of the shape:

```json
{
  "error": "<Status text>",
  "message": "<Human-readable reason>",
  "details": [ ... ]   // optional, only on 400 (Zod issues)
}
```

| Status | Meaning |
|---|---|
| `400 Bad Request` | The body did not parse, was missing `q`, or `q` failed length validation. `details` carries the Zod issue array. |
| `401 Unauthorized` | `X-API-Key` was missing or didn't match any value in `ASK_API_KEYS`. |
| `404 Not Found` | The route is not mounted on this server (likely `ASK_API_KEYS` is unset in this deployment). Check `/health`. |
| `500 Internal Server Error` | Something went wrong inside the agent or pre-flight stage. The `message` carries the underlying error string; correlate via your `X-Request-Id`. |
| `503 Service Unavailable` | The API-key middleware was invoked but no keys are configured server-side — i.e., misconfiguration. Tell Jenova. |

There is intentionally **no `429`** at present. Rate limiting is a planned follow-up; see [Operational notes](#operational-notes).

---

## Behavior

A few non-obvious things worth knowing for an integration:

### Always the Archivist guide

The endpoint is hardcoded to use `archivist` — the quiet, sourced, attribution-bearing voice. There is no `?guide=` override. If you want a chattier voice (Ninpippa Siri, Ninpipanna), use the authenticated `POST /api/v1/chat` endpoint instead.

### Anonymous and stateless

Each request runs as a fresh, ephemeral anonymous user (`anon:<uuid>`). Concretely:

- **No user-scoped memory is consulted** — L1–L5 lookups against the anon id all return empty. The Archivist sees only the question and what RAG retrieves from Ninshubur's stores.
- **No conversation history** — there is no continuity between calls. Each `/ask` is a brand-new conversation.
- **`conversationId` in the response is ephemeral** — it identifies that single request in server logs; passing it back in a subsequent call has no effect.

### Total Privacy mode

The endpoint runs in **Total Privacy mode** internally:

- **Nothing is persisted** to L1 (Redis), L2 (Postgres), L3 (Neo4j), L4 (Qdrant), or L5 (Mem0).
- The question and answer **are not written** to the conversation store.
- Only **observability data** (traces, metrics, structured logs) is emitted server-side — the question text appears in logs as a 100-char preview by default. Treat the API as you would any other LLM API: the operator can see traffic.

### RAG is the whole point

When the server has `ENABLE_RAG=true` plus `VOYAGE_API_KEY`, `NINSHUBUR_DATABASE_URL`, `NINSHUBUR_QDRANT_URL` configured, the Archivist has access to the `searchKnowledge` tool, which:

1. Embeds the question via Voyage AI (`voyage-3.5`, 1024-dim).
2. Searches Ninshubur's Qdrant collections (`ninshubur_messages`, `ninshubur_groups`).
3. Hydrates hits from Ninshubur's Postgres for full content + source URL.
4. Returns the hits to Claude, who quotes from them in the response.

If RAG is off (e.g., misconfiguration or local dev without Ninshubur stores), the Archivist falls back to "The tablets do not preserve this." for almost every question — the prompt is allergic to inventing.

### What's logged server-side

For every request:

- One INFO log on entry: `conversationId`, `questionLength`, first 100 chars of the question.
- One INFO log on completion: `conversationId`, `totalMs`, `answerLength`.
- OpenTelemetry traces covering pre-flight + each pipeline stage.
- Prometheus metrics for stage durations.

The full question and full answer are **not** persisted in any database. They appear in the live trace span attributes during processing and in the structured logs (which may be shipped to a log aggregator depending on deployment).

---

## Examples

### `curl`

```sh
curl -X POST https://archive.templeofinannaslight.org/api/v1/ask \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $TEMPLE_ARCHIVE_API_KEY" \
  -d '{"q": "What is Ishtaritism?"}'
```

### `httpie`

```sh
http POST https://archive.templeofinannaslight.org/api/v1/ask \
  X-API-Key:"$TEMPLE_ARCHIVE_API_KEY" \
  q="What is Ishtaritism?"
```

### Node 22 (native `fetch`)

```ts
const apiKey = process.env.TEMPLE_ARCHIVE_API_KEY;
if (!apiKey) throw new Error("TEMPLE_ARCHIVE_API_KEY is required");

const res = await fetch(
  "https://archive.templeofinannaslight.org/api/v1/ask",
  {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": apiKey,
    },
    body: JSON.stringify({ q: "What is Ishtaritism?" }),
  },
);

if (!res.ok) {
  const err = await res.json().catch(() => ({}));
  throw new Error(`Ask failed (${res.status}): ${err.message ?? res.statusText}`);
}

const { answer, crisisLevel, metrics } = await res.json();
console.log(answer);
console.log(`crisis: ${crisisLevel}, total: ${metrics.totalMs}ms`);
```

### Python (`requests`)

```py
import os
import requests

resp = requests.post(
    "https://archive.templeofinannaslight.org/api/v1/ask",
    headers={
        "X-API-Key": os.environ["TEMPLE_ARCHIVE_API_KEY"],
        "Content-Type": "application/json",
    },
    json={"q": "What is Ishtaritism?"},
    timeout=60,
)
resp.raise_for_status()
data = resp.json()
print(data["answer"])
```

### Suggested timeout

LLM calls can take anywhere from a few seconds to ~30 seconds depending on tool-call depth. Set client-side timeouts to **at least 60s**. The server's hard ceiling on output tokens caps wall time, but tool-heavy questions (multi-step RAG) sit on the higher end.

---

## Operational notes

### Latency expectations

| Phase | Typical | P95 |
|---|---|---|
| Preflight (system prompt + crisis check) | 30–80 ms | 200 ms |
| LLM + RAG (no tool calls) | 1.5–3 s | 6 s |
| LLM + RAG (1–3 tool calls) | 3–8 s | 15 s |
| LLM + RAG (deeper tool chains) | 8–20 s | 30 s |

These are end-to-end wall times observed in `metrics.totalMs`. Anything > 30 s is unusual and worth flagging.

### Cost

Every call is a real Anthropic API hit (Claude Sonnet) plus, on most calls, a Voyage AI embedding + Qdrant lookup. Per-call cost is small but non-zero — please don't loop on this endpoint without rate limiting on your side. (Server-side rate limiting is on the roadmap; until then, please self-throttle.)

### Rate limiting

**There is no server-side rate limit at present.** Two consequences:

1. Misbehaving clients can drive surprise bills. Self-throttle.
2. If your integration plans high traffic (> ~1 req/sec sustained), tell Jenova *before* turning it on so we can plan capacity.

When server-side rate limiting lands, it will be **per-key**, returned via `429 Too Many Requests` with a `Retry-After` header. Build your client to handle that gracefully today.

### Versioning

The path is `/api/v1/ask`. Breaking changes will cut a `/api/v2/`; backwards-compatible additions land on `v1`. Treat the response shape as additive — new fields may appear; existing field names and types won't change without a major-version bump.

### Status / health

```sh
curl https://archive.templeofinannaslight.org/health
```

Returns `200 OK` when the agent-api is up. There is no `/ask`-specific health probe — if `/health` is green and your key works, `/ask` is good.

### Privacy and consent

The Archivist quotes from the corpus Ninshubur preserved during her backfills. Every quote that lands in an answer was authored by a speaker on Ninshubur's `USER_IDS` list at the time of the scrape — i.e., a consenting High Priestess. See [Ninshubur's consent boundary](https://github.com/jenova-marie/ninshubur#-allowlist-filters--the-consent-boundary) for the full design.

If a Priestess revokes consent and you (Ninshubur) re-run a clean rebuild, her words will stop appearing in `/ask` responses on the next call — there is no separate index in the Temple Archive. Read-side, we just point at your stores.

---

## Testing your integration

A reasonable smoke test from the Ninshubur side:

```sh
# 1. Verify auth works (should return 200)
curl -X POST "$BASE_URL/api/v1/ask" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $KEY" \
  -d '{"q": "test"}'

# 2. Verify a known phrase from your archive comes back attributed
curl -X POST "$BASE_URL/api/v1/ask" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $KEY" \
  -d '{"q": "<a phrase you know is in the archive>"}' | jq .answer
# Look for: a quote, an attribution, and a [source](URL) link.

# 3. Verify the silent-on-this-question fallback
curl -X POST "$BASE_URL/api/v1/ask" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $KEY" \
  -d '{"q": "What is the airspeed velocity of an unladen swallow?"}' | jq .answer
# Expected: "The tablets do not preserve this." (or close variant).

# 4. Verify auth rejection
curl -X POST "$BASE_URL/api/v1/ask" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: bogus" \
  -d '{"q": "test"}'
# Expected: 401 with {"error":"Unauthorized","message":"Invalid API key"}
```

If `(2)` returns a quote without a `[source](URL)` link, that's a bug worth reporting — the Archivist's prompt requires the link whenever the underlying hit carries a URL. Most likely causes: stale Postgres data missing `message_url`, or a hit from `ninshubur_groups` whose member-level URLs haven't been backfilled.

---

## Changelog

| Date | Change |
|---|---|
| 2026-05-08 | Initial spec. `POST /api/v1/ask`, `X-API-Key` auth, archivist guide, single JSON response. |

---

> *May 𒀭Inanna's light guide your queries, and may the answers come back well-sourced.* ✨
