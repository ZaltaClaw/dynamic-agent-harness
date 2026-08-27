# Production adapters

The starter deliberately ships one complete local path and explicit replacement boundaries.

## Model or workflow adapter

Replace the deterministic runbook with an adapter that consumes `HarnessSpec`, emits the existing event union, and returns tool requests through the policy port. Keep provider credentials in server environment or a secrets manager; never add them to the portable spec.

Recommended integrations:

- TrueForge saved agents or inline `AgentSpec`
- an OpenAI-compatible Responses/Chat endpoint
- Anthropic, Azure OpenAI, or a local Ollama/vLLM endpoint
- a deterministic organizational runbook for regulated workflows

A production adapter must implement cancellation, iteration limits, timeouts, structured error events, tool result size limits, and trace correlation.

## Store adapter

JSONL is the included single-host reference adapter. It uses restrictive local permissions and serialized appends, but it is not a substitute for a transactional database or durable job queue. For multiple replicas, implement the same operations over Postgres and allocate event sequences and state transitions transactionally. Publish appends through Redis, NATS, or Postgres LISTEN/NOTIFY so an SSE connection on another replica receives them.

## Job adapter

The local runtime survives a browser disconnect, not a host crash. Use a durable queue or workflow engine for restart-safe execution:

- Temporal
- Inngest
- Trigger.dev
- BullMQ
- a database lease loop

Persist checkpoints before side effects. Every external mutation needs an idempotency key derived from run + tool call.

## Sandbox adapter

The portable values are `local`, `container`, and `daytona`. `local` must never be exposed to untrusted model-generated code. A production sandbox should enforce filesystem roots, CPU/memory/time limits, network egress policy, and secret scoping.

## Policy adapter

The included risk policy is intentionally small. Larger organizations can map the same gate to OPA, Cedar, or an internal entitlement service. Resolve actor identity on the server; never trust a browser-supplied actor header.

## TrueForge export

`toTrueForgeManifest()` uses the source schema inspected from `trueforge-core`:

- `model.name`
- `mcp_servers`
- `config.iteration_limit`
- `config.dynamic_sub_agents`
- `config.context_management`
- name-only `skills`

The generated MCP server name is a reference. Configure that connector and its credentials in TrueForge before creating the agent.

The inspected TrueForge sandbox object exposes `enabled` and `file_downloads` but no network-policy field. The exporter therefore preserves `fileDownloads` exactly and rejects source policies `none` and `allowlist`; it never converts either to unrestricted egress. Set `network: "unrestricted"` explicitly only when that is the intended target policy.
