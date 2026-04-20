import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
function resolveFilePath(rawPath) {
    if (rawPath === "~") {
        return os.homedir();
    }
    if (rawPath.startsWith("~/")) {
        return path.join(os.homedir(), rawPath.slice(2));
    }
    if (path.isAbsolute(rawPath)) {
        return rawPath;
    }
    return path.resolve(process.cwd(), rawPath);
}
function sanitizeFileSecret(raw) {
    return raw.replace(/\uFEFF/g, "").replace(/\r?\n$/, "");
}
function parseUri(input) {
    const trimmed = input.trim();
    const normalizedUri = trimmed.startsWith("uri:") ? trimmed.slice("uri:".length) : trimmed;
    const match = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(normalizedUri);
    if (!match) {
        throw new Error(`Invalid URI credential ref: "${input}".`);
    }
    return {
        scheme: match[1].toLowerCase(),
        normalizedUri,
    };
}
export class DefaultSecretResolver {
    env;
    uriResolvers;
    constructor(options = {}) {
        this.env = options.env ?? process.env;
        this.uriResolvers = options.uriResolvers ?? {};
    }
    async resolve(ref) {
        if (ref.type === "plain") {
            return ref.value;
        }
        if (ref.type === "env") {
            const value = this.env[ref.key];
            if (value === undefined) {
                throw new Error(`Environment variable not found for credential ref: ${ref.key}`);
            }
            return value;
        }
        if (ref.type === "file") {
            const targetPath = resolveFilePath(ref.path);
            const raw = await readFile(targetPath, "utf-8");
            return sanitizeFileSecret(raw);
        }
        const { scheme, normalizedUri } = parseUri(ref.uri);
        const resolver = this.uriResolvers[scheme];
        if (!resolver) {
            throw new Error(`Unsupported credential URI scheme: ${scheme}. Add a uri resolver for "${scheme}" in SecretResolver.`);
        }
        return resolver(normalizedUri);
    }
}
export function createSecretResolver(options) {
    return new DefaultSecretResolver(options);
}
