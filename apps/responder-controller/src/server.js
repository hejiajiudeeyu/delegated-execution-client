import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  createHotlineRouterExecutor,
  createResponderControllerServer,
  createResponderState,
  hydrateResponderState,
  serializeResponderState,
  startResponderHeartbeatLoop
} from "@delexec/responder-runtime-core";
import { createSqliteSnapshotStore } from "@delexec/sqlite-store";
import { createEmailEngineTransportAdapter } from "@delexec/transport-emailengine";
import { createGmailTransportAdapter } from "@delexec/transport-gmail";
import { createRelayHttpTransportAdapter } from "@delexec/transport-relay-http";
import { buildOpsEnvSearchPaths, getOpsConfigFile, getResponderConfigFile, loadEnvFiles, readJsonFile } from "@delexec/runtime-utils";

export * from "@delexec/responder-runtime-core";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "../../..");

loadEnvFiles(buildOpsEnvSearchPaths(ROOT_DIR, "responder"));

function isDirectRun() {
  if (!process.argv[1]) {
    return false;
  }
  return fs.realpathSync.native(path.resolve(process.argv[1])) === fs.realpathSync.native(__filename);
}

function decodePemEnv(value) {
  if (!value) {
    return null;
  }
  return value.replace(/\\n/g, "\n");
}

function loadResponderStateFromEnv() {
  const responderId = process.env.RESPONDER_ID || null;
  const hotlineIds = (process.env.HOTLINE_IDS || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const publicKeyPem = decodePemEnv(process.env.RESPONDER_SIGNING_PUBLIC_KEY_PEM);
  const privateKeyPem = decodePemEnv(process.env.RESPONDER_SIGNING_PRIVATE_KEY_PEM);

  if (!responderId && hotlineIds.length === 0 && !publicKeyPem && !privateKeyPem) {
    return createResponderState();
  }

  const stateOptions = {};
  if (responderId) {
    stateOptions.responderId = responderId;
  }
  if (hotlineIds.length > 0) {
    stateOptions.hotlineIds = hotlineIds;
  }
  if (publicKeyPem || privateKeyPem) {
    if (!publicKeyPem || !privateKeyPem) {
      throw new Error("responder_signing_key_pair_incomplete");
    }
    stateOptions.signing = {
      publicKeyPem,
      privateKeyPem
    };
  }

  return createResponderState(stateOptions);
}

function loadResponderConfigFromDisk() {
  const opsConfig = readJsonFile(getOpsConfigFile(), null);
  if (opsConfig?.responder) {
    return {
      responder_id: opsConfig.responder.responder_id || null,
      display_name: opsConfig.responder.display_name || null,
      enabled: opsConfig.responder.enabled !== false,
      hotlines: Array.isArray(opsConfig.responder.hotlines) ? opsConfig.responder.hotlines : []
    };
  }
  return readJsonFile(getResponderConfigFile(), { responder_id: null, display_name: null, enabled: true, hotlines: [] });
}

function mergeConfigHotlinesIntoState(state, config) {
  const configuredIds = Array.isArray(config?.hotlines)
    ? config.hotlines.map((item) => item?.hotline_id).filter(Boolean)
    : [];
  if (configuredIds.length === 0) {
    return state;
  }
  const merged = new Set([...(state.identity.hotline_ids || []), ...configuredIds]);
  state.identity.hotline_ids = Array.from(merged);
  if (!state.identity.responder_id && config?.responder_id) {
    state.identity.responder_id = config.responder_id;
  }
  state.hotlines = Array.isArray(config?.hotlines) ? config.hotlines : [];
  return state;
}

function createExecutorFromConfig(config) {
  const hotlines = Array.isArray(config?.hotlines) ? config.hotlines : [];
  if (hotlines.length === 0) {
    return null;
  }
  return createHotlineRouterExecutor(hotlines);
}

function loadPlatformConfigFromEnv() {
  const baseUrl = process.env.PLATFORM_API_BASE_URL || null;
  if (!baseUrl) {
    return null;
  }

  return {
    baseUrl,
    apiKey: process.env.RESPONDER_PLATFORM_API_KEY || process.env.PLATFORM_API_KEY || null,
    responderId: process.env.RESPONDER_ID || null
  };
}

function loadResponderGuardrailsFromEnv() {
  const allowedTaskTypes = (process.env.RESPONDER_ALLOWED_TASK_TYPES || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const maxHardTimeoutS = process.env.RESPONDER_MAX_HARD_TIMEOUT_S || null;

  return {
    maxHardTimeoutS: maxHardTimeoutS ? Number(maxHardTimeoutS) : null,
    allowedTaskTypes: allowedTaskTypes.length > 0 ? allowedTaskTypes : null
  };
}

function loadTransportConfigFromEnv() {
  const transportType = process.env.TRANSPORT_TYPE || (process.env.TRANSPORT_BASE_URL ? "relay_http" : null);
  if (transportType === "email") {
    const provider = process.env.TRANSPORT_EMAIL_PROVIDER || process.env.TRANSPORT_PROVIDER || "unknown";
    if (provider === "emailengine") {
      return createEmailEngineTransportAdapter({
        baseUrl: process.env.TRANSPORT_EMAILENGINE_BASE_URL,
        account: process.env.TRANSPORT_EMAILENGINE_ACCOUNT,
        accessToken: process.env.TRANSPORT_EMAILENGINE_ACCESS_TOKEN,
        sender: process.env.TRANSPORT_EMAIL_SENDER || process.env.TRANSPORT_EMAILENGINE_ACCOUNT || null,
        receiver: process.env.TRANSPORT_EMAIL_RECEIVER || process.env.RESPONDER_ID || null
      });
    }
    if (provider === "gmail") {
      return createGmailTransportAdapter({
        clientId: process.env.TRANSPORT_GMAIL_CLIENT_ID,
        clientSecret: process.env.TRANSPORT_GMAIL_CLIENT_SECRET,
        refreshToken: process.env.TRANSPORT_GMAIL_REFRESH_TOKEN,
        user: process.env.TRANSPORT_GMAIL_USER,
        sender: process.env.TRANSPORT_EMAIL_SENDER || process.env.TRANSPORT_GMAIL_USER || null,
        receiver: process.env.TRANSPORT_EMAIL_RECEIVER || process.env.RESPONDER_ID || null
      });
    }
    throw new Error(`TRANSPORT_NOT_IMPLEMENTED: email transport provider ${provider} is not implemented yet`);
  }
  const baseUrl = process.env.TRANSPORT_BASE_URL || null;
  if (!baseUrl || !transportType) {
    return null;
  }

  return createRelayHttpTransportAdapter({
    baseUrl,
    receiver: process.env.TRANSPORT_RECEIVER || process.env.RESPONDER_ID || "responder-controller"
  });
}

async function createOptionalPersistence(serviceName) {
  const sqlitePath = process.env.SQLITE_DATABASE_PATH || null;
  if (!sqlitePath) {
    return null;
  }

  const store = await createSqliteSnapshotStore({
    databasePath: sqlitePath,
    serviceName
  });
  await store.migrate();
  return store;
}

if (isDirectRun()) {
  const port = Number(process.env.PORT || 8082);
  const serviceName = process.env.SERVICE_NAME || "responder-controller";
  const responderConfig = loadResponderConfigFromDisk();
  const state = mergeConfigHotlinesIntoState(loadResponderStateFromEnv(), responderConfig);
  const platform = loadPlatformConfigFromEnv();
  const transport = loadTransportConfigFromEnv();
  const executor = createExecutorFromConfig(responderConfig);
  const persistence = await createOptionalPersistence(serviceName);
  if (persistence) {
    hydrateResponderState(state, await persistence.loadSnapshot());
  }
  let stopHeartbeat = () => {};
  const persistSnapshot = persistence
    ? async (currentState) => {
        await persistence.saveSnapshot(serializeResponderState(currentState));
      }
    : null;

  function restartHeartbeatLoop() {
    stopHeartbeat();
    if (platform?.baseUrl && platform?.apiKey) {
      stopHeartbeat = startResponderHeartbeatLoop({
        state,
        platform,
        intervalMs: Number(process.env.RESPONDER_HEARTBEAT_INTERVAL_MS || 30000),
        onStateChanged: persistSnapshot
      });
      return;
    }
    stopHeartbeat = () => {};
  }

  const server = createResponderControllerServer({
    serviceName,
    state,
    transport,
    platform,
    ...(executor ? { executor } : {}),
    guardrails: loadResponderGuardrailsFromEnv(),
    background: {
      enabled: Boolean(transport),
      receiver: process.env.TRANSPORT_RECEIVER || state.identity.responder_id,
      inboxPollIntervalMs: Number(process.env.RESPONDER_INBOX_POLL_INTERVAL_MS || 250),
      workerConcurrency: Number(process.env.RESPONDER_WORKER_CONCURRENCY || state.workerConcurrency || 1)
    },
    onStateChanged: persistSnapshot,
    onPlatformConfigured: async () => {
      restartHeartbeatLoop();
      if (persistSnapshot) {
        await persistSnapshot(state);
      }
    }
  });

  server.listen(port, "0.0.0.0", () => {
    restartHeartbeatLoop();
    console.log(`[${serviceName}] listening on ${port}`);
  });

  server.on("close", () => {
    stopHeartbeat();
    if (persistence) {
      void persistence.saveSnapshot(serializeResponderState(state));
      void persistence.close();
    }
  });
}
