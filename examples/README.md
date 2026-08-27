# Agent examples

The JSON files in this directory are portable `HarnessSpec` inputs. They contain identifiers and policy only; never place provider credentials in a spec.

## Agent quickstart

From the repository root:

```bash
npm ci
npm run verify
npm run dev
```

`npm run dev` is a long-running localhost process on `127.0.0.1:3110`. Keep it in its own process, then use a second shell or agent terminal to create a run from the checked-in example:

```bash
node --input-type=module -e '
  import { readFile } from "node:fs/promises";
  const spec = JSON.parse(await readFile("examples/incident-triage.harness.json", "utf8"));
  const response = await fetch("http://127.0.0.1:3110/api/runs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ prompt: "Create a governed incident harness", spec }),
  });
  console.log(response.status, await response.text());
  if (!response.ok) process.exit(1);
'
```

A successful request returns HTTP `201 Created` with a generated run ID. Observe its ordered stream at `/api/runs/<run-id>/events`; resolve only the exact `approvalId` carried by the `approval.required` event.

## Safe reuse

- Re-running the command creates a new run; it does not overwrite an earlier run.
- Local state belongs under `.data/` and must not be committed.
- The bundled JSONL runtime is localhost-only and single-host. See [`docs/ADAPTERS.md`](../docs/ADAPTERS.md) before shared deployment.
