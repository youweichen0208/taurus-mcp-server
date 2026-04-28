import { z } from "zod";

const LimitsSchema = z
  .object({
    maxRows: z.number().int().positive().default(200),
    maxColumns: z.number().int().positive().default(50),
    maxStatementMs: z.number().int().positive().default(15000),
    maxFieldChars: z.number().int().positive().default(2048),
  })
  .default({});

const AuditSchema = z
  .object({
    logPath: z.string().min(1).default("~/.taurusdb-mcp/audit.jsonl"),
    includeRawSql: z.boolean().default(false),
  })
  .default({});

const TaurusApiSlowSqlSourceSchema = z
  .object({
    enabled: z.boolean().default(false),
    endpoint: z.string().min(1).optional(),
    projectId: z.string().min(1).optional(),
    instanceId: z.string().min(1).optional(),
    nodeId: z.string().min(1).optional(),
    authToken: z.string().min(1).optional(),
    language: z.enum(["en-us", "zh-cn"]).default("zh-cn"),
    requestTimeoutMs: z.number().int().positive().default(5000),
    defaultLookbackMinutes: z.number().int().positive().max(43_200).default(60),
    maxRecords: z.number().int().positive().max(100).default(20),
  })
  .default({});

const DasSlowSqlSourceSchema = z
  .object({
    enabled: z.boolean().default(false),
    endpoint: z.string().min(1).optional(),
    projectId: z.string().min(1).optional(),
    instanceId: z.string().min(1).optional(),
    authToken: z.string().min(1).optional(),
    datastoreType: z.enum(["MySQL", "TaurusDB"]).default("TaurusDB"),
    requestTimeoutMs: z.number().int().positive().default(5000),
    defaultLookbackMinutes: z.number().int().positive().max(43_200).default(60),
    maxRecords: z.number().int().positive().max(200).default(50),
    maxPages: z.number().int().positive().max(10).default(2),
  })
  .default({});

const CesMetricsSourceSchema = z
  .object({
    enabled: z.boolean().default(false),
    endpoint: z.string().min(1).optional(),
    projectId: z.string().min(1).optional(),
    instanceId: z.string().min(1).optional(),
    nodeId: z.string().min(1).optional(),
    authToken: z.string().min(1).optional(),
    namespace: z.string().min(1).default("SYS.GAUSSDB"),
    instanceDimension: z.string().min(1).default("gaussdb_mysql_instance_id"),
    nodeDimension: z.string().min(1).default("gaussdb_mysql_node_id"),
    period: z
      .enum(["1", "60", "300", "1200", "3600", "14400", "86400"])
      .default("60"),
    filter: z
      .enum(["average", "max", "min", "sum", "variance"])
      .default("average"),
    requestTimeoutMs: z.number().int().positive().default(5000),
    defaultLookbackMinutes: z.number().int().positive().max(43_200).default(60),
  })
  .default({});

export const ConfigSchema = z.object({
  defaultDatasource: z.string().min(1).optional(),
  profilesPath: z.string().min(1).optional(),
  enableMutations: z.boolean().default(false),
  limits: LimitsSchema,
  audit: AuditSchema,
  slowSqlSource: z
    .object({
      taurusApi: TaurusApiSlowSqlSourceSchema,
      das: DasSlowSqlSourceSchema,
    })
    .default({}),
  metricsSource: z
    .object({
      ces: CesMetricsSourceSchema,
    })
    .default({}),
});

export type Config = z.infer<typeof ConfigSchema>;
