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
export const ConfigSchema = z.object({
    defaultDatasource: z.string().min(1).optional(),
    profilesPath: z.string().min(1).optional(),
    enableMutations: z.boolean().default(false),
    limits: LimitsSchema,
    audit: AuditSchema,
});
