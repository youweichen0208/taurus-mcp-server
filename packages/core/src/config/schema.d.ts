import { z } from "zod";
export declare const ConfigSchema: z.ZodObject<{
    defaultDatasource: z.ZodOptional<z.ZodString>;
    profilesPath: z.ZodOptional<z.ZodString>;
    enableMutations: z.ZodDefault<z.ZodBoolean>;
    limits: z.ZodDefault<z.ZodObject<{
        maxRows: z.ZodDefault<z.ZodNumber>;
        maxColumns: z.ZodDefault<z.ZodNumber>;
        maxStatementMs: z.ZodDefault<z.ZodNumber>;
        maxFieldChars: z.ZodDefault<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        maxRows: number;
        maxColumns: number;
        maxStatementMs: number;
        maxFieldChars: number;
    }, {
        maxRows?: number | undefined;
        maxColumns?: number | undefined;
        maxStatementMs?: number | undefined;
        maxFieldChars?: number | undefined;
    }>>;
    audit: z.ZodDefault<z.ZodObject<{
        logPath: z.ZodDefault<z.ZodString>;
        includeRawSql: z.ZodDefault<z.ZodBoolean>;
    }, "strip", z.ZodTypeAny, {
        logPath: string;
        includeRawSql: boolean;
    }, {
        logPath?: string | undefined;
        includeRawSql?: boolean | undefined;
    }>>;
}, "strip", z.ZodTypeAny, {
    enableMutations: boolean;
    limits: {
        maxRows: number;
        maxColumns: number;
        maxStatementMs: number;
        maxFieldChars: number;
    };
    audit: {
        logPath: string;
        includeRawSql: boolean;
    };
    defaultDatasource?: string | undefined;
    profilesPath?: string | undefined;
}, {
    defaultDatasource?: string | undefined;
    profilesPath?: string | undefined;
    enableMutations?: boolean | undefined;
    limits?: {
        maxRows?: number | undefined;
        maxColumns?: number | undefined;
        maxStatementMs?: number | undefined;
        maxFieldChars?: number | undefined;
    } | undefined;
    audit?: {
        logPath?: string | undefined;
        includeRawSql?: boolean | undefined;
    } | undefined;
}>;
export type Config = z.infer<typeof ConfigSchema>;
