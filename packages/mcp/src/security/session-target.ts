import type { ToolDeps } from "../tools/registry.js";

/**
 * Identity of the database endpoint a credential session is allowed to reach.
 * The default database is intentionally excluded: switching it does not change
 * which server receives the credential.
 */
export type SessionTarget = {
  datasource: string;
  host?: string;
  port?: number;
  instanceId?: string;
  region?: string;
};

export async function resolveSessionTarget(
  deps: Pick<ToolDeps, "config" | "profileLoader">,
  datasource: string,
): Promise<SessionTarget | undefined> {
  const profile = await deps.profileLoader.get(datasource);
  if (!profile) {
    return undefined;
  }
  const runtimeTarget = deps.profileLoader.getRuntimeTarget(datasource);
  return {
    datasource,
    host: runtimeTarget?.host ?? profile.host,
    port: runtimeTarget?.port ?? profile.port,
    instanceId:
      runtimeTarget?.instanceId ?? profile.instanceId ?? deps.config.cloud.instanceId,
    region: deps.config.cloud.region,
  };
}

export function sameSessionTarget(a: SessionTarget, b: SessionTarget): boolean {
  return (
    a.datasource === b.datasource &&
    a.host === b.host &&
    a.port === b.port &&
    a.instanceId === b.instanceId &&
    a.region === b.region
  );
}
