export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export function ensureValidJson<T>(value: T): T {
  const seen = new WeakSet<object>();

  const sanitize = (current: unknown): JsonValue => {
    if (current === null || current === undefined) return null;
    if (typeof current === "string" || typeof current === "number" || typeof current === "boolean") {
      return current;
    }
    if (typeof current === "bigint") return current.toString();
    if (current instanceof Date) return current.toISOString();
    if (Array.isArray(current)) return current.map((item) => sanitize(item));
    if (typeof current === "object") {
      if (seen.has(current as object)) {
        throw new Error("Cannot serialize circular structure to JSON");
      }
      seen.add(current as object);
      const obj: Record<string, JsonValue> = {};
      for (const [key, val] of Object.entries(current as Record<string, unknown>)) {
        obj[key] = sanitize(val);
      }
      seen.delete(current as object);
      return obj;
    }
    return null;
  };

  return sanitize(value) as T;
}
