# Secure Local SQL Login Design

## Goal

Allow a customer to enter TaurusDB SQL credentials after selecting an instance without sending the password through the Agent, conversation history, or MCP tool arguments.

## Scope

The first version supports MCP servers running on the customer's local machine. The credential form is served only on `127.0.0.1` using a random operating-system-assigned port.

Remote server, container-to-host, ECS, HTTPS reverse proxy, and multi-user deployments are outside this version's scope.

## Security Model

- SQL passwords must never appear in MCP tool arguments or tool responses.
- The local login service binds only to `127.0.0.1`.
- Each login request uses a cryptographically random, single-use token.
- Tokens expire after five minutes.
- The login response uses `Cache-Control: no-store`.
- Submitted passwords are never echoed in HTML, errors, or logs.
- Accepted credentials remain only in the MCP server process memory.
- Tokens and credentials are cleared when the MCP server exits.
- `set_sql_credentials` and `set_cloud_access_keys` are removed from the MCP tool registry with no plaintext compatibility switch.
- Huawei Cloud AK/SK must be supplied through process configuration, such as environment variables.

## Components

### Local Credential Login Service

A focused module owns the loopback HTTP server, pending login tokens, HTML form rendering, request-body parsing, expiry checks, and single-use enforcement.

The service starts lazily when the first SQL login is requested. It returns a loopback URL containing the one-time token. A successful form submission calls a server-provided credential binding callback and consumes the token.

### `begin_sql_login` MCP Tool

The tool resolves the selected or default datasource and creates a pending SQL login request. Its response includes:

- `datasource`
- `login_url`
- `expires_at`

It does not accept or return username or password fields.

### Session Credential Binding

The login service passes the submitted username and password directly to the existing runtime datasource override. The engine is rebuilt after binding so stale connection pools cannot reuse old credentials.

### Tool Registry

`set_sql_credentials` and `set_cloud_access_keys` are not registered. `begin_sql_login` replaces the SQL credential tool. `set_cloud_region` remains available because region identifiers are not secrets.

## User Flow

1. Configure region and AK/SK when starting the MCP server.
2. Call `list_cloud_taurus_instances`.
3. Call `select_cloud_taurus_instance`.
4. Call `begin_sql_login`.
5. Open the returned `127.0.0.1` URL in a browser.
6. Enter the SQL username and password in the local form.
7. Return to the MCP conversation and execute SQL.

## Error Handling

- Unknown, expired, or already-used tokens return a generic invalid-link page.
- Missing username or password redisplays a generic validation error without echoing submitted values.
- Credential binding failures return a generic failure page and consume the token to prevent replay.
- `begin_sql_login` fails if no datasource can be resolved.
- SQL execution without credentials continues to instruct the user to call `begin_sql_login`.

## Testing

Automated tests cover:

- Loopback-only listener and random port.
- Token expiry, invalid token, and single use.
- Successful credential binding without password response leakage.
- `Cache-Control: no-store`.
- `begin_sql_login` output and datasource resolution.
- Removal of plaintext credential tools.
- Updated missing-credential guidance.
- Full Core and MCP test suites.

