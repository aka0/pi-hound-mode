# pi-hound-mode 🐶

A Pi package that adds Hound Mode for audit-ready incident investigation.

Hound Mode creates audit-ready incident records.

## Install

From a published package:

```bash
pi install npm:pi-hound-mode
```

For local development, load the package directory or run `pi -e ./extensions/hound/index.ts`.

## Command

```text
/hound <linear-url|incident name>
/hound
```

First use requires a target. Later `/hound` calls toggle the mode off or on. `/hound <new-target>` replaces the current target and enables the mode.

## Targets

- Linear URL: Hound instructs the agent to post updates through an active Linear/MCP tool. If no active tool is detected, Hound reminds you to connect or enable Linear MCP.
- Incident name: Hound creates a local file named `HOUND_<INCIDENT>.md`. Example: `SQLSRV1 Data Exfil` becomes `HOUND_SQLSRV1-DATA-EXFIL.md`.

## Required sections

- Incident Description: fixed initial event. Hound asks for this when it creates a local file.
- Timeline: actor activities in UTC.
- Findings: facts with evidence references.
- Incident Summary: briefing summary. It can include investigator expert assessments when the factual basis is cited.

## Evidence rules

Every fact needs evidence: a query URL, webpage URL, API doc URL, source path with line numbers, or another verifiable reference. Use `<EVIDENCE-NEEDED>` for weak premises.
