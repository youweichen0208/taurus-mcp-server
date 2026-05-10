import { access, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Config } from "../../config/index.js";
import { parseEnvProfile } from "./env-source.js";
import { parseProfilesFile } from "./file-source.js";
import type { DataSourceProfile, LoadedProfiles, ProfileLoader, SqlProfileLoaderOptions } from "./types.js";

export function resolveDefaultProfilePath(config: Config): string {
  if (config.profilesPath) {
    return config.profilesPath;
  }
  return path.join(os.homedir(), ".config", "taurusdb-mcp", "profiles.json");
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

export class SqlProfileLoader implements ProfileLoader {
  private readonly config: Config;
  private readonly env: NodeJS.ProcessEnv;
  private cache: LoadedProfiles | undefined;
  private pending: Promise<LoadedProfiles> | undefined;

  constructor(options: SqlProfileLoaderOptions) {
    this.config = options.config;
    this.env = options.env ?? process.env;
  }

  async load(): Promise<Map<string, DataSourceProfile>> {
    const loaded = await this.ensureLoaded();
    return new Map(loaded.profiles);
  }

  async getDefault(): Promise<string | undefined> {
    const loaded = await this.ensureLoaded();
    return loaded.defaultDatasource;
  }

  async get(name: string): Promise<DataSourceProfile | undefined> {
    const loaded = await this.ensureLoaded();
    return loaded.profiles.get(name);
  }

  private async ensureLoaded(): Promise<LoadedProfiles> {
    if (this.cache) {
      return this.cache;
    }
    if (!this.pending) {
      this.pending = this.loadInternal();
    }
    const loaded = await this.pending;
    this.cache = loaded;
    this.pending = undefined;
    return loaded;
  }

  private async loadInternal(): Promise<LoadedProfiles> {
    const mergedProfiles = new Map<string, DataSourceProfile>();

    const envProfile = parseEnvProfile(this.env);
    if (envProfile) {
      mergedProfiles.set(envProfile.name, envProfile);
    }

    const profilePath = resolveDefaultProfilePath(this.config);
    let fileDefaultDatasource: string | undefined;
    if (await exists(profilePath)) {
      const content = await readFile(profilePath, "utf-8");
      const parsed = parseProfilesFile(content, profilePath);
      fileDefaultDatasource = parsed.defaultDatasource;
      for (const [name, profile] of parsed.profiles.entries()) {
        mergedProfiles.set(name, profile);
      }
    }

    const defaultDatasource =
      this.config.defaultDatasource ??
      fileDefaultDatasource ??
      (mergedProfiles.size === 1 ? mergedProfiles.keys().next().value : undefined);

    return {
      profiles: mergedProfiles,
      defaultDatasource,
    };
  }
}

export function createSqlProfileLoader(options: SqlProfileLoaderOptions): ProfileLoader {
  return new SqlProfileLoader(options);
}
