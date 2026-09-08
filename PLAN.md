# Hound Mode Pi Extension

## Context

Create a project-local Pi extension that adds an **🐶 Hound** mode through:

```text
/hound <linear-url|incident name>
```

All extension-originated user-visible interactions must use the `🐶` prefix. The first call requires a target and enables the mode. After configuration, `/hound` toggles the mode off or on. `/hound <new-target>` replaces the configured target and enables the mode. The configured target and enabled state must survive `/reload` and `/resume`.

Targets:
- **Linear ticket URL:** Post investigation updates as one or more ticket comments through an active MCP/Linear tool. If no suitable active tool exists, or the Linear server is unavailable through a generic MCP gateway, remind the user and do not claim that an update was posted.
- **Incident name:** Create and maintain a Markdown file in the current project root. Convert the name to uppercase kebab case; for example, `SQLSRV1 Data Exfil` becomes `HOUND_SQLSRV1-DATA-EXFIL.md`.

Investigation updates must be concise and suitable for third-party audit. Every fact must cite verifiable evidence, such as a SIEM query URL, log source query URL, webpage URL, API documentation URL, or local source path with line references. A weak or unsupported fact must contain `<EVIDENCE-NEEDED>`. The Incident Summary may include expert assessments derived from cited facts. Treat the investigator (the user) as the domain expert and preserve their professional judgment without requiring direct proof of the inferred conclusion. The update must still label the judgment as an assessment, attribute it to the investigator when it originates from the user, identify its supporting facts, cite evidence for those facts, and use calibrated language such as `likely` or `unlikely` rather than present the inference as an observed fact. Use ASD-STE100-style language for Timeline and Findings: short sentences, active voice, one fact per sentence, consistent terms, defined acronyms, and no ambiguous pronouns. The Incident Summary can use a more natural briefing style, but it must remain concise and auditable.

Each investigation record uses these sections:
1. **Incident Description** — the fixed initial event that triggered the incident.
2. **Timeline** — continuously updated actor activities in UTC. Ask the user when source timezone information is unclear.
3. **Findings** — facts with evidence references or `<EVIDENCE-NEEDED>`.
4. **Incident Summary** — current progress derived from the fixed description and gathered facts. It can include clearly labeled expert assessments whose premises have evidence references.

## Approach

Implement a small multi-file extension with testable pure utilities.

### Command and state

Maintain a typed state containing `enabled` and a `linear` or `local` target. Persist each configuration/toggle change with `pi.appendEntry("hound-state", state)`. During `session_start`, restore the latest state entry on the active session branch and restore the status indicator.

Command behavior:
- No configured target and no argument: show usage and do not enable the mode.
- Any call with an argument: parse and replace the target, initialize it if required, enable the mode, persist state, and update status.
- A configured target with no argument: toggle enabled/disabled, persist state, and update status.
- For a new local file, immediately open `ctx.ui.editor()` to collect a non-empty Incident Description. Cancel setup if the user cancels or submits empty text.
- If the local file already exists, preserve it and its Incident Description instead of overwriting or prompting again.

### Local incident files

Sanitize local names by uppercasing, replacing each run of non-ASCII-alphanumeric characters with `-`, trimming leading/trailing dashes, rejecting an empty result, and appending `.md`. Resolve the filename directly under `ctx.cwd`.

Initialize a new file atomically with the four required headings. Record the user-provided description as immutable source text. Add `<EVIDENCE-NEEDED>` when the initial description has no explicit evidence reference. Later prompt instructions require the agent to read the existing file, preserve Incident Description, append/merge Timeline and Findings, and refresh Incident Summary.

Use a consistent update shape so evidence can be reviewed mechanically:

```md
## Timeline
- 2026-01-30 14:05 UTC — The service returned HTTP 500.
  Evidence: [SIEM query](https://...)

## Findings
- Fact: The failure started after deployment `abc123`.
  Evidence: `deployments/release.log:42-48`

## Incident Summary
- Fact: The host uses an egress allowlist.
  Evidence: [Allowlist configuration](https://...)
- Assessment (Investigator): The malicious binary was unlikely to reach its command-and-control server. Credential exfiltration was therefore unlikely.
  Basis: The host uses the cited egress allowlist.
  Evidence: [Allowlist configuration](https://...)
```

When evidence is unavailable, use `Evidence: <EVIDENCE-NEEDED>`. The investigator is the recognized expert. Their assessments do not require direct proof of the conclusion, but every factual premise used to form an assessment must have evidence. Attribute user-provided judgments to `Investigator`, and distinguish every inference from observed fact.

### Linear MCP integration

Use `pi.getActiveTools()` and `pi.getAllTools()` metadata to detect either:
- an active Linear-specific issue/comment tool; or
- an active generic MCP gateway tool.

If neither exists, notify the user that Linear MCP must be connected or enabled. If only a generic MCP gateway exists, inject instructions requiring the agent to verify that its Linear server is connected before posting. A missing server, authentication failure, or failed comment call must produce a user reminder and must not be reported as success. Re-detect tools before each active Hound turn so tools enabled after startup are recognized.

The extension does not call arbitrary registered tools directly because Pi exposes them to the model rather than as an extension invocation API. It gives the model the detected tool names and strict instructions to fetch the ticket context and post the update through the MCP tool.

### Prompt and warning-only review

While enabled, use `before_agent_start` to append a stable Hound instruction block containing:
- target type and exact URL/path;
- required section structure;
- fixed Incident Description rule;
- UTC conversion and timezone clarification rule;
- ASD-STE100-style writing rules;
- one evidence reference per fact;
- clearly labeled expert assessments, attribution of user-provided judgments to the investigator, cited factual premises, and calibrated confidence language;
- `<EVIDENCE-NEEDED>` for unsupported factual premises;
- the detected Linear/MCP tool names and connection-check requirement where applicable.

Add a best-effort, warning-only review in `tool_call` for writes/edits to the active local file and calls to detected Linear/MCP tools. Recursively inspect string arguments and warn through `ctx.ui.notify()` when Timeline, Findings, or Summary content appears to contain facts without nearby `Evidence:` text, a URL/source reference, or `<EVIDENCE-NEEDED>`. Permit clearly labeled `Assessment:` or `Assessment (Investigator):` items, and treat the user as the recognized expert. Warn when an assessment does not include a `Basis:` tied to cited facts or when it states an inference as an observed fact. Also warn if an edit appears to alter Incident Description. Do not block or silently rewrite tool input. Prompt instructions remain the primary control because arbitrary MCP schemas and natural-language facts cannot be validated perfectly.

Use `tool_result` to surface failed detected MCP/Linear calls as a reminder to connect or authenticate Linear MCP.

## Files to modify

- `package.json` — package metadata, Pi manifest, and test script for `pi-hound-mode`.
- `extensions/hound/index.ts` — extension registration, command lifecycle, persisted state, prompt injection, status UI, and warning hooks.
- `extensions/hound/utils.ts` — target parsing, filename sanitization, tool detection, template generation, and evidence-review helpers.
- `extensions/hound/utils.test.ts` — focused unit tests for pure behavior.
- `README.md` — package installation, command usage, MCP expectation, document format, and audit rules.
- Runtime-created `<SANITIZED-INCIDENT-NAME>.md` files in the project root.

## Reuse

- `examples/extensions/pirate.ts`: command-controlled state and `before_agent_start` prompt injection.
- `examples/extensions/preset.ts`: `getActiveTools()`, `getAllTools()`, command handling, and `setStatus()` patterns.
- `examples/extensions/plan-mode/index.ts`: `appendEntry()` persistence and session restoration patterns.
- Pi `SessionManager.getBranch()` from `docs/session-format.md`: restore the latest state from the active branch rather than an abandoned branch.
- Node built-ins `node:fs/promises` and `node:path`: safe local file initialization without runtime dependencies.

## Steps

- [x] Add pure utilities for Linear URL recognition, uppercase kebab-case filenames, state validation, incident templates, active MCP/Linear tool detection, recursive string extraction, and warning-only evidence checks.
- [x] Register `/hound` and implement first-run setup, target replacement, toggling, local description prompt, and existing-file preservation.
- [x] Persist state after each change and restore the latest active-branch state on startup, reload, and resume.
- [x] Add concise notifications and a footer status showing enabled target type/name; show an MCP warning state for Linear targets without a suitable active tool.
- [x] Inject the audit, ASD-STE100-style, UTC, evidence, expert-assessment, section, local-file, and Linear MCP instructions while the mode is enabled.
- [x] Add warning-only inspection for local document updates, Linear/MCP comment calls, Incident Description changes, and failed MCP results.
- [x] Add unit tests and usage documentation.

## Verification

Automated checks:
- Test `SQLSRV1 Data Exfil` → `HOUND_SQLSRV1-DATA-EXFIL.md`, punctuation runs, leading/trailing separators, and invalid empty names.
- Test valid Linear issue URLs versus ordinary URLs/names.
- Test state parsing/restoration and active-branch latest-entry selection.
- Test detection of Linear-specific and generic MCP tools using both names and descriptions.
- Test incident template headings, description preservation helpers, recursive MCP argument extraction, evidence warnings/placeholders, and acceptance of labeled assessments with cited premises.

Manual end-to-end checks:
- Load the package with `pi -e ./extensions/hound/index.ts` or install `pi-hound-mode`, then use `/hound` before setup and confirm it shows usage.
- Run `/hound SQLSRV1 Data Exfil`, enter a description, and verify `HOUND_SQLSRV1-DATA-EXFIL.md` is initialized once with all four sections.
- Run `/hound` twice and verify off/on status without losing the target. Run `/hound <new-target>` and verify replacement plus activation.
- Reload and resume the session; verify the target and enabled state return.
- Request an investigation update with known and unknown evidence. Verify UTC timestamps, concise controlled language, explicit evidence per fact, and `<EVIDENCE-NEEDED>` for weak facts.
- Add a user-provided expert opinion to Incident Summary. Verify the extension treats the user as the recognized investigator, attributes the judgment to `Investigator`, labels it as an assessment, uses calibrated language, identifies its factual basis, and cites evidence for that basis without requiring direct proof of the inferred conclusion.
- Attempt to update Incident Description and verify a warning appears while the extension does not rewrite or block the call.
- Configure a Linear URL with no MCP tool, a generic MCP tool without a connected Linear server, and a working Linear comment tool. Verify reminders for the first two cases and a real ticket comment for the final case.
- Confirm failed MCP calls are visible and are never described as successful updates.
