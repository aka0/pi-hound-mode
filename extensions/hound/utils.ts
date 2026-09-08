export type HoundTarget =
	| { type: "linear"; url: string; label: string }
	| { type: "local"; incidentName: string; fileName: string; filePath: string; label: string };

export interface HoundState {
	enabled: boolean;
	target?: HoundTarget;
}

export interface ToolMetadata {
	name: string;
	description?: string;
}

export interface DetectedHoundTools {
	linearCommentTools: string[];
	genericMcpTools: string[];
	allCandidateTools: string[];
}

const LINEAR_HOST = "linear.app";
const LINEAR_ISSUE_RE = /^\/[^/]+\/issue\/([A-Z][A-Z0-9]+-\d+)(?:\/|$)/i;
const URL_RE = /https?:\/\/\S+/i;
const SOURCE_REF_RE = /(?:https?:\/\/\S+|(?:^|\s)[^\s/]+\/[\w.@~-]+(?:[/:#]\S*)?)/i;
const EVIDENCE_NEEDED_RE = /<EVIDENCE-NEEDED>/i;

export function isLinearUrl(input: string): boolean {
	try {
		const url = new URL(input.trim());
		return (url.protocol === "http:" || url.protocol === "https:") &&
			url.hostname.toLowerCase() === LINEAR_HOST && LINEAR_ISSUE_RE.test(url.pathname);
	} catch {
		return false;
	}
}

export function getLinearLabel(url: string): string {
	try {
		const match = new URL(url).pathname.match(LINEAR_ISSUE_RE);
		return match?.[1]?.toUpperCase() ?? "Linear ticket";
	} catch {
		return "Linear ticket";
	}
}

export function sanitizeIncidentFileName(name: string): string {
	const base = name.normalize("NFKD").toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-+|-+$/g, "");
	if (!base) throw new Error("Incident name must contain at least one letter or number.");
	return `HOUND_${base}.md`;
}

export function makeIncidentTemplate(description: string): string {
	return `# Hound Incident Record\n\n## Incident Description\n\n${description.trim()}\n\nEvidence: <EVIDENCE-NEEDED>\n\n## Timeline\n\n- <UTC time> — <actor activity>\n  Evidence: <EVIDENCE-NEEDED>\n\n## Findings\n\n- Fact: <fact>\n  Evidence: <EVIDENCE-NEEDED>\n\n## Incident Summary\n\n- <summary for briefing>\n  Evidence: <EVIDENCE-NEEDED>\n`;
}

export function detectHoundTools(activeToolNames: string[], allTools: ToolMetadata[]): DetectedHoundTools {
	const active = new Set(activeToolNames);
	const linearCommentTools: string[] = [];
	const genericMcpTools: string[] = [];
	for (const tool of allTools) {
		if (!active.has(tool.name)) continue;
		const haystack = `${tool.name} ${tool.description ?? ""}`.toLowerCase();
		const isMcp = /\bmcp\b|model context protocol/.test(haystack);
		const isLinear = /\blinear\b/.test(haystack);
		const isReadOnly = /\b(read|get|fetch|search|list|query|retrieve|view)\b/.test(haystack);
		const canComment = /\b(comment|reply|post|create|add|write|update)\b/.test(haystack);
		if (isLinear && canComment && !isReadOnly) linearCommentTools.push(tool.name);
		else if (isMcp) genericMcpTools.push(tool.name);
	}
	return { linearCommentTools, genericMcpTools, allCandidateTools: [...linearCommentTools, ...genericMcpTools] };
}

export function extractStrings(value: unknown): string[] {
	if (typeof value === "string") return [value];
	if (Array.isArray(value)) return value.flatMap(extractStrings);
	if (value && typeof value === "object") return Object.values(value as Record<string, unknown>).flatMap(extractStrings);
	return [];
}

export function hasEvidenceReference(text: string): boolean {
	return EVIDENCE_NEEDED_RE.test(text) || /\bEvidence\s*:\s*\S/im.test(text) || URL_RE.test(text) || SOURCE_REF_RE.test(text);
}

function isRecordLine(line: string): boolean {
	return /^\s*[-*]\s+(?:Fact:|Assessment(?:\s*\([^)]*\))?:|\d{4}-\d{2}-\d{2})/i.test(line);
}

export function reviewEvidence(text: string): string[] {
	const warnings: string[] = [];
	const lines = text.split(/\r?\n/);
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i] ?? "";
		if (!isRecordLine(line)) continue;
		const itemLines: string[] = [line];
		for (let j = i + 1; j < lines.length && !isRecordLine(lines[j] ?? ""); j++) itemLines.push(lines[j] ?? "");
		const item = itemLines.join("\n");
		if (!hasEvidenceReference(item)) warnings.push(`Missing evidence reference near: ${trimForWarning(line.trim())}`);
		if (/^\s*[-*]\s+Assessment(?:\s*\([^)]*\))?:/i.test(line) && !/\bBasis\s*:/i.test(item)) {
			warnings.push(`Assessment missing Basis near: ${trimForWarning(line.trim())}`);
		}
		i += itemLines.length - 1;
	}
	return warnings;
}

export function reviewIncidentDescriptionChange(input: unknown, existingContent?: string): string[] {
	if (!input || typeof input !== "object") return [];
	const record = input as Record<string, unknown>;
	const oldText = typeof record.oldText === "string" ? record.oldText : undefined;
	const newText = typeof record.newText === "string" ? record.newText : undefined;
	if (oldText && newText && oldText !== newText) {
		if (/##\s*Incident Description/i.test(oldText) || (existingContent && extractSection(existingContent, "Incident Description")?.includes(oldText.trim()))) {
			return ["Incident Description appears to change. This section must stay fixed after initialization."];
		}
	}
	if (typeof record.content === "string" && existingContent) {
		const oldDescription = extractSection(existingContent, "Incident Description");
		const newDescription = extractSection(record.content, "Incident Description");
		if (oldDescription && newDescription && oldDescription !== newDescription) {
			return ["Incident Description appears to change. This section must stay fixed after initialization."];
		}
	}
	return [];
}

function extractSection(content: string, heading: string): string | undefined {
	const match = content.match(new RegExp(`##\\s*${heading}\\s*\\n([\\s\\S]*?)(?=\\n##\\s|$)`, "i"));
	return match?.[1]?.trim();
}

export function parseHoundState(value: unknown): HoundState | undefined {
	if (!value || typeof value !== "object") return undefined;
	const state = value as HoundState;
	if (typeof state.enabled !== "boolean") return undefined;
	if (!state.target) return { enabled: state.enabled };
	if (state.target.type === "linear" && typeof state.target.url === "string") return state;
	if (state.target.type === "local" && typeof state.target.fileName === "string" && typeof state.target.filePath === "string") return state;
	return undefined;
}

function trimForWarning(text: string): string {
	return text.length > 120 ? `${text.slice(0, 117)}...` : text;
}
