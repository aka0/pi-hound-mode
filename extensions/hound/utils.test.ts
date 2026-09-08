import assert from "node:assert/strict";
import {
	detectHoundTools,
	extractStrings,
	getLinearLabel,
	isLinearUrl,
	makeIncidentTemplate,
	reviewEvidence,
	reviewIncidentDescriptionChange,
	sanitizeIncidentFileName,
} from "./utils.ts";

assert.equal(sanitizeIncidentFileName("SQLSRV1 Data Exfil"), "HOUND_SQLSRV1-DATA-EXFIL.md");
assert.equal(sanitizeIncidentFileName("  sqlsrv1: data/exfil!! "), "HOUND_SQLSRV1-DATA-EXFIL.md");
assert.throws(() => sanitizeIncidentFileName("!!!"));

assert.equal(isLinearUrl("https://linear.app/acme/issue/SEC-123/test"), true);
assert.equal(isLinearUrl("https://notlinear.app/acme/issue/SEC-123/test"), false);
assert.equal(isLinearUrl("https://linear.app/acme/project/SEC-123"), false);
assert.equal(isLinearUrl("SQLSRV1 Data Exfil"), false);
assert.equal(getLinearLabel("https://linear.app/acme/issue/SEC-123/test"), "SEC-123");

const tools = detectHoundTools(["linear_comment", "mcp"], [
	{ name: "linear_comment", description: "Add comment to a Linear issue" },
	{ name: "linear_get_issue", description: "Read a Linear issue" },
	{ name: "mcp", description: "MCP gateway" },
	{ name: "read", description: "Read files" },
]);
assert.deepEqual(tools.linearCommentTools, ["linear_comment"]);
assert.deepEqual(tools.genericMcpTools, ["mcp"]);

assert.deepEqual(extractStrings({ a: "x", b: ["y", { c: "z" }] }), ["x", "y", "z"]);

const template = makeIncidentTemplate("Initial event");
assert.match(template, /## Incident Description/);
assert.match(template, /## Timeline/);
assert.match(template, /## Findings/);
assert.match(template, /## Incident Summary/);

assert.equal(reviewEvidence("- Fact: SQLSRV1 contacted 1.2.3.4\n  Evidence: https://example.com/query").length, 0);
assert.ok(reviewEvidence("- Fact: SQLSRV1 contacted 1.2.3.4").some((w) => w.includes("Missing evidence")));
assert.ok(reviewEvidence("- Fact: unsupported claim\n- Fact: supported claim\n  Evidence: https://example.com/query").some((w) => w.includes("unsupported claim")));
assert.ok(reviewEvidence("- Fact: unsupported claim\n  Evidence:").some((w) => w.includes("Missing evidence")));
assert.equal(reviewEvidence("- Assessment (Investigator): Exfiltration was unlikely.\n  Basis: SQLSRV1 uses an egress allowlist.\n  Evidence: https://example.com/allowlist").length, 0);
assert.ok(reviewIncidentDescriptionChange({ oldText: "## Incident Description\n\nOld", newText: "## Incident Description\n\nNew" }).length > 0);
assert.ok(reviewIncidentDescriptionChange({ content: "## Incident Description\n\nNew" }, "## Incident Description\n\nOld\n\n## Timeline").length > 0);

console.log("hound utils tests passed");
