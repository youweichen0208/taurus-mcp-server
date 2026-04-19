import type { Config } from "../config/index.js";
import type { ProfileLoader } from "../auth/sql-profile-loader.js";
import type {
  DatasourceResolveInput,
  DatasourceResolver,
  SessionContext,
} from "./session-context.js";

export class DatasourceResolutionError extends Error {
  readonly code: "DATASOURCE_NOT_FOUND" | "INVALID_CONTEXT_INPUT";

  constructor(code: "DATASOURCE_NOT_FOUND" | "INVALID_CONTEXT_INPUT", message: string) {
    super(message);
    this.name = "DatasourceResolutionError";
    this.code = code;
  }
}

export type DatasourceResolverOptions = {
  config: Config;
  profileLoader: ProfileLoader;
};

function normalizeString(value: string | undefined): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function resolveTimeoutMs(requested: number | undefined, fallbackMax: number): number {
  if (requested === undefined) {
    return fallbackMax;
  }
  if (!Number.isInteger(requested) || requested <= 0) {
    throw new DatasourceResolutionError(
      "INVALID_CONTEXT_INPUT",
      `Invalid timeout_ms: ${requested}. It must be a positive integer.`,
    );
  }
  return Math.min(requested, fallbackMax);
}

export class DefaultDatasourceResolver implements DatasourceResolver {
  private readonly config: Config;
  private readonly profileLoader: ProfileLoader;

  constructor(options: DatasourceResolverOptions) {
    this.config = options.config;
    this.profileLoader = options.profileLoader;
  }

  async resolve(input: DatasourceResolveInput, task_id: string): Promise<SessionContext> {
    const datasourceName = await this.resolveDatasourceName(input.datasource);
    const profile = await this.profileLoader.get(datasourceName);

    if (!profile) {
      throw new DatasourceResolutionError(
        "DATASOURCE_NOT_FOUND",
        `Datasource profile "${datasourceName}" was not found.`,
      );
    }

    return {
      task_id,
      datasource: datasourceName,
      engine: profile.engine,
      database: normalizeString(input.database) ?? profile.database,
      schema: normalizeString(input.schema),
      limits: {
        readonly: input.readonly ?? true,
        timeoutMs: resolveTimeoutMs(input.timeout_ms, this.config.limits.maxStatementMs),
        maxRows: this.config.limits.maxRows,
        maxColumns: this.config.limits.maxColumns,
        maxFieldChars: this.config.limits.maxFieldChars,
      },
    };
  }

  private async resolveDatasourceName(explicitDatasource: string | undefined): Promise<string> {
    const inputDatasource = normalizeString(explicitDatasource);
    if (inputDatasource) {
      return inputDatasource;
    }

    if (this.config.defaultDatasource) {
      return this.config.defaultDatasource;
    }

    const loadedDefault = await this.profileLoader.getDefault();
    const profileDefault = normalizeString(loadedDefault);
    if (profileDefault) {
      return profileDefault;
    }

    throw new DatasourceResolutionError(
      "DATASOURCE_NOT_FOUND",
      "No datasource selected. Provide input.datasource or configure a default datasource.",
    );
  }
}

export function createDatasourceResolver(options: DatasourceResolverOptions): DatasourceResolver {
  return new DefaultDatasourceResolver(options);
}
