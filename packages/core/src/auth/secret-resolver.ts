import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { CredentialRef } from "./sql-profile-loader.js";

export interface SecretResolver {
  resolve(ref: CredentialRef): Promise<string>;
}

export type UriSecretResolver = (uri: string) => Promise<string>;

export type SecretResolverOptions = {
  env?: NodeJS.ProcessEnv;
  uriResolvers?: Record<string, UriSecretResolver>;
};

function resolveFilePath(rawPath: string): string {
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

function sanitizeFileSecret(raw: string): string {
  return raw.replace(/\uFEFF/g, "").replace(/\r?\n$/, "");
}

function parseUri(input: string): { scheme: string; normalizedUri: string } {
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

export class DefaultSecretResolver implements SecretResolver {
  private readonly env: NodeJS.ProcessEnv;
  private readonly uriResolvers: Record<string, UriSecretResolver>;

  constructor(options: SecretResolverOptions = {}) {
    this.env = options.env ?? process.env;
    this.uriResolvers = options.uriResolvers ?? {};
  }

  async resolve(ref: CredentialRef): Promise<string> {
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
      throw new Error(
        `Unsupported credential URI scheme: ${scheme}. Add a uri resolver for "${scheme}" in SecretResolver.`,
      );
    }

    return resolver(normalizedUri);
  }
}

export function createSecretResolver(options?: SecretResolverOptions): SecretResolver {
  return new DefaultSecretResolver(options);
}
