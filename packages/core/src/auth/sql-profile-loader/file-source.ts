import type { DataSourceProfile } from "./types.js";
import { asString, isObject, parseProfileRecord } from "./parsing.js";

export type FileProfilesPayload = {
  profiles: Map<string, DataSourceProfile>;
  defaultDatasource?: string;
};

export function parseProfilesFile(raw: string, filePath: string): FileProfilesPayload {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Invalid JSON in profiles file: ${filePath}`, { cause: error });
  }

  if (!isObject(parsed)) {
    throw new Error(`Invalid profiles file root in ${filePath}: expected object.`);
  }

  const root = parsed as Record<string, unknown>;
  const defaultDatasource = asString(root.defaultDatasource ?? root.default);
  const profileNode = root.dataSources ?? root.datasources ?? root.profiles;
  const profiles = new Map<string, DataSourceProfile>();

  if (profileNode === undefined) {
    return { profiles, defaultDatasource };
  }

  if (Array.isArray(profileNode)) {
    for (const item of profileNode) {
      if (!isObject(item)) {
        throw new Error(`Invalid profile item in ${filePath}: expected object.`);
      }
      const name = asString(item.name);
      if (!name) {
        throw new Error(`Invalid profile item in ${filePath}: missing name.`);
      }
      profiles.set(name, parseProfileRecord(name, item, filePath));
    }
    return { profiles, defaultDatasource };
  }

  if (!isObject(profileNode)) {
    throw new Error(`Invalid profiles node in ${filePath}: expected object or array.`);
  }

  for (const [name, profileValue] of Object.entries(profileNode)) {
    profiles.set(name, parseProfileRecord(name, profileValue, filePath));
  }
  return { profiles, defaultDatasource };
}
