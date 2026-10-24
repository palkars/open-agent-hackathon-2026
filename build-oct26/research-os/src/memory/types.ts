export const RESEARCH_MEMORY_TYPES = [
  "CLAIM",
  "EVIDENCE",
  "LIMITATION",
  "CONTRADICTION",
  "OPEN_QUESTION",
  "RESEARCH_DIRECTION",
] as const;

export type ResearchMemoryType = (typeof RESEARCH_MEMORY_TYPES)[number];

export interface ResearchMemoryInput {
  type: ResearchMemoryType;
  content: string;
  sourceIds: string[];
  confidence: number;
  tags: string[];
}

// Tags under this prefix are written by the wrapper itself (finding marker
// and type), so user tags may not use it.
export const RESERVED_TAG_PREFIX = "research:";

export function isResearchMemoryType(value: unknown): value is ResearchMemoryType {
  return typeof value === "string" && (RESEARCH_MEMORY_TYPES as readonly string[]).includes(value);
}

function isNonBlankStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string" && item.trim() !== "");
}

// Application-boundary check: input may come from JSON files or the CLI, so
// the static type alone is not trusted.
export function validateResearchMemoryInput(input: unknown): ResearchMemoryInput {
  if (typeof input !== "object" || input === null) {
    throw new Error("research memory input must be an object");
  }
  const { type, content, sourceIds, confidence, tags } = input as Record<string, unknown>;

  if (!isResearchMemoryType(type)) {
    throw new Error(`research memory type must be one of ${RESEARCH_MEMORY_TYPES.join(", ")} (got ${JSON.stringify(type)})`);
  }
  if (typeof content !== "string" || content.trim() === "") {
    throw new Error("research memory content must be a non-empty string");
  }
  // An empty list is allowed: a genuine open question may have no sources yet.
  if (!isNonBlankStringArray(sourceIds)) {
    throw new Error("research memory sourceIds must be an array of non-empty strings");
  }
  if (typeof confidence !== "number" || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    const got = typeof confidence === "number" ? String(confidence) : JSON.stringify(confidence);
    throw new Error(`research memory confidence must be a finite number between 0 and 1 (got ${got})`);
  }
  if (!isNonBlankStringArray(tags)) {
    throw new Error("research memory tags must be an array of non-empty strings");
  }
  const reserved = tags.find((tag) => tag.startsWith(RESERVED_TAG_PREFIX));
  if (reserved) {
    throw new Error(`research memory tag "${reserved}" uses the reserved "${RESERVED_TAG_PREFIX}" prefix`);
  }

  return { type, content, sourceIds: [...sourceIds], confidence, tags: [...tags] };
}
