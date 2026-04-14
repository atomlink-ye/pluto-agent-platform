import type { AgentTimelineItem, ToolCallDetail } from "./agent-sdk-types.js";
import { buildToolCallDisplayModel } from "../../shared/tool-call-display.js";

const DEFAULT_MAX_ITEMS = 0;
const MAX_TOOL_INPUT_CHARS = 400;
const MAX_TOOL_SUMMARY_CHARS = 200;

function appendText(buffer: string, text: string): string {
  const normalized = text.trim();
  if (!normalized) return buffer;
  return buffer ? `${buffer}\n${normalized}` : normalized;
}

function flushBuffers(lines: string[], buffers: { message: string; thought: string }) {
  if (buffers.message.trim()) lines.push(buffers.message.trim());
  if (buffers.thought.trim()) lines.push(`[Thought] ${buffers.thought.trim()}`);
  buffers.message = "";
  buffers.thought = "";
}

function formatToolInputJson(input: unknown): string | null {
  if (input === undefined) return null;
  try {
    const encoded = JSON.stringify(input);
    if (!encoded) return null;
    return encoded.length <= MAX_TOOL_INPUT_CHARS
      ? encoded
      : `${encoded.slice(0, MAX_TOOL_INPUT_CHARS)}...`;
  } catch {
    return null;
  }
}

function formatToolSummary(summary: string | undefined): string | null {
  if (typeof summary !== "string") return null;
  const normalized = summary.replace(/\s+/g, " ").trim();
  if (!normalized) return null;
  return normalized.length <= MAX_TOOL_SUMMARY_CHARS
    ? normalized
    : `${normalized.slice(0, MAX_TOOL_SUMMARY_CHARS - 3)}...`;
}

function hasNonEmptyObject(value: unknown): boolean {
  return typeof value === "object" && value !== null && !Array.isArray(value) && Object.keys(value).length > 0;
}

function mergeUnknownValue(existing: unknown | null, incoming: unknown | null): unknown | null {
  if (incoming === null) return existing;
  if (!hasNonEmptyObject(incoming) && hasNonEmptyObject(existing)) return existing;
  return incoming;
}

function mergeToolDetail(existing: ToolCallDetail, incoming: ToolCallDetail): ToolCallDetail {
  if (existing.type === "unknown" && incoming.type !== "unknown") return incoming;
  if (incoming.type === "unknown" && existing.type !== "unknown") return existing;
  if (existing.type === "unknown" && incoming.type === "unknown") {
    return {
      type: "unknown",
      input: mergeUnknownValue(existing.input, incoming.input) ?? null,
      output: mergeUnknownValue(existing.output, incoming.output) ?? null,
    };
  }
  if (existing.type === incoming.type) return { ...existing, ...incoming } as ToolCallDetail;
  return incoming;
}

function collapseTimeline(items: AgentTimelineItem[]): AgentTimelineItem[] {
  const result: AgentTimelineItem[] = [];
  const toolCallMap = new Map<string, AgentTimelineItem>();
  let assistantBuffer = "";
  let reasoningBuffer = "";

  function flushAssistant() {
    if (assistantBuffer) {
      result.push({ type: "assistant_message", text: assistantBuffer });
      assistantBuffer = "";
    }
  }

  function flushReasoning() {
    if (reasoningBuffer) {
      result.push({ type: "reasoning", text: reasoningBuffer });
      reasoningBuffer = "";
    }
  }

  function flushToolCalls() {
    for (const toolItem of toolCallMap.values()) result.push(toolItem);
    toolCallMap.clear();
  }

  for (const item of items) {
    if (item.type === "assistant_message") {
      flushReasoning();
      flushToolCalls();
      assistantBuffer += item.text;
    } else if (item.type === "reasoning") {
      flushAssistant();
      flushToolCalls();
      reasoningBuffer += item.text;
    } else if (item.type === "tool_call") {
      flushAssistant();
      flushReasoning();
      const existing = toolCallMap.get(item.callId);
      if (existing?.type === "tool_call") {
        if (item.status === "failed") {
          toolCallMap.set(item.callId, {
            ...existing,
            ...item,
            detail: mergeToolDetail(existing.detail, item.detail),
            error: item.error,
            metadata: item.metadata,
          });
        } else {
          toolCallMap.set(item.callId, {
            ...existing,
            ...item,
            detail: mergeToolDetail(existing.detail, item.detail),
            error: null,
            metadata: item.metadata,
          });
        }
      } else {
        toolCallMap.set(item.callId, item);
      }
    } else {
      flushAssistant();
      flushReasoning();
      flushToolCalls();
      result.push(item);
    }
  }

  flushAssistant();
  flushReasoning();
  flushToolCalls();
  return result;
}

export function curateAgentActivity(
  timeline: AgentTimelineItem[],
  options?: { maxItems?: number },
): string {
  if (timeline.length === 0) return "No activity to display.";

  const collapsed = collapseTimeline(timeline);
  const maxItems = options?.maxItems ?? DEFAULT_MAX_ITEMS;
  const recentItems = maxItems > 0 && collapsed.length > maxItems ? collapsed.slice(-maxItems) : collapsed;

  const lines: string[] = [];
  const buffers = { message: "", thought: "" };

  for (const item of recentItems) {
    switch (item.type) {
      case "user_message":
        flushBuffers(lines, buffers);
        lines.push(`[User] ${item.text.trim()}`);
        break;
      case "assistant_message":
        buffers.message = appendText(buffers.message, item.text);
        break;
      case "reasoning":
        buffers.thought = appendText(buffers.thought, item.text);
        break;
      case "tool_call": {
        flushBuffers(lines, buffers);
        const display = buildToolCallDisplayModel(item);
        const details: string[] = [];
        if (display.summary) details.push(display.summary);
        const toolSummary = formatToolSummary(display.summary);
        if (toolSummary) details.push(toolSummary);
        if (item.detail.type === "unknown") {
          const input = formatToolInputJson(item.detail.input);
          if (input) details.push(input);
        }
        const prefix = item.name.includes("__") || item.name.includes(":") ? "[MCP Tool]" : "[Tool]";
        lines.push(`${prefix} ${item.name}${details.length > 0 ? ` — ${details.join(" | ")}` : ""}`);
        break;
      }
      default:
        break;
    }
  }

  flushBuffers(lines, buffers);
  return lines.join("\n");
}
