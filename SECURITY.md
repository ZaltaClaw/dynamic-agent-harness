# Security policy

Please do not open public issues for vulnerabilities. Use **Report a vulnerability** under the repository's **Security** tab when GitHub private vulnerability reporting is enabled. Maintainers must enable that channel before public release. If the button is unavailable, ask the repository owner for a private contact method without including vulnerability details.

Include the affected revision, reproduction, impact, and whether the issue crosses the model/runtime, approval, sandbox, event-store, or browser boundary. Never include live API keys or customer data.

The local JSONL mode is a development starter. It has no authentication, and the provided `npm run dev` and `npm start` scripts therefore bind explicitly to the IPv4 loopback interface `127.0.0.1`. Do not widen that binding for untrusted or shared use. A shared deployment requires authentication, authorization, a production store, durable jobs, secret management, and an isolated sandbox.

`HARNESS_DATA_ROOT` is trusted server configuration. Never derive it from an HTTP request, portable spec, model output, or other untrusted input. Run IDs and artifact identifiers are validated independently and public payloads use logical paths rather than host filesystem paths.
