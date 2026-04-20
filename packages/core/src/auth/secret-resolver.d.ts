import type { CredentialRef } from "./sql-profile-loader.js";
export interface SecretResolver {
    resolve(ref: CredentialRef): Promise<string>;
}
export type UriSecretResolver = (uri: string) => Promise<string>;
export type SecretResolverOptions = {
    env?: NodeJS.ProcessEnv;
    uriResolvers?: Record<string, UriSecretResolver>;
};
export declare class DefaultSecretResolver implements SecretResolver {
    private readonly env;
    private readonly uriResolvers;
    constructor(options?: SecretResolverOptions);
    resolve(ref: CredentialRef): Promise<string>;
}
export declare function createSecretResolver(options?: SecretResolverOptions): SecretResolver;
