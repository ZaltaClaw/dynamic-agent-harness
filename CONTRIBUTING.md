# Contributing

Read `AGENTS.md` first. Changes must stay non-interactive, restart-aware, and honest about which adapters are implemented.

1. Create a focused branch.
2. Write and run a failing test for behavior changes.
3. Implement the smallest passing change.
4. Run `npm run verify`.
5. Update contracts, examples, and third-party notices when relevant.

Do not commit credentials, `.data`, generated Next output, or copied commercial icon assets. New commands must be safe for an AI agent to run without an interactive prompt. Runtime retries must not duplicate external side effects.
