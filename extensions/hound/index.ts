import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
	detectHoundTools,
	extractStrings,
	getLinearLabel,
	isLinearUrl,
	makeIncidentTemplate,
	parseHoundState,
	reviewEvidence,
	reviewIncidentDescriptionChange,
	sanitizeIncidentFileName,
	type DetectedHoundTools,
	type HoundState,
	type HoundTarget,
} from "./utils.ts";

const STATE_TYPE = "hound-state";
const DOG = "🐶";

export default function houndModeExtension(pi: ExtensionAPI): void {
	let state: HoundState = { enabled: false };
	let detectedTools: DetectedHoundTools = { linearCommentTools: [], genericMcpTools: [], allCandidateTools: [] };

	function notify(ctx: ExtensionContext, message: string, level: "info" | "warning" | "error" = "info"): void {
		ctx.ui.notify(`${DOG} ${message}`, level);
	}

	function targetDisplay(target = state.target): string {
		if (!target) return "not configured";
		return target.type === "linear" ? target.label : target.fileName;
	}

	function refreshDetectedTools(): void {
		detectedTools = detectHoundTools(pi.getActiveTools(), pi.getAllTools());
	}

	function updateStatus(ctx: ExtensionContext): void {
		if (!state.target) {
			ctx.ui.setStatus("hound", undefined);
			return;
		}
		refreshDetectedTools();
		const label = targetDisplay();
		if (!state.enabled) {
			ctx.ui.setStatus("hound", ctx.ui.theme.fg("muted", `${DOG} hound off: ${label}`));
			return;
		}
		if (state.target.type === "linear" && detectedTools.allCandidateTools.length === 0) {
			ctx.ui.setStatus("hound", ctx.ui.theme.fg("warning", `${DOG} hound: ${label} MCP needed`));
			return;
		}
		ctx.ui.setStatus("hound", ctx.ui.theme.fg("accent", `${DOG} hound: ${label}`));
	}

	function persist(): void {
		pi.appendEntry(STATE_TYPE, state);
	}

	function findPersistedState(ctx: ExtensionContext): HoundState | undefined {
		const branch = ctx.sessionManager.getBranch();
		for (let i = branch.length - 1; i >= 0; i--) {
			const entry = branch[i] as { type?: string; customType?: string; data?: unknown };
			if (entry.type === "custom" && entry.customType === STATE_TYPE) {
				const parsed = parseHoundState(entry.data);
				if (parsed) return parsed;
			}
		}
		return undefined;
	}

	async function configureTarget(rawArg: string, ctx: ExtensionContext): Promise<boolean> {
		const arg = rawArg.trim();
		if (!arg) return false;

		if (isLinearUrl(arg)) {
			state = { enabled: true, target: { type: "linear", url: arg, label: getLinearLabel(arg) } };
			refreshDetectedTools();
			persist();
			updateStatus(ctx);
			notify(ctx, `Hound Mode enabled for ${targetDisplay()}.`);
			if (detectedTools.allCandidateTools.length === 0) {
				notify(ctx, "Linear target configured. Connect or enable a Linear MCP tool before posting updates.", "warning");
			}
			return true;
		}

		const fileName = sanitizeIncidentFileName(arg);
		const filePath = resolve(ctx.cwd, fileName);
		const target: HoundTarget = { type: "local", incidentName: arg, fileName, filePath, label: fileName };

		if (!existsSync(filePath)) {
			const description = await ctx.ui.editor(
				`${DOG} Incident Description (required)`,
				"", 
			);
			if (!description?.trim()) {
				notify(ctx, "Hound setup cancelled. Incident Description is required.", "warning");
				return false;
			}
			await mkdir(ctx.cwd, { recursive: true });
			await writeFile(filePath, makeIncidentTemplate(description), { flag: "wx" });
			notify(ctx, `Created ${fileName}.`);
		} else {
			notify(ctx, `Using existing ${fileName}. Incident Description will be preserved.`);
		}

		state = { enabled: true, target };
		persist();
		updateStatus(ctx);
		notify(ctx, `Hound Mode enabled for ${fileName}.`);
		return true;
	}

	pi.registerCommand("hound", {
		description: "Toggle or configure Hound Mode for audit-ready incident investigation",
		handler: async (args, ctx) => {
			await ctx.waitForIdle();
			const arg = args?.trim() ?? "";
			if (arg) {
				try {
					await configureTarget(arg, ctx);
				} catch (err) {
					notify(ctx, `Failed to configure Hound Mode: ${err instanceof Error ? err.message : String(err)}`, "error");
				}
				return;
			}

			if (!state.target) {
				notify(ctx, "Usage: /hound <linear-url|incident name>", "warning");
				return;
			}

			state = { ...state, enabled: !state.enabled };
			persist();
			updateStatus(ctx);
			notify(ctx, state.enabled ? `Hound Mode enabled for ${targetDisplay()}.` : "Hound Mode disabled.");
		},
	});

	pi.on("session_start", async (_event, ctx) => {
		const restored = findPersistedState(ctx);
		if (restored) state = restored;
		refreshDetectedTools();
		updateStatus(ctx);
	});

	pi.on("before_agent_start", async (event, ctx) => {
		if (!state.enabled || !state.target) return;
		refreshDetectedTools();
		updateStatus(ctx);

		const linearInstruction = state.target.type === "linear"
			? `\nLinear target: ${state.target.url}\nDetected Linear/MCP tools: ${detectedTools.allCandidateTools.length ? detectedTools.allCandidateTools.join(", ") : "none"}.\nIf no detected tool is available, tell the user: "${DOG} Linear MCP is not connected or enabled." Use Linear tools only to read the ticket and add one or more comments. Do not modify the ticket description or other fields. Do not claim that a comment was posted unless the comment tool call succeeds. If a generic MCP tool is detected, verify that its Linear server is connected before posting.`
			: "";
		const localInstruction = state.target.type === "local"
			? `\nLocal Hound file: ${state.target.filePath}\nBefore each update, read this file. Preserve the Incident Description exactly. Update Timeline, Findings, and Incident Summary in this file.`
			: "";

		return {
			systemPrompt: `${event.systemPrompt}\n\n${DOG} HOUND MODE ACTIVE\nYou are helping the investigator create an audit-ready incident record. Prefix extension-originated status text with ${DOG}.\n${localInstruction}${linearInstruction}\n\nRequired sections:\n- Incident Description: fixed initial event. Do not change it after setup.\n- Timeline: actor activities only. Use UTC. Ask for timezone clarification when needed.\n- Findings: facts only. Each fact must include Evidence with a URL, source path with lines, query link, API document link, command output reference, or <EVIDENCE-NEEDED>.\n- Incident Summary: briefing summary. It can be less controlled than ASD-STE100, but it must stay concise and auditable. It may include expert assessments from the investigator. Label them as Assessment (Investigator), use likely/unlikely language, give Basis, and cite evidence for each factual premise.\n\nWriting rules for Timeline and Findings:\n- Use ASD-STE100-style language: short sentences, active voice, one fact per sentence, consistent terms, defined acronyms, and no ambiguous pronouns.\n- Do not state unsupported facts. Use <EVIDENCE-NEEDED> when evidence is missing.\n- For SIEM or log source searches, include the exact query URL or saved-search URL.\n- For webpages or API docs, include the exact URL.\n- For code or local evidence, include the path and line range when possible.\n\nWhen the user asks to update the investigation, prepare an audit-ready update and publish it to the configured target. For Linear, post it as a comment only. For local mode, update the HOUND markdown file. If evidence is weak, add <EVIDENCE-NEEDED> so the investigator can see what needs more work. Report whether the update was drafted, posted, written locally, or failed.`,
		};
	});

	pi.on("tool_call", async (event, ctx) => {
		if (!state.enabled || !state.target) return;
		refreshDetectedTools();
		const toolName = event.toolName;
		const input = event.input as Record<string, unknown>;
		const strings = extractStrings(input);
		const targetText = strings.join("\n");
		const isLocalWriteTool = state.target.type === "local" && ["write", "edit"].includes(toolName) && strings.some((s) => s === state.target.filePath || s === state.target.fileName || resolve(ctx.cwd, s) === state.target.filePath);
		const isMcpUpdate = state.target.type === "linear" && detectedTools.allCandidateTools.includes(toolName);

		if (!isLocalWriteTool && !isMcpUpdate) return;

		let existingContent: string | undefined;
		if (isLocalWriteTool && state.target.type === "local" && existsSync(state.target.filePath)) {
			try { existingContent = readFileSync(state.target.filePath, "utf8"); } catch { /* warning checks are best effort */ }
		}
		const warnings = [...reviewEvidence(targetText), ...reviewIncidentDescriptionChange(input, existingContent)];
		for (const warning of warnings.slice(0, 3)) {
			notify(ctx, warning, "warning");
		}
	});

	pi.on("tool_result", async (event, ctx) => {
		if (!state.enabled || state.target?.type !== "linear") return;
		refreshDetectedTools();
		if (detectedTools.allCandidateTools.includes(event.toolName) && event.isError) {
			notify(ctx, "Linear MCP call failed. Check MCP connection and authentication before relying on ticket updates.", "warning");
		}
	});
}
