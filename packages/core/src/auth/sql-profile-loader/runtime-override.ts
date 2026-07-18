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
    instanceId: target.instanceId ?? profile.instanceId,
    nodeId: target.nodeId ?? profile.nodeId,
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
    const targetChanged =
      (target.host !== undefined && target.host !== current?.host) ||
      (target.instanceId !== undefined && target.instanceId !== current?.instanceId);
    const user = target.user ?? (targetChanged ? undefined : current?.user);
    const next: RuntimeDataSourceTarget = {
      host: target.host ?? current?.host,
      port: target.port ?? current?.port,
      database: target.database ?? current?.database,
      instanceId: target.instanceId ?? current?.instanceId,
      nodeId: target.nodeId ?? current?.nodeId,
    };
    if (user) {
      next.user = user;
    }
    this.runtimeTargets.set(name, next);
  }

  clearRuntimeUser(name: string): void {
    const current = this.runtimeTargets.get(name);
    if (!current) {
      return;
    }
    const { user: _user, ...next } = current;
    this.runtimeTargets.set(name, next);
  }

  clearRuntimeTarget(name: string): void {
    this.runtimeTargets.delete(name);
  }

  clearAllRuntimeTargets(): void {
    this.runtimeTargets.clear();
  }

  getRuntimeTarget(name: string): RuntimeDataSourceTarget | undefined {
    const target = this.runtimeTargets.get(name);
    return target ? { ...target } : undefined;
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
