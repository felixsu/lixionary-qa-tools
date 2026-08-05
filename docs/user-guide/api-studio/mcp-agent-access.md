# MCP Agent Access: Run Flows from an AI Agent

The local sidecar exposes an **MCP server** (Model Context Protocol, streamable HTTP) so AI agents on your machine — Claude Code, or any MCP-capable client — can run your saved API Studio flows and read the reports. The agent supplies an environment name and a flow name; the app resolves both, executes the flow headlessly, and returns the run report.

Runs are executed by a Python port of the Studio's flow runner inside the sidecar, so the app window does not need to be open. Both flow formats run: port-based (V2) flows use the V2 engine, legacy flows use the original engine — dispatch is automatic per flow. Agent-triggered runs show up in the app: while one is in flight, the Home page's **Flow executions** table shows it as *Running* and the API Studio toolbar shows a pulsing **Agent running** indicator; once finished it appears in the table like any other run, tagged with the **Agent** source. Agent runs don't touch the Studio's last-run panel, and UI runs are unaffected.

## Connecting

The endpoint lives on the sidecar, so the port depends on which flavor you run:

| Flavor | MCP endpoint |
| --- | --- |
| Installed app | `http://127.0.0.1:8484/mcp` |
| Dev app | `http://127.0.0.1:8494/mcp` |
| Source tree (`npm run sidecar:local`) | `http://127.0.0.1:8504/mcp` |

Claude Code example:

```bash
claude mcp add --transport http api-studio http://127.0.0.1:8484/mcp
```

Then, in a session: *"List my API Studio flows and run 'Order Smoke' against the Staging environment."*

## Tools

| Tool | What it does |
| --- | --- |
| `list_environments()` | Saved environments: id, name, and variable **keys** (values are never exposed — they may hold secrets). |
| `list_flows()` | Saved flows: id, name, description, node names/count, and `schemaVersion` (1 = legacy, 2 = port-based). |
| `run_flow(flow, environment?, timeout_seconds?)` | Executes the flow and returns `{runId, report}`. |
| `get_run_report(run_id, format?)` | Full stored report of a past run; `format: "json"` (default) or `"csv"` — the CSV matches the UI's **Report** download. |

### Name resolution

`flow` and `environment` are matched by **name first** (case-insensitive, exact), then by local or cloud **id**. If two entries share a name, the tool returns an error listing the candidate ids; if nothing matches, it lists the available names. Omitting `environment` runs without environment variables (`{{env.*}}` tokens stay unresolved) and the report carries a warning.

### The report

`run_flow` returns a condensed report: overall status, per-status counts, a `failures` digest (`nodeName`, `iteration`/`attempt`, `error`), and the per-node records (one per looper iteration and verifier attempt) with large fields truncated. `get_run_report(runId)` returns the fuller stored version (fields capped at 20,000 characters, like UI persistence). The **most recent 100 runs** (across all flows, agent- and user-triggered) are retained.

`timeout_seconds` (default 600, clamped to 10–1800) cancels a stuck run and still returns a proper report with `status: "cancelled"` and `timeoutHit: true`.

## Notes and caveats

- **Trust model**: the sidecar binds to `127.0.0.1` only and has no authentication — same as the rest of the local API. Anything that can reach localhost can call these tools.
- **Python requirement**: the MCP server needs Python ≥ 3.10 on the machine (the `mcp` package is skipped on older Pythons; the sidecar still runs, with MCP disabled and a note in its logs).
- **Side effects are real**: an agent-triggered run behaves exactly like pressing **Run** — requests actually fire, and parser `env.set()` writes persist to the environment (and sync to the cloud on the next pass).
- Report data may embed resolved input values (same exposure as the UI's CSV report).
