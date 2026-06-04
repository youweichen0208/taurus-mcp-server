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
    host: target.host ?? profile.host,
    port: target.port ?? profile.port,
    database: target.database ?? profile.database,
    user: target.user ?? profile.user,
  });
}

export class RuntimeOverrideProfileLoader implements RuntimeTargetProfileLoader {
  private readonly base: ProfileLoader;
  private readonly runtimeTargets = new Map<string, RuntimeDataSourceTarget>();

  constructor(base: ProfileLoader) {
    this.base = base;
  }

  setRuntimeTarget(name: string, target: RuntimeDataSourceTarget): void {
    const current = this.runtimeTargets.get(name);
    const next: RuntimeDataSourceTarget = {
      host: target.host ?? current?.host,
      port: target.port ?? current?.port,
      database: target.database ?? current?.database,
      user: target.user ?? current?.user,
      instanceId: target.instanceId ?? current?.instanceId,
      nodeId: target.nodeId ?? current?.nodeId,
    };
    this.runtimeTargets.set(name, next);
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
