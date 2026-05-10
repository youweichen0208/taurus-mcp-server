import type { DataSourceProfile, ProfileLoader, RuntimeDataSourceTarget, RuntimeTargetProfileLoader } from "./types.js";
import { withRedactedToString } from "./parsing.js";

export function applyRuntimeTarget(
  profile: DataSourceProfile,
  target: RuntimeDataSourceTarget | undefined,
): DataSourceProfile {
  if (!target) {
    return profile;
  }
  return withRedactedToString({
    ...profile,
    host: target.host,
    port: target.port ?? profile.port,
  });
}

export class RuntimeOverrideProfileLoader implements RuntimeTargetProfileLoader {
  private readonly base: ProfileLoader;
  private readonly runtimeTargets = new Map<string, RuntimeDataSourceTarget>();

  constructor(base: ProfileLoader) {
    this.base = base;
  }

  setRuntimeTarget(name: string, target: RuntimeDataSourceTarget): void {
    this.runtimeTargets.set(name, {
      host: target.host,
      port: target.port,
      instanceId: target.instanceId,
      nodeId: target.nodeId,
    });
  }

  clearRuntimeTarget(name: string): void {
    this.runtimeTargets.delete(name);
  }

  clearAllRuntimeTargets(): void {
    this.runtimeTargets.clear();
  }

  getRuntimeTarget(name: string): RuntimeDataSourceTarget | undefined {
    return this.runtimeTargets.get(name);
  }

  async load(): Promise<Map<string, DataSourceProfile>> {
    const loaded = await this.base.load();
    return new Map(
      [...loaded.entries()].map(([name, profile]) => [
        name,
        applyRuntimeTarget(profile, this.runtimeTargets.get(name)),
      ]),
    );
  }

  async getDefault(): Promise<string | undefined> {
    return this.base.getDefault();
  }

  async get(name: string): Promise<DataSourceProfile | undefined> {
    const profile = await this.base.get(name);
    if (!profile) {
      return undefined;
    }
    return applyRuntimeTarget(profile, this.runtimeTargets.get(name));
  }
}
