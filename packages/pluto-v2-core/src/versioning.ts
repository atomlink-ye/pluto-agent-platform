import { z } from 'zod';

export const SCHEMA_VERSION = '1.0' as const;
export const SCHEMA_VERSION_MAJOR = '1' as const;
export const SCHEMA_VERSION_MINOR = '0' as const;

export const SCHEMA_VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
export const SAME_MAJOR_SCHEMA_VERSION_PATTERN = /^1\.(0|[1-9]\d*)$/;

export type SchemaVersion = `${number}.${number}`;
export type SupportedSchemaVersion = `${typeof SCHEMA_VERSION_MAJOR}.${number}`;

export const SchemaVersionSchema = z.string().regex(SCHEMA_VERSION_PATTERN);
export const SupportedSchemaVersionSchema = z.string().regex(SAME_MAJOR_SCHEMA_VERSION_PATTERN);

export const VERSIONING_POLICY = {
  initialSchemaVersion: SCHEMA_VERSION,
  acceptedMajor: SCHEMA_VERSION_MAJOR,
  sameMajorForwardCompatibility: 'additive_optional_fields_only',
  enumAdditionsRequireMajorBump: true,
  differentMajorRequiresMigrator: true,
} as const;

export type VersioningPolicy = typeof VERSIONING_POLICY;
