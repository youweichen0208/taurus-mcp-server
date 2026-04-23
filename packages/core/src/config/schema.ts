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

export const ConfigSchema = z.object({
  defaultDatasource: z.string().min(1).optional(),
  profilesPath: z.string().min(1).optional(),
  enableMutations: z.boolean().default(false),
  limits: LimitsSchema,
  audit: AuditSchema,
  slowSqlSource: z
    .object({
      taurusApi: TaurusApiSlowSqlSourceSchema,
    })
    .default({}),
});

export type Config = z.infer<typeof ConfigSchema>;
