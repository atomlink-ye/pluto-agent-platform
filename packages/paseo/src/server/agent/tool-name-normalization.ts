const TOOL_NAME_SEPARATOR_RE = /[:./]|__/;

export function isPaseoToolName(name: string): boolean {
  return TOOL_NAME_SEPARATOR_RE.test(name);
}

export function getPaseoToolLeafName(name: string): string {
  return name.split(/[:./]|__/).filter(Boolean).at(-1) ?? name;
}
