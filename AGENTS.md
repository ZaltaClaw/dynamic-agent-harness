# Agent Contract

## What this repository does

Dynamic Agent Harness is a Next.js 16 / TypeScript 5 starter for composing and exercising durable organizational agent runtimes. The visual studio edits a validated `HarnessSpec`; the server runs a deterministic, credential-free workflow through the same event, subagent, approval, persistence, and artifact boundaries that a model adapter uses.

## Canonical agent sequence

```bash
npm install
npm run test
npm run verify
npm run dev
```

The development server listens on `http://127.0.0.1:3110`. For an isolated smoke test on another port, run `npx next dev --hostname 127.0.0.1 -p <port>`.

## Command contract

- `npm run dev`: starts the Next development server on port 3110. Long-running process; stop with SIGINT.
- `npm run test`: runs the complete Vitest suite once. Exit 0 means every discovered test passed.
- `npm run lint`: runs ESLint with zero warnings allowed.
- `npm run typecheck`: runs strict TypeScript without emitting files.
- `npm run build`: creates a production Next build. It does not deploy or modify remote state.
- `npm run verify`: lint, typecheck, test, then production build. This is the release gate.

## Idempotency and side effects

- Install, lint, typecheck, test, build, and verify are safe to rerun.
- Starting a run creates `.data/runs/<id>.json`, `.data/events/<id>.jsonl`, and, after approval, `.data/artifacts/<id>.json`.
- A run ID is unique. Retrying `POST /api/runs` creates a new run; it does not deduplicate tasks.
- Approval resolution is valid once. Repeating or mismatching an approval must fail rather than execute twice.
- Never commit `.data/`, `.next/`, `node_modules/`, or credentials.

## Architecture invariants

1. `lib/harness/schema.ts` is the sole owner of portable spec types.
2. `lib/harness/compiler.ts` is the sole owner of export translation.
3. Model/workflow, store, sandbox, and policy boundaries stay replaceable; do not import UI code into runtime modules.
4. Tool risk is enforced by runtime code, never only by a system prompt.
5. Events are append-only, ordered per run, and contain progress summaries rather than private chain-of-thought.
6. Secrets stay server-side. Specs and browser payloads contain identifiers and policy, not API keys.
7. The deterministic runbook adapter must be labeled honestly and remain runnable without external credentials.
8. New behavior follows RED -> GREEN -> REFACTOR. Tests live under `tests/`.

## Recovery without the user

1. Port 3110 in use: choose an unused 31xx port, then run `npx next dev --hostname 127.0.0.1 -p <port>` for the smoke test; do not kill unrelated processes.
2. Corrupt local demo state: move `.data/` aside and rerun. Never silently discard a production adapter's data.
3. Font fetch fails during build: verify network first; do not replace Inter/JetBrains Mono without documenting the design change.
4. SSE disconnect: reconnect with the last observed sequence; persisted events are the source of truth.
5. Run stuck at approval: inspect the latest run record and event tail. Resolve only the exact pending approval ID.
6. Schema failure: return the Zod error to the caller; do not coerce unsafe approval policy.

Escalate only for credentials, billing, a confirmed upstream defect, or a product decision that changes public contracts.

## Read next

1. `README.md`: user contract and working demo.
2. `docs/ARCHITECTURE.md`: lifecycle and state machine.
3. `docs/ADAPTERS.md`: production replacement boundaries.
4. `THIRD_PARTY_NOTICES.md`: licensing and copied/inspired boundaries.
5. `tests/`: executable behavior.

## Contributing as an agent

Run `npm run verify` before committing. Keep HTTP JSON fields consistent within this repo, add tests before behavior, preserve accessibility labels, and update both docs and example specs when the contract changes. Do not add interactive setup prompts; every repeatable workflow needs a non-interactive npm script.

## Agent-friendly roadmap

- [ ] Postgres event-store adapter with optimistic sequence allocation
- [ ] Redis/NATS subscription adapter for multi-replica SSE
- [ ] OpenAI-compatible and TrueForge live runtime adapters
- [ ] Container/Daytona sandbox adapters
- [ ] OPA/Cedar policy adapter

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
