import { z } from "zod";

import type { ToolCallDetail } from "../agent-sdk-types.js";
import {
  extractCodexShellOutput,
  flattenReadContent as flattenToolReadContent,
  nonEmptyString,
  truncateDiffText,
} from "./tool-call-mapper-utils.js";

export const CommandValueSchema = z.union([z.string(), z.array(z.string())]);
export const ToolShellInputSchema = z
  .union([
    z.object({ command: CommandValueSchema, cwd: z.string().optional(), directory: z.string().optional() }).passthrough(),
    z.object({ cmd: CommandValueSchema, cwd: z.string().optional(), directory: z.string().optional() }).passthrough(),
  ])
  .transform((value) => {
    const parsedCommand = CommandValueSchema.safeParse("command" in value ? value.command : value.cmd);
    const command = parsedCommand.success
      ? typeof parsedCommand.data === "string"
        ? nonEmptyString(parsedCommand.data)
        : parsedCommand.data.map((token) => token.trim()).filter((token) => token.length > 0).join(" ") || undefined
      : undefined;
    return { command, cwd: nonEmptyString(value.cwd) ?? nonEmptyString(value.directory) };
  });

const ToolShellOutputObjectSchema = z.object({
  command: z.string().optional(),
  output: z.string().optional(),
  text: z.string().optional(),
  content: z.string().optional(),
  aggregated_output: z.string().optional(),
  aggregatedOutput: z.string().optional(),
  exitCode: z.number().finite().nullable().optional(),
  exit_code: z.number().finite().nullable().optional(),
}).passthrough();

export const ToolShellOutputSchema = z.union([
  z.string().transform((value) => ({ command: undefined, output: extractCodexShellOutput(value), exitCode: undefined })),
  ToolShellOutputObjectSchema.transform((value) => ({
    command: nonEmptyString(value.command),
    output: extractCodexShellOutput(
      nonEmptyString(value.output) ??
        nonEmptyString(value.text) ??
        nonEmptyString(value.content) ??
        nonEmptyString(value.aggregated_output) ??
        nonEmptyString(value.aggregatedOutput),
    ),
    exitCode: value.exitCode ?? value.exit_code ?? undefined,
  })),
]);

export const ToolReadInputSchema = z.union([
  z.object({ path: z.string(), offset: z.number().finite().optional(), limit: z.number().finite().optional() }).passthrough().transform((value) => ({ filePath: value.path, offset: value.offset, limit: value.limit })),
  z.object({ file_path: z.string(), offset: z.number().finite().optional(), limit: z.number().finite().optional() }).passthrough().transform((value) => ({ filePath: value.file_path, offset: value.offset, limit: value.limit })),
  z.object({ filePath: z.string(), offset: z.number().finite().optional(), limit: z.number().finite().optional() }).passthrough().transform((value) => ({ filePath: value.filePath, offset: value.offset, limit: value.limit })),
]);

const ToolReadChunkSchema = z.union([
  z.object({ text: z.string(), content: z.string().optional(), output: z.string().optional() }).passthrough(),
  z.object({ text: z.string().optional(), content: z.string(), output: z.string().optional() }).passthrough(),
  z.object({ text: z.string().optional(), content: z.string().optional(), output: z.string() }).passthrough(),
]);

const ToolReadContentSchema = z.union([z.string(), ToolReadChunkSchema, z.array(ToolReadChunkSchema)]);
export const ToolReadOutputSchema = z.union([
  z.string().transform((value) => ({ content: value })),
  z.object({ content: ToolReadContentSchema.optional(), text: ToolReadContentSchema.optional(), output: ToolReadContentSchema.optional() }).passthrough(),
]);

export const ToolWriteInputSchema = z.union([
  z.object({ path: z.string(), content: z.string().optional() }).passthrough().transform((value) => ({ filePath: value.path, content: value.content })),
  z.object({ file_path: z.string(), content: z.string().optional() }).passthrough().transform((value) => ({ filePath: value.file_path, content: value.content })),
  z.object({ filePath: z.string(), content: z.string().optional() }).passthrough().transform((value) => ({ filePath: value.filePath, content: value.content })),
]);

export const ToolWriteOutputSchema = z.unknown();
export const ToolEditInputSchema = z.object({ file_path: z.string().optional(), filePath: z.string().optional(), old_string: z.string().optional(), old_str: z.string().optional(), new_string: z.string().optional(), new_str: z.string().optional(), patch: z.string().optional() }).passthrough().transform((value) => ({ filePath: value.filePath ?? value.file_path, oldString: value.old_string ?? value.old_str, newString: value.new_string ?? value.new_str, unifiedDiff: value.patch }));
export const ToolEditOutputSchema = z.unknown();
export const ToolSearchInputSchema = z.object({ pattern: z.string().optional(), query: z.string().optional(), path: z.string().optional() }).passthrough().transform((value) => ({ query: value.query ?? value.pattern ?? "", path: value.path }));
export const ToolGrepOutputSchema = z.unknown();
export const ToolGlobOutputSchema = z.unknown();
export const ToolWebSearchOutputSchema = z.unknown();
export const ToolWebFetchInputSchema = z.object({ url: z.string(), prompt: z.string().optional() }).passthrough();
export const ToolWebFetchOutputSchema = z.unknown();

export function toShellToolDetail(input: z.infer<typeof ToolShellInputSchema>, output: z.infer<typeof ToolShellOutputSchema> | null): ToolCallDetail | undefined {
  if (!input.command) return undefined;
  return { type: "shell", command: input.command, cwd: input.cwd, output: output?.output, exitCode: output?.exitCode };
}

export function toReadToolDetail(input: z.infer<typeof ToolReadInputSchema>, output: z.infer<typeof ToolReadOutputSchema> | null): ToolCallDetail | undefined {
  if (!input.filePath) return undefined;
  return { type: "read", filePath: input.filePath, content: flattenToolReadContent(output?.content ?? output?.text ?? output?.output), offset: input.offset, limit: input.limit };
}

export function toWriteToolDetail(input: z.infer<typeof ToolWriteInputSchema>, _output?: unknown): ToolCallDetail | undefined {
  if (!input.filePath) return undefined;
  return { type: "write", filePath: input.filePath, content: input.content };
}

export function toEditToolDetail(input: z.infer<typeof ToolEditInputSchema>, _output?: unknown): ToolCallDetail | undefined {
  if (!input.filePath) return undefined;
  return { type: "edit", filePath: input.filePath, oldString: input.oldString, newString: input.newString, unifiedDiff: truncateDiffText(input.unifiedDiff) };
}

export function toSearchToolDetail(params: { input: z.infer<typeof ToolSearchInputSchema>; output?: unknown; toolName: "search" | "grep" | "glob" | "web_search"; }): ToolCallDetail | undefined {
  if (!params.input.query) return undefined;
  return { type: "search", query: params.input.query, toolName: params.toolName };
}

export function toFetchToolDetail(input: z.infer<typeof ToolWebFetchInputSchema>, output: unknown): ToolCallDetail | undefined {
  if (!input.url) return undefined;
  return { type: "fetch", url: input.url, prompt: input.prompt, result: typeof output === "string" ? output : undefined };
}

export function toolDetailBranchByName<TInput, TOutput>(
  name: string,
  inputSchema: z.ZodType<TInput>,
  outputSchema: z.ZodType<TOutput>,
  mapper: (input: TInput, output: TOutput | null) => ToolCallDetail | undefined,
) {
  return z.object({ name: z.literal(name), input: z.unknown().nullable(), output: z.unknown().nullable() }).transform(({ input, output }) => {
    const parsedInput = inputSchema.safeParse(input);
    if (!parsedInput.success) return undefined;
    const parsedOutput = outputSchema.safeParse(output);
    return mapper(parsedInput.data, parsedOutput.success ? parsedOutput.data : null);
  });
}
