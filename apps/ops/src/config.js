import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import {
  ensureOpsDirectories,
  getOpsConfigFile,
  getOpsEnvFile,
  getOpsHomeDir,
  getOpsSecretsFile,
  getResponderConfigFile,
  readEnvFile,
  readJsonFile,
  secretStoreExists,
  unlockSecretStore,
  updateEnvFile,
  writeJsonFile,
  writeSecretValues
} from "@delexec/runtime-utils";

export const DEFAULT_PORTS = Object.freeze({
  supervisor: 8079,
  relay: 8090,
  caller: 8081,
  responder: 8082,
  skill_adapter: 8091,
  mcp_adapter: 8092
});

export const DEFAULT_TRANSPORT_TYPE = "local";
export const DEFAULT_EMAIL_PROVIDER = "emailengine";
export const DEFAULT_EMAIL_POLL_INTERVAL_MS = 5000;

const TRANSPORT_SECRET_ENV_KEYS = Object.freeze({
  emailengine: {
    access_token: "TRANSPORT_EMAILENGINE_ACCESS_TOKEN"
  },
  gmail: {
    client_secret: "TRANSPORT_GMAIL_CLIENT_SECRET",
    refresh_token: "TRANSPORT_GMAIL_REFRESH_TOKEN"
  }
});

export const OPS_SECRET_KEYS = Object.freeze({
  caller_api_key: "caller_api_key",
  responder_platform_api_key: "responder_platform_api_key",
  transport_emailengine_access_token: "transport_emailengine_access_token",
  transport_gmail_client_secret: "transport_gmail_client_secret",
  transport_gmail_refresh_token: "transport_gmail_refresh_token",
  platform_admin_api_key: "platform_admin_api_key"
});

const LEGACY_SECRET_CONFIG_PATHS = Object.freeze({
  [OPS_SECRET_KEYS.caller_api_key]: ["caller", "api_key"],
  [OPS_SECRET_KEYS.platform_admin_api_key]: ["platform_console", "admin_api_key"]
});

function resolveDefaultPorts() {
  return {
    supervisor: Number(process.env.OPS_PORT_SUPERVISOR || DEFAULT_PORTS.supervisor),
    relay: Number(process.env.OPS_PORT_RELAY || DEFAULT_PORTS.relay),
    caller: Number(process.env.OPS_PORT_CALLER || DEFAULT_PORTS.caller),
    responder: Number(process.env.OPS_PORT_RESPONDER || DEFAULT_PORTS.responder),
    skill_adapter: Number(process.env.OPS_PORT_SKILL_ADAPTER || DEFAULT_PORTS.skill_adapter),
    mcp_adapter: Number(process.env.OPS_PORT_MCP_ADAPTER || DEFAULT_PORTS.mcp_adapter)
  };
}

function randomResponderId() {
  return `responder_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

function encodePemForEnv(pem) {
  return pem.replace(/\n/g, "\\n");
}

function decodePemFromEnv(pem) {
  return pem ? pem.replace(/\\n/g, "\n") : null;
}

function normalizedString(value) {
  if (value === undefined || value === null) {
    return null;
  }
  const trimmed = String(value).trim();
  return trimmed ? trimmed : null;
}

function normalizePollInterval(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_EMAIL_POLL_INTERVAL_MS;
  }
  return Math.trunc(parsed);
}

function ensureStringList(value, fallback = []) {
  if (!Array.isArray(value)) {
    return [...fallback];
  }
  return value.map((item) => String(item)).filter(Boolean);
}

const INVALID_INPUT_DESCRIPTION_PATTERNS = [
  /^source text\.?$/i,
  /^source text that should be summarized\.?$/i,
  /^optional summarization instruction or emphasis\.?$/i,
  /^instruction for the hotline\.?$/i,
  /^optional task context\.?$/i,
  /^describe the expected task result\.?$/i,
  /^optional context for the task\.?$/i
];

function defaultTransportConfig() {
  return {
    type: DEFAULT_TRANSPORT_TYPE,
    relay_http: {
      base_url: null
    },
    email: {
      provider: DEFAULT_EMAIL_PROVIDER,
      mode: "shared_mailbox",
      sender: null,
      receiver: null,
      poll_interval_ms: DEFAULT_EMAIL_POLL_INTERVAL_MS,
      emailengine: {
        base_url: null,
        account: null
      },
      gmail: {
        client_id: null,
        user: null
      }
    }
  };
}

function getLegacyTransportBaseUrl(config, env) {
  return (
    normalizedString(config?.runtime?.external_relay?.base_url) ||
    normalizedString(env.TRANSPORT_BASE_URL) ||
    null
  );
}

export function normalizeTransportConfig(config = {}, env = {}) {
  const defaults = defaultTransportConfig();
  const source = config?.runtime?.transport || null;
  const legacyBaseUrl = getLegacyTransportBaseUrl(config, env);
  const envType = normalizedString(env.TRANSPORT_TYPE);
  const type = envType || normalizedString(source?.type) || (legacyBaseUrl ? "relay_http" : DEFAULT_TRANSPORT_TYPE);
  const provider = normalizedString(source?.email?.provider) || DEFAULT_EMAIL_PROVIDER;

  return {
    type,
    relay_http: {
      base_url: normalizedString(source?.relay_http?.base_url) || (type === "relay_http" ? legacyBaseUrl : null)
    },
    email: {
      provider,
      mode: "shared_mailbox",
      sender: normalizedString(source?.email?.sender),
      receiver: normalizedString(source?.email?.receiver),
      poll_interval_ms: normalizePollInterval(source?.email?.poll_interval_ms || defaults.email.poll_interval_ms),
      emailengine: {
        base_url: normalizedString(source?.email?.emailengine?.base_url),
        account: normalizedString(source?.email?.emailengine?.account)
      },
      gmail: {
        client_id: normalizedString(source?.email?.gmail?.client_id),
        user: normalizedString(source?.email?.gmail?.user)
      }
    }
  };
}

export function readTransportSecretsFromEnv(env = {}) {
  return {
    emailengine: {
      access_token:
        normalizedString(env[TRANSPORT_SECRET_ENV_KEYS.emailengine.access_token]) ||
        normalizedString(env[OPS_SECRET_KEYS.transport_emailengine_access_token])
    },
    gmail: {
      client_secret:
        normalizedString(env[TRANSPORT_SECRET_ENV_KEYS.gmail.client_secret]) ||
        normalizedString(env[OPS_SECRET_KEYS.transport_gmail_client_secret]),
      refresh_token:
        normalizedString(env[TRANSPORT_SECRET_ENV_KEYS.gmail.refresh_token]) ||
        normalizedString(env[OPS_SECRET_KEYS.transport_gmail_refresh_token])
    }
  };
}

export function redactTransportConfig(config = {}, env = {}) {
  const transport = normalizeTransportConfig({ runtime: { transport: config } }, env);
  const secrets = readTransportSecretsFromEnv(env);
  return {
    ...transport,
    email: {
      ...transport.email,
      emailengine: {
        ...transport.email.emailengine,
        access_token_configured: Boolean(secrets.emailengine.access_token)
      },
      gmail: {
        ...transport.email.gmail,
        client_secret_configured: Boolean(secrets.gmail.client_secret),
        refresh_token_configured: Boolean(secrets.gmail.refresh_token)
      }
    }
  };
}

export function buildTransportEnvUpdates(transportConfig = {}, env = {}) {
  const transport = normalizeTransportConfig({ runtime: { transport: transportConfig } }, env);
  const updates = {
    TRANSPORT_TYPE: transport.type,
    TRANSPORT_PROVIDER: transport.type === "email" ? transport.email.provider : null,
    TRANSPORT_BASE_URL:
      transport.type === "relay_http"
        ? transport.relay_http.base_url
        : env.TRANSPORT_BASE_URL || null,
    TRANSPORT_EMAIL_PROVIDER: transport.type === "email" ? transport.email.provider : env.TRANSPORT_EMAIL_PROVIDER || null,
    TRANSPORT_EMAIL_MODE: transport.type === "email" ? transport.email.mode : env.TRANSPORT_EMAIL_MODE || null,
    TRANSPORT_EMAIL_SENDER: transport.type === "email" ? transport.email.sender : env.TRANSPORT_EMAIL_SENDER || null,
    TRANSPORT_EMAIL_RECEIVER: transport.type === "email" ? transport.email.receiver : env.TRANSPORT_EMAIL_RECEIVER || null,
    TRANSPORT_EMAIL_POLL_INTERVAL_MS:
      transport.type === "email" ? String(transport.email.poll_interval_ms) : env.TRANSPORT_EMAIL_POLL_INTERVAL_MS || null,
    TRANSPORT_EMAILENGINE_BASE_URL:
      transport.type === "email" && transport.email.provider === "emailengine"
        ? transport.email.emailengine.base_url
        : env.TRANSPORT_EMAILENGINE_BASE_URL || null,
    TRANSPORT_EMAILENGINE_ACCOUNT:
      transport.type === "email" && transport.email.provider === "emailengine"
        ? transport.email.emailengine.account
        : env.TRANSPORT_EMAILENGINE_ACCOUNT || null,
    TRANSPORT_GMAIL_CLIENT_ID:
      transport.type === "email" && transport.email.provider === "gmail"
        ? transport.email.gmail.client_id
        : env.TRANSPORT_GMAIL_CLIENT_ID || null,
    TRANSPORT_GMAIL_USER:
      transport.type === "email" && transport.email.provider === "gmail"
        ? transport.email.gmail.user
        : env.TRANSPORT_GMAIL_USER || null
  };

  return updates;
}

export function buildTransportSecretEnvUpdates(transportConfig = {}, body = {}, currentEnv = {}) {
  const transport = normalizeTransportConfig({ runtime: { transport: transportConfig } }, currentEnv);
  const updates = {};

  const emailengineSecret = normalizedString(body?.email?.emailengine?.access_token);
  if (emailengineSecret) {
    updates[TRANSPORT_SECRET_ENV_KEYS.emailengine.access_token] = emailengineSecret;
  }

  const gmailClientSecret = normalizedString(body?.email?.gmail?.client_secret);
  if (gmailClientSecret) {
    updates[TRANSPORT_SECRET_ENV_KEYS.gmail.client_secret] = gmailClientSecret;
  }

  const gmailRefreshToken = normalizedString(body?.email?.gmail?.refresh_token);
  if (gmailRefreshToken) {
    updates[TRANSPORT_SECRET_ENV_KEYS.gmail.refresh_token] = gmailRefreshToken;
  }

  if (transport.type !== "email" || transport.email.provider !== "emailengine") {
    const current = normalizedString(currentEnv[TRANSPORT_SECRET_ENV_KEYS.emailengine.access_token]);
    if (current) {
      updates[TRANSPORT_SECRET_ENV_KEYS.emailengine.access_token] = current;
    }
  }
  if (transport.type !== "email" || transport.email.provider !== "gmail") {
    const currentClientSecret = normalizedString(currentEnv[TRANSPORT_SECRET_ENV_KEYS.gmail.client_secret]);
    const currentRefreshToken = normalizedString(currentEnv[TRANSPORT_SECRET_ENV_KEYS.gmail.refresh_token]);
    if (currentClientSecret) {
      updates[TRANSPORT_SECRET_ENV_KEYS.gmail.client_secret] = currentClientSecret;
    }
    if (currentRefreshToken) {
      updates[TRANSPORT_SECRET_ENV_KEYS.gmail.refresh_token] = currentRefreshToken;
    }
  }

  return updates;
}

export function buildTransportSecretUpdates(body = {}) {
  const updates = {};
  const emailengineSecret = normalizedString(body?.email?.emailengine?.access_token);
  if (emailengineSecret) {
    updates[OPS_SECRET_KEYS.transport_emailengine_access_token] = emailengineSecret;
  }
  const gmailClientSecret = normalizedString(body?.email?.gmail?.client_secret);
  if (gmailClientSecret) {
    updates[OPS_SECRET_KEYS.transport_gmail_client_secret] = gmailClientSecret;
  }
  const gmailRefreshToken = normalizedString(body?.email?.gmail?.refresh_token);
  if (gmailRefreshToken) {
    updates[OPS_SECRET_KEYS.transport_gmail_refresh_token] = gmailRefreshToken;
  }
  return updates;
}

export function generateSigningKeyPair() {
  const pair = crypto.generateKeyPairSync("ed25519");
  return {
    publicKeyPem: pair.publicKey.export({ type: "spki", format: "pem" }).toString(),
    privateKeyPem: pair.privateKey.export({ type: "pkcs8", format: "pem" }).toString()
  };
}

export function createDefaultOpsConfig(env = {}) {
  const ports = resolveDefaultPorts();
  const resolvedEnv = {
    ...process.env,
    ...env
  };
  return {
    platform: {
      enabled: false,
      base_url: resolvedEnv.PLATFORM_API_BASE_URL || "http://127.0.0.1:8080"
    },
    platform_console: {
      base_url: resolvedEnv.PLATFORM_API_BASE_URL || "http://127.0.0.1:8080"
    },
    caller: {
      enabled: true,
      api_key: null,
      api_key_configured: Boolean(resolvedEnv.CALLER_PLATFORM_API_KEY || resolvedEnv.PLATFORM_API_KEY),
      contact_email: resolvedEnv.CALLER_CONTACT_EMAIL || null,
      registration_mode: resolvedEnv.CALLER_CONTACT_EMAIL ? "local_only" : null
    },
    responder: {
      enabled: false,
      responder_id: resolvedEnv.RESPONDER_ID || null,
      display_name: "Local Responder",
      hotlines: []
    },
    preferences: {
      task_types: {}
    },
    runtime: {
      ports,
      external_relay: null,
      transport: defaultTransportConfig()
    }
  };
}

function inferPlatformEnabled(config = {}, env = {}) {
  if (typeof config?.platform?.enabled === "boolean") {
    return config.platform.enabled;
  }
  const hotlines = Array.isArray(config?.responder?.hotlines) ? config.responder.hotlines : [];
  const hasSubmittedHotline = hotlines.some((item) => item?.submitted_for_review === true);
  const hasPlatformReviewState = hotlines.some((item) => {
    const status = normalizedString(item?.review_status);
    return status && status !== "local_only";
  });
  const hasResponderPlatformCredential = Boolean(normalizedString(env.RESPONDER_PLATFORM_API_KEY));
  const hasAdminPlatformCredential = Boolean(normalizedString(env.PLATFORM_ADMIN_API_KEY));
  return hasSubmittedHotline || hasPlatformReviewState || hasResponderPlatformCredential || hasAdminPlatformCredential;
}

export function ensureOpsState() {
  ensureOpsDirectories();
  const envFile = getOpsEnvFile();
  const fileEnv = readEnvFile(envFile);
  const env = {
    ...fileEnv,
    ...process.env
  };
  const secretsFile = getOpsSecretsFile();
  const opsConfigFile = getOpsConfigFile();
  let config = readJsonFile(opsConfigFile, null);

  if (!config) {
    const legacyResponder = readJsonFile(getResponderConfigFile(), null);
    config = createDefaultOpsConfig(env);
    if (legacyResponder) {
      config.responder = {
        enabled: legacyResponder.enabled !== false,
        responder_id: legacyResponder.responder_id || env.RESPONDER_ID || null,
        display_name: legacyResponder.display_name || "Local Responder",
        hotlines: Array.isArray(legacyResponder.hotlines) ? legacyResponder.hotlines : []
      };
    }
  }

  config.platform ||= { base_url: env.PLATFORM_API_BASE_URL || process.env.PLATFORM_API_BASE_URL || "http://127.0.0.1:8080" };
  config.platform.enabled = inferPlatformEnabled(config, env);
  config.platform_console ||= { base_url: config.platform.base_url || env.PLATFORM_API_BASE_URL || "http://127.0.0.1:8080" };
  config.caller ||= {
    enabled: true,
    api_key: null,
    api_key_configured: false,
    contact_email: env.CALLER_CONTACT_EMAIL || process.env.CALLER_CONTACT_EMAIL || null,
    registration_mode: null
  };
  const callerApiKey =
    config.caller.api_key ||
    env.CALLER_PLATFORM_API_KEY ||
    env.PLATFORM_API_KEY ||
    process.env.CALLER_PLATFORM_API_KEY ||
    process.env.PLATFORM_API_KEY ||
    null;
  config.caller.api_key = normalizedString(config.caller.api_key);
  config.caller.registration_mode = normalizedString(config.caller.registration_mode) || (callerApiKey ? "platform" : null);
  config.caller.api_key_configured = Boolean(callerApiKey);
  config.responder ||= {
    enabled: false,
    responder_id: env.RESPONDER_ID || process.env.RESPONDER_ID || null,
    display_name: "Local Responder",
    hotlines: []
  };
  config.preferences ||= { task_types: {} };
  config.preferences.task_types ||= {};
  const defaultPorts = resolveDefaultPorts();
  config.runtime ||= { ports: defaultPorts, external_relay: null, transport: defaultTransportConfig() };
  config.runtime.ports ||= defaultPorts;
  config.runtime.transport = normalizeTransportConfig(config, env);

  for (const [key, value] of Object.entries(defaultPorts)) {
    config.runtime.ports[key] ||= value;
  }

  return { envFile, opsConfigFile, secretsFile, env, config };
}

function getLegacyConfigSecret(config, secretKey) {
  const pathSegments = LEGACY_SECRET_CONFIG_PATHS[secretKey];
  if (!pathSegments) {
    return null;
  }
  let current = config;
  for (const segment of pathSegments) {
    current = current?.[segment];
  }
  return normalizedString(current);
}

export function readLegacyOpsSecrets(state) {
  const env = state?.env || {};
  const config = state?.config || {};
  const transport = readTransportSecretsFromEnv(env);
  return {
    [OPS_SECRET_KEYS.caller_api_key]:
      getLegacyConfigSecret(config, OPS_SECRET_KEYS.caller_api_key) ||
      normalizedString(env.CALLER_PLATFORM_API_KEY) ||
      normalizedString(env.PLATFORM_API_KEY),
    [OPS_SECRET_KEYS.responder_platform_api_key]: normalizedString(env.RESPONDER_PLATFORM_API_KEY),
    [OPS_SECRET_KEYS.transport_emailengine_access_token]: transport.emailengine.access_token,
    [OPS_SECRET_KEYS.transport_gmail_client_secret]: transport.gmail.client_secret,
    [OPS_SECRET_KEYS.transport_gmail_refresh_token]: transport.gmail.refresh_token,
    [OPS_SECRET_KEYS.platform_admin_api_key]:
      getLegacyConfigSecret(config, OPS_SECRET_KEYS.platform_admin_api_key) ||
      normalizedString(env.PLATFORM_ADMIN_API_KEY)
  };
}

export function listLegacySecretKeys(state) {
  return Object.entries(readLegacyOpsSecrets(state))
    .filter(([, value]) => normalizedString(value))
    .map(([key]) => key);
}

export function getConfiguredSecretFile() {
  return getOpsSecretsFile();
}

export function hasEncryptedSecretStore() {
  return secretStoreExists(getConfiguredSecretFile());
}

export function unlockOpsSecrets(passphrase) {
  return unlockSecretStore(getConfiguredSecretFile(), passphrase).secrets;
}

export function writeOpsSecrets(passphrase, updates) {
  return writeSecretValues(getConfiguredSecretFile(), passphrase, updates);
}

export function readResolvedOpsSecrets(state, unlockedSecrets = null) {
  const legacy = readLegacyOpsSecrets(state);
  const encrypted = unlockedSecrets || {};
  return {
    caller_api_key: normalizedString(encrypted[OPS_SECRET_KEYS.caller_api_key]) || legacy[OPS_SECRET_KEYS.caller_api_key] || null,
    responder_platform_api_key:
      normalizedString(encrypted[OPS_SECRET_KEYS.responder_platform_api_key]) || legacy[OPS_SECRET_KEYS.responder_platform_api_key] || null,
    transport: {
      emailengine: {
        access_token:
          normalizedString(encrypted[OPS_SECRET_KEYS.transport_emailengine_access_token]) ||
          legacy[OPS_SECRET_KEYS.transport_emailengine_access_token] ||
          null
      },
      gmail: {
        client_secret:
          normalizedString(encrypted[OPS_SECRET_KEYS.transport_gmail_client_secret]) ||
          legacy[OPS_SECRET_KEYS.transport_gmail_client_secret] ||
          null,
        refresh_token:
          normalizedString(encrypted[OPS_SECRET_KEYS.transport_gmail_refresh_token]) ||
          legacy[OPS_SECRET_KEYS.transport_gmail_refresh_token] ||
          null
      }
    },
    platform_admin_api_key:
      normalizedString(encrypted[OPS_SECRET_KEYS.platform_admin_api_key]) || legacy[OPS_SECRET_KEYS.platform_admin_api_key] || null
  };
}

export function scrubLegacySecrets(state) {
  if (!state?.config || !state?.envFile) {
    return state;
  }
  if (state.config.caller) {
    state.config.caller.api_key = null;
    state.config.caller.api_key_configured = true;
  }
  state.config.platform_console ||= {};
  state.config.platform_console.admin_api_key = null;
  writeJsonFile(state.opsConfigFile, state.config);
  state.env = updateEnvFile(
    state.envFile,
    {
      CALLER_PLATFORM_API_KEY: null,
      PLATFORM_API_KEY: null,
      RESPONDER_PLATFORM_API_KEY: null,
      PLATFORM_ADMIN_API_KEY: null,
      TRANSPORT_EMAILENGINE_ACCESS_TOKEN: null,
      TRANSPORT_GMAIL_CLIENT_SECRET: null,
      TRANSPORT_GMAIL_REFRESH_TOKEN: null
    },
    { removeNull: true }
  );
  return state;
}

export function saveOpsState({ envFile, opsConfigFile, env, config }) {
  const encryptedStoreConfigured = secretStoreExists(getConfiguredSecretFile());
  const resolvedCallerApiKey =
    normalizedString(env.CALLER_PLATFORM_API_KEY) ||
    normalizedString(env.PLATFORM_API_KEY) ||
    normalizedString(config.caller?.api_key);
  const resolvedResponderPlatformApiKey = normalizedString(env.RESPONDER_PLATFORM_API_KEY);
  const resolvedPlatformAdminApiKey =
    normalizedString(env.PLATFORM_ADMIN_API_KEY) ||
    normalizedString(config.platform_console?.admin_api_key);
  const transportSecrets = readTransportSecretsFromEnv(env);

  config.caller ||= {};
  config.caller.api_key = null;
  config.caller.api_key_configured = Boolean(config.caller.api_key_configured || resolvedCallerApiKey);
  config.platform_console ||= {};
  config.platform_console.admin_api_key = null;
  writeJsonFile(opsConfigFile, config);
  const transportEnv = buildTransportEnvUpdates(config.runtime?.transport || {}, env);
  const relayBaseUrl =
    normalizeTransportConfig(config, env).type === "local"
      ? `http://127.0.0.1:${config.runtime?.ports?.relay || DEFAULT_PORTS.relay}`
      : transportEnv.TRANSPORT_BASE_URL;
  const updates = {
    PLATFORM_API_BASE_URL: config.platform?.base_url || env.PLATFORM_API_BASE_URL || null,
    CALLER_PLATFORM_API_KEY: encryptedStoreConfigured ? null : resolvedCallerApiKey,
    PLATFORM_API_KEY: encryptedStoreConfigured ? null : resolvedCallerApiKey,
    CALLER_CONTACT_EMAIL: config.caller?.contact_email || env.CALLER_CONTACT_EMAIL || null,
    RESPONDER_PLATFORM_API_KEY: encryptedStoreConfigured ? null : resolvedResponderPlatformApiKey,
    RESPONDER_ID: config.responder?.responder_id || env.RESPONDER_ID || null,
    HOTLINE_IDS: (config.responder?.hotlines || []).map((item) => item.hotline_id).filter(Boolean).join(","),
    TRANSPORT_BASE_URL: relayBaseUrl,
    TRANSPORT_TYPE: transportEnv.TRANSPORT_TYPE,
    TRANSPORT_PROVIDER: transportEnv.TRANSPORT_PROVIDER,
    TRANSPORT_EMAIL_PROVIDER: transportEnv.TRANSPORT_EMAIL_PROVIDER,
    TRANSPORT_EMAIL_MODE: transportEnv.TRANSPORT_EMAIL_MODE,
    TRANSPORT_EMAIL_SENDER: transportEnv.TRANSPORT_EMAIL_SENDER,
    TRANSPORT_EMAIL_RECEIVER: transportEnv.TRANSPORT_EMAIL_RECEIVER,
    TRANSPORT_EMAIL_POLL_INTERVAL_MS: transportEnv.TRANSPORT_EMAIL_POLL_INTERVAL_MS,
    TRANSPORT_EMAILENGINE_BASE_URL: transportEnv.TRANSPORT_EMAILENGINE_BASE_URL,
    TRANSPORT_EMAILENGINE_ACCOUNT: transportEnv.TRANSPORT_EMAILENGINE_ACCOUNT,
    TRANSPORT_GMAIL_CLIENT_ID: transportEnv.TRANSPORT_GMAIL_CLIENT_ID,
    TRANSPORT_GMAIL_USER: transportEnv.TRANSPORT_GMAIL_USER,
    TRANSPORT_EMAILENGINE_ACCESS_TOKEN: encryptedStoreConfigured ? null : transportSecrets.emailengine.access_token,
    TRANSPORT_GMAIL_CLIENT_SECRET: encryptedStoreConfigured ? null : transportSecrets.gmail.client_secret,
    TRANSPORT_GMAIL_REFRESH_TOKEN: encryptedStoreConfigured ? null : transportSecrets.gmail.refresh_token,
    PLATFORM_ADMIN_API_KEY: encryptedStoreConfigured ? null : resolvedPlatformAdminApiKey,
    PORT: null
  };
  return updateEnvFile(envFile, updates, { removeNull: true });
}

export function ensureResponderIdentity(state, { responderId = null, displayName = null } = {}) {
  const { env, config } = state;
  const currentResponderId = responderId || config.responder?.responder_id || env.RESPONDER_ID || randomResponderId();
  config.responder ||= {};
  config.responder.responder_id = currentResponderId;
  config.responder.display_name = displayName || config.responder.display_name || "Local Responder";
  config.responder.hotlines ||= [];

  if (!env.RESPONDER_SIGNING_PUBLIC_KEY_PEM || !env.RESPONDER_SIGNING_PRIVATE_KEY_PEM) {
    const signing = generateSigningKeyPair();
    updateEnvFile(state.envFile, {
      RESPONDER_SIGNING_PUBLIC_KEY_PEM: encodePemForEnv(signing.publicKeyPem),
      RESPONDER_SIGNING_PRIVATE_KEY_PEM: encodePemForEnv(signing.privateKeyPem),
      RESPONDER_ID: currentResponderId
    });
    state.env = readEnvFile(state.envFile);
  }

  return {
    responder_id: currentResponderId,
    display_name: config.responder.display_name,
    public_key_pem: decodePemFromEnv(state.env.RESPONDER_SIGNING_PUBLIC_KEY_PEM),
    private_key_pem: decodePemFromEnv(state.env.RESPONDER_SIGNING_PRIVATE_KEY_PEM)
  };
}

export function upsertHotline(state, definition) {
  state.config.responder ||= { enabled: false, responder_id: null, display_name: "Local Responder", hotlines: [] };
  state.config.responder.hotlines ||= [];
  state.config.responder.hotlines = [
    ...state.config.responder.hotlines.filter((item) => item.hotline_id !== definition.hotline_id),
    definition
  ];
  return definition;
}

export function setHotlineEnabled(state, hotlineId, enabled) {
  state.config.responder ||= { enabled: false, responder_id: null, display_name: "Local Responder", hotlines: [] };
  state.config.responder.hotlines ||= [];
  const item = state.config.responder.hotlines.find((entry) => entry.hotline_id === hotlineId);
  if (!item) {
    return null;
  }
  item.enabled = enabled;
  return item;
}

export function removeHotline(state, hotlineId) {
  state.config.responder ||= { enabled: false, responder_id: null, display_name: "Local Responder", hotlines: [] };
  state.config.responder.hotlines ||= [];
  const existing = state.config.responder.hotlines.find((entry) => entry.hotline_id === hotlineId);
  if (!existing) {
    return null;
  }
  state.config.responder.hotlines = state.config.responder.hotlines.filter((entry) => entry.hotline_id !== hotlineId);
  removeManagedLocalFile(
    existing?.metadata?.registration?.draft_file || getHotlineRegistrationDraftFile(existing.hotline_id),
    getHotlineRegistrationDraftsDir()
  );
  removeManagedLocalFile(
    existing?.metadata?.local?.integration_file || getHotlineLocalIntegrationFile(existing.hotline_id),
    getHotlineLocalIntegrationsDir()
  );
  removeManagedLocalFile(
    existing?.metadata?.local?.hook_file || getHotlineLocalHookFile(existing.hotline_id),
    getHotlineLocalHooksDir()
  );
  return existing;
}

function sanitizeHotlineIdForFileName(hotlineId) {
  return String(hotlineId || "")
    .toLowerCase()
    .replace(/[^a-z0-9.-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function getHotlineRegistrationDraftsDir() {
  return path.join(getOpsHomeDir(), "hotline-registration-drafts");
}

export function getHotlineRegistrationDraftFile(hotlineId) {
  const safeName = sanitizeHotlineIdForFileName(hotlineId) || "hotline";
  return path.join(getHotlineRegistrationDraftsDir(), `${safeName}.registration.json`);
}

export function getHotlineLocalIntegrationsDir() {
  return path.join(getOpsHomeDir(), "hotline-integrations");
}

export function getHotlineLocalHooksDir() {
  return path.join(getOpsHomeDir(), "hotline-hooks");
}

export function getHotlineLocalIntegrationFile(hotlineId) {
  const safeName = sanitizeHotlineIdForFileName(hotlineId) || "hotline";
  return path.join(getHotlineLocalIntegrationsDir(), `${safeName}.integration.json`);
}

export function getHotlineLocalHookFile(hotlineId) {
  const safeName = sanitizeHotlineIdForFileName(hotlineId) || "hotline";
  return path.join(getHotlineLocalHooksDir(), `${safeName}.hooks.json`);
}

function buildHotlineLocalIntegration(definition = {}) {
  return {
    schema_version: 1,
    updated_at: new Date().toISOString(),
    source: "delexec-ops",
    hotline_id: definition.hotline_id,
    display_name: definition.display_name || definition.hotline_id,
    adapter_type: definition.adapter_type || "process",
    adapter: definition.adapter || null,
    timeouts: definition.timeouts || null,
    task_types: ensureStringList(definition.task_types),
    capabilities: ensureStringList(definition.capabilities),
    tags: ensureStringList(definition.tags),
    project: definition?.metadata?.project || null,
    note: "Machine-local hotline integration config. Keep responder-specific commands, URLs, paths, and hook references here instead of inside git-tracked files."
  };
}

function buildDefaultHotlineHookConfig(definition = {}) {
  return {
    schema_version: 1,
    hotline_id: definition.hotline_id,
    source: "delexec-ops",
    hooks: {
      before_invoke: null,
      after_success: null,
      after_error: null
    },
    note: "Optional machine-local hook commands or script paths. Keep these under DELEXEC_HOME and out of the repository."
  };
}

function removeManagedLocalFile(filePath, expectedDir) {
  if (!filePath || !expectedDir) {
    return;
  }
  const resolvedFile = path.resolve(filePath);
  const resolvedDir = path.resolve(expectedDir);
  if (resolvedFile !== resolvedDir && !resolvedFile.startsWith(`${resolvedDir}${path.sep}`)) {
    return;
  }
  if (fs.existsSync(resolvedFile)) {
    fs.rmSync(resolvedFile, { force: true });
  }
}

export function ensureHotlineLocalIntegration(definition) {
  ensureOpsDirectories();
  const integrationFile = getHotlineLocalIntegrationFile(definition.hotline_id);
  const hookFile = getHotlineLocalHookFile(definition.hotline_id);
  const existingHooks = readJsonFile(hookFile, null);

  writeJsonFile(integrationFile, buildHotlineLocalIntegration(definition));
  if (!existingHooks) {
    writeJsonFile(hookFile, buildDefaultHotlineHookConfig(definition));
  }

  definition.metadata ||= {};
  definition.metadata.local ||= {};
  definition.metadata.local.integration_file = integrationFile;
  definition.metadata.local.hook_file = hookFile;

  return {
    integration_file: integrationFile,
    hook_file: hookFile,
    hooks_created: !existingHooks
  };
}

function buildDefaultContractProfile(definition = {}) {
  const hotlineId = String(definition.hotline_id || "").trim();
  const displayName = String(definition.display_name || hotlineId || "Local Hotline").trim();
  const taskTypes = ensureStringList(definition.task_types);
  const capabilities = ensureStringList(definition.capabilities);
  const textSummarize =
    taskTypes.includes("text_summarize") ||
    capabilities.includes("text.summarize") ||
    hotlineId.includes("summary");

  if (textSummarize) {
    return {
      profile_key: "text_summarize",
      description: `Use ${displayName} when you want a concise summary of project notes, workspace updates, or other text you provide.`,
      summary: `Paste the text you want summarized and optionally tell the hotline what to emphasize.`,
      template_ref: `docs/templates/hotlines/${hotlineId}/`,
      input_schema: {
        type: "object",
        additionalProperties: false,
        required: ["text"],
        properties: {
          text: {
            type: "string",
            description: "Paste the text you want summarized. Include enough context so the summary can stand on its own.",
            minLength: 1
          },
          instruction: {
            type: "string",
            description: "Optional: explain what the summary should emphasize, such as blockers, next steps, risks, or action items."
          }
        }
      },
      output_schema: {
        type: "object",
        additionalProperties: false,
        required: ["summary"],
        properties: {
          summary: {
            type: "string",
            description: "Summary of the provided source text."
          }
        }
      },
      input_examples: [
        {
          title: "Basic summary request",
          input: {
            text: "CHG-2026-003 is in progress. The responder registration flow now supports registration drafts and single-hotline submission.",
            instruction: "Summarize the current status and call out the next engineering step."
          }
        }
      ],
      output_examples: [
        {
          title: "Basic summary result",
          output: {
            summary: "The registration flow now supports drafts and single-hotline submission. The next engineering step is validating the updated responder UI end to end."
          }
        }
      ],
      input_summary: "Paste the text you want summarized. Optionally add an instruction describing what to emphasize, such as blockers, next steps, or risks.",
      output_summary: "You will receive a concise summary suitable for status updates, review notes, or quick progress reports."
    };
  }

  return {
    profile_key: "generic_task",
    description: `Use ${displayName} when you want this hotline to handle a project-specific task for the text or context you provide.`,
    summary: `Describe the task you want completed and include any context the responder should use.`,
    template_ref: `docs/templates/hotlines/${hotlineId}/`,
    input_schema: {
      type: "object",
      additionalProperties: false,
      required: ["prompt"],
      properties: {
        prompt: {
          type: "string",
          description: "Describe the task you want the hotline to complete in one clear instruction."
        },
        context: {
          type: "string",
          description: "Optional: add background, constraints, or extra context the hotline should consider when completing the task."
        }
      }
    },
    output_schema: {
      type: "object",
      additionalProperties: false,
      required: ["result"],
      properties: {
        result: {
          type: "string",
          description: "Primary response returned by the hotline."
        }
      }
    },
    input_examples: [
      {
        title: "Basic request",
        input: {
          prompt: "Review this implementation plan and identify the next concrete step.",
          context: "The goal is to improve the responder registration workflow."
        }
      }
    ],
    output_examples: [
      {
        title: "Basic response",
        output: {
          result: "The next concrete step is wiring the registration draft flow into the responder review UI."
        }
      }
    ],
    input_summary: "Describe the task you want completed. Add any optional context, constraints, or background the hotline should consider.",
    output_summary: "You will receive the primary task result produced from your prompt and context."
  };
}

export function buildHotlineRegistrationDraft(state, definition, existingDraft = null) {
  const fallbackContactEmail = state?.config?.caller?.contact_email || state?.env?.CALLER_CONTACT_EMAIL || null;
  const taskTypes = ensureStringList(definition.task_types);
  const capabilities = ensureStringList(definition.capabilities);
  const tags = ensureStringList(definition.tags);
  const profile = buildDefaultContractProfile(definition);
  const generatedProfileKey = String(profile.profile_key || "generic_task");
  const existingProfileKey = String(existingDraft?.draft_meta?.generated_profile || "").trim();
  const reusableDraft = existingProfileKey === generatedProfileKey ? existingDraft : null;
  const generated = {
    draft_meta: {
      schema_version: 1,
      generated_at: new Date().toISOString(),
      source: "delexec-ops",
      generated_profile: generatedProfileKey,
      editable: [
        "description",
        "summary",
        "template_ref",
        "input_schema",
        "output_schema",
        "input_attachments",
        "output_attachments",
        "input_examples",
        "output_examples",
        "input_summary",
        "output_summary",
        "recommended_for",
        "not_recommended_for",
        "limitations",
        "contact_email",
        "support_email"
      ]
    },
    hotline_id: definition.hotline_id,
    display_name: definition.display_name || definition.hotline_id,
    description: profile.description,
    summary: profile.summary,
    template_ref: profile.template_ref,
    task_types: taskTypes,
    capabilities,
    tags,
    input_schema: profile.input_schema,
    output_schema: profile.output_schema,
    input_attachments: null,
    output_attachments: null,
    input_examples: profile.input_examples,
    output_examples: profile.output_examples,
    input_summary: profile.input_summary,
    output_summary: profile.output_summary,
    recommended_for: [],
    not_recommended_for: [],
    limitations: [],
    contact_email: fallbackContactEmail,
    support_email: null
  };
  return {
    ...generated,
    ...(reusableDraft || {}),
    draft_meta: {
      ...generated.draft_meta,
      ...(reusableDraft?.draft_meta || {})
    },
    hotline_id: definition.hotline_id,
    display_name: reusableDraft?.display_name || definition.display_name || definition.hotline_id,
    task_types: taskTypes,
    capabilities,
    tags
  };
}

export function ensureHotlineRegistrationDraft(state, definition) {
  ensureOpsDirectories();
  const localIntegration = ensureHotlineLocalIntegration(definition);
  const draftFile = getHotlineRegistrationDraftFile(definition.hotline_id);
  const existingDraft = readJsonFile(draftFile, null);
  const draft = buildHotlineRegistrationDraft(state, definition, existingDraft);
  writeJsonFile(draftFile, draft);
  definition.metadata ||= {};
  definition.metadata.registration ||= {};
  definition.metadata.registration.draft_file = draftFile;
  return {
    draft_file: draftFile,
    integration_file: localIntegration.integration_file,
    hook_file: localIntegration.hook_file,
    created: !existingDraft,
    draft
  };
}

export function loadHotlineRegistrationDraft(state, hotline) {
  if (hotline) {
    ensureHotlineLocalIntegration(hotline);
  }
  const draftFile = hotline?.metadata?.registration?.draft_file || getHotlineRegistrationDraftFile(hotline?.hotline_id);
  const draft = readJsonFile(draftFile, null);
  return draft ? { draft_file: draftFile, draft } : { draft_file: draftFile, draft: null };
}

function normalizeGuidanceText(value) {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim();
}

function isValidInputFieldGuidance(value) {
  const text = normalizeGuidanceText(value);
  if (!text) {
    return false;
  }
  return !INVALID_INPUT_DESCRIPTION_PATTERNS.some((pattern) => pattern.test(text));
}

export function validateHotlineRegistrationDraft(draft) {
  const fields = [];
  const properties = draft?.input_schema?.properties;
  if (properties && typeof properties === "object") {
    for (const [name, definition] of Object.entries(properties)) {
      const description = definition && typeof definition === "object" ? definition.description : null;
      if (!isValidInputFieldGuidance(description)) {
        fields.push(name);
      }
    }
  }
  if (fields.length > 0) {
    return {
      ok: false,
      code: "HOTLINE_INPUT_GUIDANCE_REQUIRED",
      message: "every input field must include caller-facing guidance in input_schema.properties.<field>.description",
      fields
    };
  }
  return { ok: true, fields: [] };
}

export function buildHotlineOnboardingBody(state, hotline, responderIdentity) {
  let { draft_file, draft } = loadHotlineRegistrationDraft(state, hotline);
  if (!draft) {
    const created = ensureHotlineRegistrationDraft(state, hotline);
    draft_file = created.draft_file;
    draft = created.draft;
  }
  const validation = validateHotlineRegistrationDraft(draft);
  if (!validation.ok) {
    const error = new Error(validation.message);
    error.code = validation.code;
    error.fields = validation.fields;
    throw error;
  }
  const source = draft || {};
  return {
    draft_file,
    used_draft: Boolean(draft),
    body: {
      responder_id: responderIdentity.responder_id,
      hotline_id: hotline.hotline_id,
      display_name: source.display_name || hotline.display_name || hotline.hotline_id,
      responder_public_key_pem: responderIdentity.public_key_pem,
      description: source.description || null,
      summary: source.summary || null,
      template_ref: source.template_ref || `docs/templates/hotlines/${hotline.hotline_id}/`,
      task_types: ensureStringList(source.task_types, hotline.task_types || []),
      capabilities: ensureStringList(source.capabilities, hotline.capabilities || []),
      tags: ensureStringList(source.tags, hotline.tags || []),
      input_schema: source.input_schema || null,
      output_schema: source.output_schema || null,
      input_attachments: source.input_attachments || null,
      output_attachments: source.output_attachments || null,
      input_examples: Array.isArray(source.input_examples) ? source.input_examples : null,
      output_examples: Array.isArray(source.output_examples) ? source.output_examples : null,
      recommended_for: Array.isArray(source.recommended_for) ? source.recommended_for : null,
      not_recommended_for: Array.isArray(source.not_recommended_for) ? source.not_recommended_for : null,
      limitations: Array.isArray(source.limitations) ? source.limitations : null,
      input_summary: source.input_summary || null,
      output_summary: source.output_summary || null,
      contact_email: source.contact_email || state?.config?.caller?.contact_email || null,
      support_email: source.support_email || null
    }
  };
}
