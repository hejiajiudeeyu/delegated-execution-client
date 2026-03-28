import "./styles.css";
import {
  renderCallConfirmationMarkup,
  renderCallerSummaryCard,
  renderCatalogItemsMarkup,
  renderRequestDetailMarkup,
  renderRequestSummaryMarkup,
  renderRequestsMarkup,
  renderRuntimeAlertsMarkup,
  renderRuntimeCardsMarkup,
  renderSetupWizardMarkup,
  renderResponderHotlinesMarkup,
  renderTransportConfigMarkup
} from "./view-model.js";

async function requestJson(baseUrl, pathname, { method = "GET", body } = {}) {
  const headers = {};
  if (state.sessionToken) {
    headers["X-Ops-Session"] = state.sessionToken;
  }
  const response = await fetch(new URL(pathname, baseUrl), {
    method,
    headers: body === undefined ? headers : { ...headers, "content-type": "application/json; charset=utf-8" },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  return {
    status: response.status,
    body: text ? JSON.parse(text) : null
  };
}

const DEFAULT_OPS_URL = "http://127.0.0.1:8079";
const storageKeys = {
  callerEmail: "rsp.ops.callerEmail"
};

const sessionKeys = {
  opsSession: "rsp.ops.session"
};

const state = {
  latestRequestId: null,
  resultPollTimer: null,
  catalogItems: [],
  requests: [],
  latestRequest: null,
  latestResult: null,
  preparedCall: null,
  selectedCandidateKey: null,
  status: null,
  runtimeService: "caller",
  editingHotlineId: null,
  transportConfig: null,
  transportTestResult: null,
  session: null,
  sessionToken: sessionStorage.getItem(sessionKeys.opsSession) || null,
  consoleLoaded: false
};

const app = document.querySelector("#app");

app.innerHTML = `
  <main class="shell">
    <section class="hero">
      <div>
        <p class="eyebrow">Unified Ops Client</p>
        <h1>Ops Console</h1>
        <p class="lede">Caller, responder, and relay are managed through one local supervisor.</p>
      </div>
      <div class="hero-note">
        <span class="pill">Caller always on</span>
        <span class="pill warm">Responder opt-in</span>
      </div>
    </section>

    <section class="card">
      <div class="section-head">
        <div>
          <p class="eyebrow">Local Session</p>
          <h2>Unlock Local Client</h2>
        </div>
        <button id="logout-session" class="ghost">Logout</button>
      </div>
      <div id="auth-state" class="stack"></div>
      <div class="grid two">
        <div>
          <label>Passphrase</label>
          <input id="session-passphrase" type="password" placeholder="At least 8 characters" />
        </div>
        <div>
          <label>New Passphrase</label>
          <input id="session-next-passphrase" type="password" placeholder="For setup or rotation" />
        </div>
      </div>
      <div class="actions">
        <button id="setup-session">Create Local Passphrase</button>
        <button id="login-session" class="ghost">Unlock</button>
        <button id="change-passphrase" class="ghost">Change Passphrase</button>
      </div>
      <pre id="auth-output" class="output compact">Local session not initialized yet.</pre>
    </section>

    <div id="console-body">

    <section class="panel grid two">
      <div class="card">
        <div class="section-head">
          <div>
            <p class="eyebrow">Setup</p>
            <h2>Local Client</h2>
          </div>
          <button id="refresh-status" class="ghost">Refresh</button>
        </div>
        <p class="meta">Supervisor: ${DEFAULT_OPS_URL}</p>
        <label>Caller Contact Email</label>
        <input id="caller-email" value="caller@local.test" />
        <div class="actions">
          <button id="setup-client">Setup Client</button>
          <button id="register-caller">Register Caller</button>
        </div>
        <div id="setup-wizard" class="stack"></div>
        <div id="caller-summary" class="stack"></div>
        <div id="request-summary" class="stack"></div>
        <pre id="status-output" class="output compact">Waiting for ops supervisor.</pre>
      </div>

      <div class="card">
        <div class="section-head">
          <div>
            <p class="eyebrow">Runtime</p>
            <h2>Caller / Responder / Relay</h2>
          </div>
          <div class="actions">
            <select id="runtime-service">
              <option value="caller">caller</option>
              <option value="responder">responder</option>
              <option value="relay">relay</option>
            </select>
            <button id="refresh-runtime" class="ghost">Logs</button>
            <button id="debug-snapshot" class="ghost">Debug Snapshot</button>
          </div>
        </div>
        <div id="runtime-cards" class="stack"></div>
        <div id="runtime-alerts" class="stack"></div>
        <pre id="debug-output" class="output compact">Debug snapshot not loaded yet.</pre>
        <pre id="runtime-output" class="output">Runtime logs not loaded yet.</pre>
      </div>
    </section>

    <section class="panel">
      <div class="card">
        <div class="section-head">
          <div>
            <p class="eyebrow">Transport</p>
            <h2>Runtime Channel</h2>
          </div>
          <div class="actions">
            <button id="save-transport">Save Transport</button>
            <button id="test-transport" class="ghost">Test Connection</button>
          </div>
        </div>
        <label>Transport Type</label>
        <select id="transport-type">
          <option value="local">local</option>
          <option value="relay_http">relay_http</option>
          <option value="email">email</option>
        </select>
        <div id="transport-relay-fields" class="stack">
          <label>Relay Base URL</label>
          <input id="transport-relay-base-url" value="http://127.0.0.1:8090" />
        </div>
        <div id="transport-email-fields" class="stack">
          <label>Email Provider</label>
          <select id="transport-email-provider">
            <option value="emailengine">EmailEngine</option>
            <option value="gmail">Gmail API</option>
          </select>
          <div class="grid three">
            <div>
              <label>Sender Email</label>
              <input id="transport-email-sender" value="" />
            </div>
            <div>
              <label>Receiver Mailbox</label>
              <input id="transport-email-receiver" value="" />
            </div>
            <div>
              <label>Poll Interval (ms)</label>
              <input id="transport-email-poll-interval" value="5000" />
            </div>
          </div>
          <div id="transport-emailengine-fields" class="stack">
            <label>EmailEngine Base URL</label>
            <input id="transport-emailengine-base-url" value="" />
            <label>EmailEngine Account</label>
            <input id="transport-emailengine-account" value="" />
            <label>EmailEngine Access Token</label>
            <input id="transport-emailengine-access-token" type="password" value="" placeholder="Leave blank to keep current token" />
            <p id="transport-emailengine-secret-state" class="meta">Not configured yet.</p>
          </div>
          <div id="transport-gmail-fields" class="stack">
            <label>Google Client ID</label>
            <input id="transport-gmail-client-id" value="" />
            <label>Google User Email</label>
            <input id="transport-gmail-user" value="" />
            <label>Google Client Secret</label>
            <input id="transport-gmail-client-secret" type="password" value="" placeholder="Leave blank to keep current secret" />
            <p id="transport-gmail-client-secret-state" class="meta">Not configured yet.</p>
            <label>Google Refresh Token</label>
            <input id="transport-gmail-refresh-token" type="password" value="" placeholder="Leave blank to keep current token" />
            <p id="transport-gmail-refresh-token-state" class="meta">Not configured yet.</p>
          </div>
        </div>
        <div id="transport-summary" class="stack"></div>
        <pre id="transport-output" class="output compact">Transport config not loaded yet.</pre>
      </div>
    </section>

    <section class="panel grid two">
      <div class="card">
        <div class="section-head">
          <div>
            <p class="eyebrow">Responder</p>
            <h2>Hotlines + Review</h2>
          </div>
        </div>
        <div class="grid three">
          <div>
            <label>Responder ID</label>
            <input id="responder-id" value="responder_local" />
          </div>
          <div>
            <label>Hotline ID</label>
            <input id="hotline-id" value="local.hotline.v1" />
          </div>
          <div>
            <label>Display Name</label>
            <input id="display-name" value="Local Responder Runtime" />
          </div>
        </div>
        <div class="grid three">
          <div>
            <label>Task Types</label>
            <input id="task-types" value="text_classify" />
          </div>
          <div>
            <label>Capabilities</label>
            <input id="capabilities" value="text.classify" />
          </div>
          <div>
            <label>Tags</label>
            <input id="tags" value="local,ops" />
          </div>
        </div>
        <div class="grid two">
          <div>
            <label>Project Path (Optional)</label>
            <input id="project-path" value="" placeholder="/absolute/path/to/project" />
          </div>
          <div>
            <label>Project Summary (Optional)</label>
            <input id="project-description" value="" placeholder="What this project does for remote callers" />
          </div>
        </div>
        <label>Adapter Type</label>
        <select id="adapter-type">
          <option value="process">process</option>
          <option value="http">http</option>
        </select>
        <label>Command / URL</label>
        <input id="adapter-value" value="node worker.js" />
        <p id="hotline-form-mode" class="meta">Creating a new local hotline.</p>
        <div class="actions">
          <button id="add-example-hotline" class="ghost">Add Example Hotline</button>
          <button id="add-hotline">Add Hotline</button>
          <button id="reset-hotline-form" class="ghost">Clear Form</button>
          <button id="submit-review" class="ghost">Submit For Review</button>
          <button id="enable-responder">Enable Responder</button>
        </div>
        <pre id="responder-output" class="output compact">Responder is not enabled yet.</pre>
        <div id="responder-hotlines" class="stack"></div>
      </div>

      <div class="card">
        <div class="section-head">
          <div>
            <p class="eyebrow">Catalog</p>
            <h2>Marketplace</h2>
          </div>
          <button id="refresh-catalog" class="ghost">Refresh Catalog</button>
        </div>
        <label>Catalog / Request Filter</label>
        <input id="caller-filter" placeholder="responder, hotline, status..." />
        <div id="catalog-list" class="stack"></div>
      </div>
    </section>

    <section class="panel grid two">
      <div class="card">
        <div class="section-head">
          <div>
            <p class="eyebrow">Confirmation</p>
            <h2>Call Confirmation</h2>
          </div>
          <button id="refresh-requests" class="ghost">Requests</button>
        </div>
        <div class="grid three">
          <div>
            <label>Responder ID</label>
            <input id="request-responder-id" value="responder_foxlab" />
          </div>
          <div>
            <label>Hotline ID</label>
            <input id="request-hotline-id" value="foxlab.text.classifier.v1" />
          </div>
          <div>
            <label>Task Type</label>
            <input id="request-task-type" value="text_classify" />
          </div>
        </div>
        <label>Prompt / Input Text</label>
        <textarea id="request-text">Classify this text into a suitable category.</textarea>
        <label class="checkbox-row">
          <input id="remember-task-type" type="checkbox" />
          <span>Remember this hotline for the current task type after confirmation.</span>
        </label>
        <div class="actions">
          <button id="run-example-request" class="ghost">Run Example</button>
          <button id="load-first-catalog" class="ghost">Use First Catalog Item</button>
          <button id="prepare-call">Prepare Candidates</button>
          <button id="confirm-call" class="ghost">Confirm and Call</button>
          <button id="cancel-prepared-call" class="ghost">Cancel</button>
          <button id="poll-result" class="ghost">Fetch Result</button>
        </div>
        <div id="call-confirmation" class="stack"></div>
        <div id="requests-list" class="stack"></div>
        <pre id="request-output" class="output compact">No call prepared yet.</pre>
      </div>

      <div class="card">
        <div class="section-head">
          <div>
            <p class="eyebrow">Request Detail</p>
            <h2>Latest Selected Request</h2>
          </div>
        </div>
        <div id="request-detail" class="stack"><div class="empty">No request selected yet.</div></div>
      </div>
    </section>
    </div>
  </main>
`;

const callerEmailInput = document.querySelector("#caller-email");
const consoleBody = document.querySelector("#console-body");
const authState = document.querySelector("#auth-state");
const authOutput = document.querySelector("#auth-output");
const sessionPassphraseInput = document.querySelector("#session-passphrase");
const sessionNextPassphraseInput = document.querySelector("#session-next-passphrase");
const callerFilterInput = document.querySelector("#caller-filter");
const runtimeServiceInput = document.querySelector("#runtime-service");
const statusOutput = document.querySelector("#status-output");
const runtimeCards = document.querySelector("#runtime-cards");
const runtimeAlerts = document.querySelector("#runtime-alerts");
const debugOutput = document.querySelector("#debug-output");
const runtimeOutput = document.querySelector("#runtime-output");
const transportSummary = document.querySelector("#transport-summary");
const transportOutput = document.querySelector("#transport-output");
const setupWizard = document.querySelector("#setup-wizard");
const callerSummary = document.querySelector("#caller-summary");
const requestSummary = document.querySelector("#request-summary");
const responderOutput = document.querySelector("#responder-output");
const responderHotlines = document.querySelector("#responder-hotlines");
const hotlineFormMode = document.querySelector("#hotline-form-mode");
const catalogList = document.querySelector("#catalog-list");
const callConfirmation = document.querySelector("#call-confirmation");
const requestsList = document.querySelector("#requests-list");
const requestDetail = document.querySelector("#request-detail");
const requestOutput = document.querySelector("#request-output");
const rememberTaskTypeInput = document.querySelector("#remember-task-type");
const responderIdInput = document.querySelector("#responder-id");
const hotlineIdInput = document.querySelector("#hotline-id");
const displayNameInput = document.querySelector("#display-name");
const taskTypesInput = document.querySelector("#task-types");
const capabilitiesInput = document.querySelector("#capabilities");
const tagsInput = document.querySelector("#tags");
const adapterTypeInput = document.querySelector("#adapter-type");
const adapterValueInput = document.querySelector("#adapter-value");
const projectPathInput = document.querySelector("#project-path");
const projectDescriptionInput = document.querySelector("#project-description");
const addHotlineButton = document.querySelector("#add-hotline");
const addExampleHotlineButton = document.querySelector("#add-example-hotline");
const transportTypeInput = document.querySelector("#transport-type");
const transportRelayFields = document.querySelector("#transport-relay-fields");
const transportRelayBaseUrlInput = document.querySelector("#transport-relay-base-url");
const transportEmailFields = document.querySelector("#transport-email-fields");
const transportEmailProviderInput = document.querySelector("#transport-email-provider");
const transportEmailSenderInput = document.querySelector("#transport-email-sender");
const transportEmailReceiverInput = document.querySelector("#transport-email-receiver");
const transportEmailPollIntervalInput = document.querySelector("#transport-email-poll-interval");
const transportEmailEngineFields = document.querySelector("#transport-emailengine-fields");
const transportEmailEngineBaseUrlInput = document.querySelector("#transport-emailengine-base-url");
const transportEmailEngineAccountInput = document.querySelector("#transport-emailengine-account");
const transportEmailEngineAccessTokenInput = document.querySelector("#transport-emailengine-access-token");
const transportEmailEngineSecretState = document.querySelector("#transport-emailengine-secret-state");
const transportGmailFields = document.querySelector("#transport-gmail-fields");
const transportGmailClientIdInput = document.querySelector("#transport-gmail-client-id");
const transportGmailUserInput = document.querySelector("#transport-gmail-user");
const transportGmailClientSecretInput = document.querySelector("#transport-gmail-client-secret");
const transportGmailClientSecretState = document.querySelector("#transport-gmail-client-secret-state");
const transportGmailRefreshTokenInput = document.querySelector("#transport-gmail-refresh-token");
const transportGmailRefreshTokenState = document.querySelector("#transport-gmail-refresh-token-state");

function opsUrl() {
  return DEFAULT_OPS_URL;
}

function setSessionToken(token) {
  state.sessionToken = token || null;
  if (token) {
    sessionStorage.setItem(sessionKeys.opsSession, token);
    return;
  }
  sessionStorage.removeItem(sessionKeys.opsSession);
}

function savePrefs() {
  localStorage.setItem(storageKeys.callerEmail, callerEmailInput.value);
}

function loadPrefs() {
  callerEmailInput.value = localStorage.getItem(storageKeys.callerEmail) || callerEmailInput.value;
}

function splitList(value) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function applyCallerFilter(items) {
  const term = callerFilterInput.value.trim().toLowerCase();
  if (!term) {
    return items;
  }
  return items.filter((item) => JSON.stringify(item).toLowerCase().includes(term));
}

function renderCallerSummary() {
  const status = state.status;
  setupWizard.innerHTML = renderSetupWizardMarkup(status);
  callerSummary.innerHTML = renderCallerSummaryCard({
    health: status?.runtime?.caller?.health || { body: { ok: false } },
    root: {
      body: {
        service: "ops-supervisor",
        local_defaults: {
          caller_contact_email: status?.config?.caller?.contact_email || null,
          platform_api_key_configured: Boolean(status?.config?.caller?.api_key_configured)
        },
        runtime: status?.runtime || null
      }
    }
  });
  requestSummary.innerHTML = renderRequestSummaryMarkup(status?.requests || null);
}

function renderAuthState() {
  const session = state.session || {};
  if (session.setup_required) {
    authState.innerHTML = `
      <article class="item-card">
        <div class="item-head">
          <div>
            <strong>Create Local Passphrase</strong>
            <p>Initialize the encrypted local secret store before using the console.</p>
          </div>
          <span class="status disabled">setup required</span>
        </div>
        ${
          session.legacy_secret_source_present
            ? `<p class="meta">Legacy secrets detected: ${session.legacy_secret_keys.join(", ")}. Setup will migrate and scrub them.</p>`
            : `<p class="meta">No encrypted secret store found yet.</p>`
        }
      </article>
    `;
    consoleBody.style.display = "none";
    return;
  }
  if (!session.authenticated) {
    authState.innerHTML = `
      <article class="item-card">
        <div class="item-head">
          <div>
            <strong>Local Client Locked</strong>
            <p>Unlock the local secret store to access runtime controls and credentials.</p>
          </div>
          <span class="status disabled">locked</span>
        </div>
        ${
          session.legacy_secret_source_present
            ? `<p class="meta">Legacy secrets still present: ${session.legacy_secret_keys.join(", ")}</p>`
            : ""
        }
      </article>
    `;
    consoleBody.style.display = "none";
    return;
  }
  authState.innerHTML = `
    <article class="item-card">
      <div class="item-head">
        <div>
          <strong>Local Client Unlocked</strong>
          <p>Secrets are held in memory by the local supervisor only.</p>
        </div>
        <span class="status healthy">authenticated</span>
      </div>
      <p class="meta">Session expires at: ${session.expires_at || "n/a"}</p>
      ${
        session.legacy_secret_source_present
          ? `<p class="meta">Legacy secret source still present: ${session.legacy_secret_keys.join(", ")}</p>`
          : ""
      }
    </article>
  `;
  consoleBody.style.display = "";
}

function toggleVisibility(element, visible) {
  element.style.display = visible ? "" : "none";
}

function applyTransportFormVisibility() {
  const type = transportTypeInput.value;
  const provider = transportEmailProviderInput.value;
  toggleVisibility(transportRelayFields, type === "relay_http");
  toggleVisibility(transportEmailFields, type === "email");
  toggleVisibility(transportEmailEngineFields, type === "email" && provider === "emailengine");
  toggleVisibility(transportGmailFields, type === "email" && provider === "gmail");
}

function setSecretState(label, configured) {
  label.textContent = configured ? "Configured. Leave blank to keep current value." : "Not configured yet.";
}

function setTransportForm(transport = null) {
  const current = transport || {
    type: "local",
    relay_http: { base_url: "http://127.0.0.1:8090" },
    email: {
      provider: "emailengine",
      sender: "",
      receiver: "",
      poll_interval_ms: 5000,
      emailengine: { base_url: "", account: "", access_token_configured: false },
      gmail: { client_id: "", user: "", client_secret_configured: false, refresh_token_configured: false }
    }
  };
  transportTypeInput.value = current.type || "local";
  transportRelayBaseUrlInput.value = current.relay_http?.base_url || "http://127.0.0.1:8090";
  transportEmailProviderInput.value = current.email?.provider || "emailengine";
  transportEmailSenderInput.value = current.email?.sender || "";
  transportEmailReceiverInput.value = current.email?.receiver || "";
  transportEmailPollIntervalInput.value = String(current.email?.poll_interval_ms || 5000);
  transportEmailEngineBaseUrlInput.value = current.email?.emailengine?.base_url || "";
  transportEmailEngineAccountInput.value = current.email?.emailengine?.account || "";
  transportEmailEngineAccessTokenInput.value = "";
  setSecretState(transportEmailEngineSecretState, current.email?.emailengine?.access_token_configured === true);
  transportGmailClientIdInput.value = current.email?.gmail?.client_id || "";
  transportGmailUserInput.value = current.email?.gmail?.user || "";
  transportGmailClientSecretInput.value = "";
  transportGmailRefreshTokenInput.value = "";
  setSecretState(transportGmailClientSecretState, current.email?.gmail?.client_secret_configured === true);
  setSecretState(transportGmailRefreshTokenState, current.email?.gmail?.refresh_token_configured === true);
  applyTransportFormVisibility();
}

function renderTransportState() {
  transportSummary.innerHTML = renderTransportConfigMarkup(state.transportConfig, state.transportTestResult);
}

function buildTransportPayload() {
  return {
    type: transportTypeInput.value,
    relay_http: {
      base_url: transportRelayBaseUrlInput.value.trim()
    },
    email: {
      provider: transportEmailProviderInput.value,
      sender: transportEmailSenderInput.value.trim(),
      receiver: transportEmailReceiverInput.value.trim(),
      poll_interval_ms: Number(transportEmailPollIntervalInput.value || "5000"),
      emailengine: {
        base_url: transportEmailEngineBaseUrlInput.value.trim(),
        account: transportEmailEngineAccountInput.value.trim(),
        access_token: transportEmailEngineAccessTokenInput.value.trim()
      },
      gmail: {
        client_id: transportGmailClientIdInput.value.trim(),
        user: transportGmailUserInput.value.trim(),
        client_secret: transportGmailClientSecretInput.value.trim(),
        refresh_token: transportGmailRefreshTokenInput.value.trim()
      }
    }
  };
}

function setHotlineForm(definition = null) {
  if (!definition) {
    state.editingHotlineId = null;
    hotlineIdInput.value = "local.summary.v1";
    displayNameInput.value = "Local Summary Example";
    taskTypesInput.value = "text_summarize";
    capabilitiesInput.value = "text.summarize";
    tagsInput.value = "local,example,demo";
    adapterTypeInput.value = "process";
    adapterValueInput.value = "node worker.js";
    projectPathInput.value = "";
    projectDescriptionInput.value = "";
    hotlineFormMode.textContent = "Creating a new local hotline.";
    addHotlineButton.textContent = "Add Hotline";
    return;
  }
  state.editingHotlineId = definition.hotline_id;
  hotlineIdInput.value = definition.hotline_id || "";
  displayNameInput.value = definition.display_name || definition.hotline_id || "";
  taskTypesInput.value = (definition.task_types || []).join(", ");
  capabilitiesInput.value = (definition.capabilities || []).join(", ");
  tagsInput.value = (definition.tags || []).join(", ");
  adapterTypeInput.value = definition.adapter_type || "process";
  adapterValueInput.value = definition.adapter?.url || definition.adapter?.cmd || "";
  projectPathInput.value = definition.metadata?.project?.path || definition.adapter?.cwd || "";
  projectDescriptionInput.value = definition.metadata?.project?.description || "";
  hotlineFormMode.textContent = `Editing ${definition.hotline_id}. Save will update the local configuration.`;
  addHotlineButton.textContent = "Save Hotline";
}

function renderCatalogItems(items) {
  catalogList.innerHTML = renderCatalogItemsMarkup(items);
}

function candidateKey(item) {
  if (!item) {
    return null;
  }
  return `${item.responder_id || ""}:${item.hotline_id || ""}`;
}

function getSelectedCandidate() {
  const candidates = state.preparedCall?.candidate_hotlines || [];
  return (
    candidates.find((item) => candidateKey(item) === state.selectedCandidateKey) ||
    state.preparedCall?.selected_hotline ||
    null
  );
}

function renderPreparedCall() {
  callConfirmation.innerHTML = renderCallConfirmationMarkup(state.preparedCall, state.selectedCandidateKey);
}

function clearPreparedCall() {
  state.preparedCall = null;
  state.selectedCandidateKey = null;
  rememberTaskTypeInput.checked = false;
  renderPreparedCall();
}

function renderRequests(items) {
  requestsList.innerHTML = renderRequestsMarkup(items);
}

function renderSelectedRequest() {
  requestDetail.innerHTML = renderRequestDetailMarkup({
    request: state.latestRequest,
    result: state.latestResult
  });
}

function renderResponderState() {
  const responder = state.status?.config?.responder || { hotlines: [] };
  responderOutput.textContent = JSON.stringify(
    {
      enabled: responder.enabled,
      responder_id: responder.responder_id,
      review_summary: state.status?.responder?.review_summary || {},
      pending_review_count: state.status?.responder?.pending_review_count || 0
    },
    null,
    2
  );
  responderHotlines.innerHTML = renderResponderHotlinesMarkup(responder.hotlines || []);
}

async function refreshRuntimeLogs() {
  if (!state.session?.authenticated) {
    runtimeOutput.textContent = "Unlock the local client to load runtime logs.";
    return;
  }
  runtimeOutput.textContent = "Loading runtime logs...";
  try {
    const response = await requestJson(opsUrl(), `/runtime/logs?service=${encodeURIComponent(state.runtimeService)}`);
    runtimeOutput.textContent = (response.body?.logs || []).join("").trim() || "No runtime logs yet.";
  } catch (error) {
    runtimeOutput.textContent = `Runtime logs failed: ${error instanceof Error ? error.message : "unknown_error"}`;
  }
}

async function refreshRuntimeAlerts() {
  if (!state.session?.authenticated) {
    runtimeAlerts.innerHTML = `<div class="empty">Unlock the local client to load runtime alerts.</div>`;
    return;
  }
  runtimeAlerts.innerHTML = `<div class="empty">Loading ${state.runtimeService} alerts...</div>`;
  try {
    const response = await requestJson(opsUrl(), `/runtime/alerts?service=${encodeURIComponent(state.runtimeService)}`);
    runtimeAlerts.innerHTML = renderRuntimeAlertsMarkup(state.runtimeService, response.body?.alerts || []);
  } catch (error) {
    runtimeAlerts.innerHTML = `<div class="empty">Runtime alerts failed: ${
      error instanceof Error ? error.message : "unknown_error"
    }</div>`;
  }
}

async function refreshDebugSnapshot() {
  if (!state.session?.authenticated) {
    debugOutput.textContent = "Unlock the local client to load debug snapshots.";
    return;
  }
  debugOutput.textContent = "Loading debug snapshot...";
  try {
    const response = await requestJson(opsUrl(), "/debug/snapshot");
    debugOutput.textContent = JSON.stringify(
      {
        generated_at: response.body?.generated_at || null,
        responder: response.body?.status?.responder || null,
        requests: response.body?.status?.requests || null,
        recent_events: response.body?.recent_events || [],
        debug: response.body?.status?.debug || null
      },
      null,
      2
    );
  } catch (error) {
    debugOutput.textContent = `Debug snapshot failed: ${error instanceof Error ? error.message : "unknown_error"}`;
  }
}

async function refreshSessionState() {
  try {
    const response = await requestJson(opsUrl(), "/auth/session");
    state.session = response.body?.session || null;
    renderAuthState();
    if (state.session?.authenticated && !state.consoleLoaded) {
      state.consoleLoaded = true;
      await refreshAuthenticatedData();
    }
    if (!state.session?.authenticated) {
      state.consoleLoaded = false;
    }
  } catch (error) {
    authOutput.textContent = `Session status failed: ${error instanceof Error ? error.message : "unknown_error"}`;
  }
}

async function refreshAuthenticatedData() {
  await refreshStatus();
  await refreshTransportConfig();
  await refreshDebugSnapshot();
  await refreshCatalog();
  await refreshRequests();
}

async function setupSession() {
  authOutput.textContent = "Creating encrypted local secret store...";
  try {
    const passphrase = sessionNextPassphraseInput.value.trim() || sessionPassphraseInput.value.trim();
    const response = await requestJson(opsUrl(), "/auth/session/setup", {
      method: "POST",
      body: { passphrase }
    });
    if (response.status >= 400) {
      authOutput.textContent = JSON.stringify(response, null, 2);
      return;
    }
    setSessionToken(response.body?.token || null);
    authOutput.textContent = JSON.stringify(response, null, 2);
    sessionPassphraseInput.value = "";
    sessionNextPassphraseInput.value = "";
    await refreshSessionState();
  } catch (error) {
    authOutput.textContent = `Session setup failed: ${error instanceof Error ? error.message : "unknown_error"}`;
  }
}

async function loginSession() {
  authOutput.textContent = "Unlocking local client...";
  try {
    const response = await requestJson(opsUrl(), "/auth/session/login", {
      method: "POST",
      body: { passphrase: sessionPassphraseInput.value.trim() }
    });
    if (response.status >= 400) {
      authOutput.textContent = JSON.stringify(response, null, 2);
      return;
    }
    setSessionToken(response.body?.token || null);
    authOutput.textContent = JSON.stringify(response, null, 2);
    sessionPassphraseInput.value = "";
    sessionNextPassphraseInput.value = "";
    await refreshSessionState();
  } catch (error) {
    authOutput.textContent = `Session unlock failed: ${error instanceof Error ? error.message : "unknown_error"}`;
  }
}

async function logoutSession() {
  authOutput.textContent = "Logging out local session...";
  try {
    const response = await requestJson(opsUrl(), "/auth/session/logout", {
      method: "POST",
      body: {}
    });
    setSessionToken(null);
    authOutput.textContent = JSON.stringify(response, null, 2);
    state.session = response.body?.session || null;
    renderAuthState();
  } catch (error) {
    authOutput.textContent = `Session logout failed: ${error instanceof Error ? error.message : "unknown_error"}`;
  }
}

async function changePassphrase() {
  authOutput.textContent = "Rotating local passphrase...";
  try {
    const response = await requestJson(opsUrl(), "/auth/session/change-passphrase", {
      method: "POST",
      body: {
        current_passphrase: sessionPassphraseInput.value.trim(),
        next_passphrase: sessionNextPassphraseInput.value.trim()
      }
    });
    authOutput.textContent = JSON.stringify(response, null, 2);
    if (response.status < 400) {
      sessionPassphraseInput.value = "";
      sessionNextPassphraseInput.value = "";
      await refreshSessionState();
    }
  } catch (error) {
    authOutput.textContent = `Passphrase change failed: ${error instanceof Error ? error.message : "unknown_error"}`;
  }
}

async function refreshStatus() {
  if (!state.session?.authenticated) {
    statusOutput.textContent = "Unlock the local client to load runtime status.";
    return;
  }
  statusOutput.textContent = "Loading ops supervisor...";
  try {
    const status = await requestJson(opsUrl(), "/status");
    state.status = status.body;
    renderCallerSummary();
    runtimeCards.innerHTML = renderRuntimeCardsMarkup(status.body.runtime);
    renderResponderState();
    state.transportConfig = status.body?.config?.runtime?.transport || state.transportConfig;
    if (state.transportConfig) {
      setTransportForm(state.transportConfig);
      renderTransportState();
    }
    statusOutput.textContent = JSON.stringify(status.body, null, 2);
    await refreshRuntimeAlerts();
    await refreshRuntimeLogs();
  } catch (error) {
    statusOutput.textContent = `Status refresh failed: ${error instanceof Error ? error.message : "unknown_error"}`;
  }
}

async function refreshTransportConfig() {
  if (!state.session?.authenticated) {
    transportOutput.textContent = "Unlock the local client to load transport configuration.";
    return;
  }
  transportOutput.textContent = "Loading transport config...";
  try {
    const response = await requestJson(opsUrl(), "/runtime/transport");
    state.transportConfig = response.body;
    setTransportForm(state.transportConfig);
    renderTransportState();
    transportOutput.textContent = JSON.stringify(response.body, null, 2);
  } catch (error) {
    transportOutput.textContent = `Transport load failed: ${error instanceof Error ? error.message : "unknown_error"}`;
  }
}

async function saveTransportConfig() {
  if (!state.session?.authenticated) {
    transportOutput.textContent = "Unlock the local client before saving transport configuration.";
    return;
  }
  transportOutput.textContent = "Saving transport config...";
  try {
    const response = await requestJson(opsUrl(), "/runtime/transport", {
      method: "PUT",
      body: buildTransportPayload()
    });
    state.transportConfig = response.body;
    setTransportForm(state.transportConfig);
    renderTransportState();
    transportOutput.textContent = JSON.stringify(response, null, 2);
    await refreshStatus();
  } catch (error) {
    transportOutput.textContent = `Transport save failed: ${error instanceof Error ? error.message : "unknown_error"}`;
  }
}

async function testTransportConfig() {
  if (!state.session?.authenticated) {
    transportOutput.textContent = "Unlock the local client before testing transport configuration.";
    return;
  }
  transportOutput.textContent = "Testing transport connection...";
  try {
    const response = await requestJson(opsUrl(), "/runtime/transport/test", {
      method: "POST",
      body: {}
    });
    state.transportTestResult = response.body;
    renderTransportState();
    transportOutput.textContent = JSON.stringify(response, null, 2);
  } catch (error) {
    transportOutput.textContent = `Transport test failed: ${error instanceof Error ? error.message : "unknown_error"}`;
  }
}

async function setupClient() {
  if (!state.session?.authenticated) {
    statusOutput.textContent = "Unlock the local client before running setup.";
    return;
  }
  statusOutput.textContent = "Initializing local client...";
  try {
    const response = await requestJson(opsUrl(), "/setup", { method: "POST", body: {} });
    statusOutput.textContent = JSON.stringify(response, null, 2);
    await refreshStatus();
  } catch (error) {
    statusOutput.textContent = `Setup failed: ${error instanceof Error ? error.message : "unknown_error"}`;
  }
}

async function registerCaller() {
  if (!state.session?.authenticated) {
    statusOutput.textContent = "Unlock the local client before registering the caller.";
    return;
  }
  statusOutput.textContent = "Registering caller...";
  try {
    const response = await requestJson(opsUrl(), "/auth/register-caller", {
      method: "POST",
      body: { contact_email: callerEmailInput.value.trim() }
    });
    statusOutput.textContent = JSON.stringify(response, null, 2);
    await refreshStatus();
  } catch (error) {
    statusOutput.textContent = `Caller register failed: ${error instanceof Error ? error.message : "unknown_error"}`;
  }
}

async function refreshCatalog() {
  if (!state.session?.authenticated) {
    catalogList.innerHTML = `<div class="empty">Unlock the local client to load catalog items.</div>`;
    return { body: { items: [] } };
  }
  const catalog = await requestJson(opsUrl(), "/catalog/hotlines");
  state.catalogItems = catalog.body?.items || [];
  renderCatalogItems(applyCallerFilter(state.catalogItems));
  return catalog;
}

async function refreshRequests() {
  if (!state.session?.authenticated) {
    requestsList.innerHTML = `<div class="empty">Unlock the local client to load requests.</div>`;
    return { body: { items: [] } };
  }
  const requests = await requestJson(opsUrl(), "/requests");
  state.requests = requests.body?.items || [];
  renderRequests(applyCallerFilter(state.requests));
  return requests;
}

async function addHotline() {
  if (!state.session?.authenticated) {
    responderOutput.textContent = "Unlock the local client before editing responder hotlines.";
    return;
  }
  responderOutput.textContent = state.editingHotlineId ? "Saving local hotline..." : "Adding local hotline...";
  const adapterType = adapterTypeInput.value;
  const adapterValue = adapterValueInput.value.trim();
  const projectPath = projectPathInput.value.trim();
  const projectDescription = projectDescriptionInput.value.trim();
  const adapter =
    adapterType === "http"
      ? { url: adapterValue, method: "POST" }
      : { cmd: adapterValue, cwd: projectPath || undefined };
  try {
    const response = await requestJson(opsUrl(), "/responder/hotlines", {
      method: "POST",
      body: {
        hotline_id: hotlineIdInput.value.trim(),
        display_name: displayNameInput.value.trim(),
        task_types: splitList(taskTypesInput.value),
        capabilities: splitList(capabilitiesInput.value),
        tags: splitList(tagsInput.value),
        adapter_type: adapterType,
        adapter,
        metadata:
          projectPath || projectDescription
            ? {
                project: {
                  path: projectPath || null,
                  description: projectDescription || null,
                  mount_kind: "local_project"
                }
              }
            : null
      }
    });
    responderOutput.textContent = JSON.stringify(response, null, 2);
    await refreshStatus();
    setHotlineForm();
  } catch (error) {
    responderOutput.textContent = `Add hotline failed: ${error instanceof Error ? error.message : "unknown_error"}`;
  }
}

async function addExampleHotline() {
  if (!state.session?.authenticated) {
    responderOutput.textContent = "Unlock the local client before adding the example hotline.";
    return;
  }
  responderOutput.textContent = "Installing official example hotline...";
  try {
    const response = await requestJson(opsUrl(), "/responder/hotlines/example", {
      method: "POST",
      body: {}
    });
    responderOutput.textContent = JSON.stringify(response, null, 2);
    await refreshStatus();
    const example = state.status?.config?.responder?.hotlines?.find((item) => item.hotline_id === "local.summary.v1");
    if (example) {
      setHotlineForm(example);
    }
  } catch (error) {
    responderOutput.textContent = `Add example hotline failed: ${error instanceof Error ? error.message : "unknown_error"}`;
  }
}

async function toggleHotline(hotlineId, enabled) {
  if (!state.session?.authenticated) {
    responderOutput.textContent = "Unlock the local client before editing responder hotlines.";
    return;
  }
  responderOutput.textContent = `${enabled ? "Enabling" : "Disabling"} local hotline...`;
  try {
    const response = await requestJson(
      opsUrl(),
      `/responder/hotlines/${encodeURIComponent(hotlineId)}/${enabled ? "enable" : "disable"}`,
      {
        method: "POST",
        body: {}
      }
    );
    responderOutput.textContent = JSON.stringify(response, null, 2);
    await refreshStatus();
  } catch (error) {
    responderOutput.textContent = `${enabled ? "Enable" : "Disable"} hotline failed: ${
      error instanceof Error ? error.message : "unknown_error"
    }`;
  }
}

async function removeHotline(hotlineId) {
  if (!state.session?.authenticated) {
    responderOutput.textContent = "Unlock the local client before editing responder hotlines.";
    return;
  }
  responderOutput.textContent = "Removing local hotline...";
  try {
    const response = await requestJson(opsUrl(), `/responder/hotlines/${encodeURIComponent(hotlineId)}`, {
      method: "DELETE"
    });
    responderOutput.textContent = JSON.stringify(response, null, 2);
    await refreshStatus();
    if (state.editingHotlineId === hotlineId) {
      setHotlineForm();
    }
  } catch (error) {
    responderOutput.textContent = `Remove hotline failed: ${error instanceof Error ? error.message : "unknown_error"}`;
  }
}

async function submitReview() {
  if (!state.session?.authenticated) {
    responderOutput.textContent = "Unlock the local client before submitting review.";
    return;
  }
  responderOutput.textContent = "Submitting local hotlines for review...";
  try {
    const response = await requestJson(opsUrl(), "/responder/submit-review", {
      method: "POST",
      body: {
        responder_id: document.querySelector("#responder-id").value.trim(),
        display_name: document.querySelector("#display-name").value.trim()
      }
    });
    responderOutput.textContent = JSON.stringify(response, null, 2);
    await refreshStatus();
  } catch (error) {
    responderOutput.textContent = `Submit review failed: ${error instanceof Error ? error.message : "unknown_error"}`;
  }
}

async function enableResponder() {
  if (!state.session?.authenticated) {
    responderOutput.textContent = "Unlock the local client before enabling the responder.";
    return;
  }
  responderOutput.textContent = "Enabling responder...";
  try {
    const response = await requestJson(opsUrl(), "/responder/enable", {
      method: "POST",
      body: {
        responder_id: document.querySelector("#responder-id").value.trim(),
        display_name: document.querySelector("#display-name").value.trim()
      }
    });
    responderOutput.textContent = JSON.stringify(response, null, 2);
    await refreshStatus();
  } catch (error) {
    responderOutput.textContent = `Enable responder failed: ${error instanceof Error ? error.message : "unknown_error"}`;
  }
}

async function loadFirstCatalogItem() {
  const catalog = await refreshCatalog();
  const item = catalog.body?.items?.[0];
  if (!item) {
    return;
  }
  document.querySelector("#request-responder-id").value = item.responder_id || "";
  document.querySelector("#request-hotline-id").value = item.hotline_id || "";
  document.querySelector("#request-task-type").value = item.task_types?.[0] || "text_classify";
  clearPreparedCall();
}

async function prepareCall() {
  if (!state.session?.authenticated) {
    requestOutput.textContent = "Unlock the local client before preparing calls.";
    return;
  }
  requestOutput.textContent = "Preparing hotline candidates...";
  try {
    const payloadText = document.querySelector("#request-text").value.trim();
    const response = await requestJson(opsUrl(), "/calls/prepare", {
      method: "POST",
      body: {
        responder_id: document.querySelector("#request-responder-id").value.trim(),
        hotline_id: document.querySelector("#request-hotline-id").value.trim(),
        task_type: document.querySelector("#request-task-type").value.trim(),
        text: payloadText
      }
    });
    requestOutput.textContent = JSON.stringify(response, null, 2);
    if (response.status === 200 && response.body?.selected_hotline) {
      state.preparedCall = response.body;
      state.selectedCandidateKey = candidateKey(response.body.selected_hotline);
      rememberTaskTypeInput.checked = Boolean(response.body.remembered_preference);
      renderPreparedCall();
    }
  } catch (error) {
    requestOutput.textContent = `Prepare failed: ${error instanceof Error ? error.message : "unknown_error"}`;
  }
}

async function confirmCall() {
  if (!state.session?.authenticated) {
    requestOutput.textContent = "Unlock the local client before confirming calls.";
    return;
  }
  const selected = getSelectedCandidate();
  if (!selected) {
    requestOutput.textContent = "Prepare a call before confirming it.";
    return;
  }
  requestOutput.textContent = "Confirming selected hotline and dispatching call...";
  try {
    const payloadText = document.querySelector("#request-text").value.trim();
    const response = await requestJson(opsUrl(), "/calls/confirm", {
      method: "POST",
      body: {
        responder_id: selected.responder_id,
        hotline_id: selected.hotline_id,
        task_type: document.querySelector("#request-task-type").value.trim(),
        text: payloadText,
        input: { text: payloadText },
        payload: { text: payloadText },
        output_schema: {
          type: "object",
          properties: {
            summary: { type: "string" }
          }
        },
        remember_for_task_type: rememberTaskTypeInput.checked
      }
    });
    requestOutput.textContent = JSON.stringify(response, null, 2);
    if (response.status === 201 && response.body?.request_id) {
      state.latestRequestId = response.body.request_id;
      state.latestRequest = response.body.request || { request_id: response.body.request_id, status: "SENT" };
      state.latestResult = null;
      renderSelectedRequest();
      startResultPolling();
      clearPreparedCall();
      await refreshRequests();
    }
  } catch (error) {
    requestOutput.textContent = `Confirm failed: ${error instanceof Error ? error.message : "unknown_error"}`;
  }
}

async function runExampleRequest() {
  if (!state.session?.authenticated) {
    requestOutput.textContent = "Unlock the local client before running the local example.";
    return;
  }
  clearPreparedCall();
  requestOutput.textContent = "Dispatching local demo self-call...";
  try {
    const response = await requestJson(opsUrl(), "/requests/example", {
      method: "POST",
      body: {
        text: document.querySelector("#request-text").value.trim() || "Summarize this local example request."
      }
    });
    requestOutput.textContent = JSON.stringify(response, null, 2);
    if (response.status === 201 && response.body?.request_id) {
      state.latestRequestId = response.body.request_id;
      state.latestRequest = response.body.request || { request_id: response.body.request_id, status: "SENT" };
      state.latestResult = null;
      renderSelectedRequest();
      startResultPolling();
      await refreshRequests();
      return;
    }
    if (response.body?.stage) {
      requestOutput.textContent = JSON.stringify(response.body, null, 2);
    }
  } catch (error) {
    requestOutput.textContent = `Run example failed: ${error instanceof Error ? error.message : "unknown_error"}`;
  }
}

async function fetchResult() {
  if (!state.session?.authenticated) {
    requestOutput.textContent = "Unlock the local client before loading request results.";
    return;
  }
  if (!state.latestRequestId) {
    requestOutput.textContent = "No request id available yet.";
    return;
  }
  try {
    const result = await requestJson(opsUrl(), `/requests/${state.latestRequestId}/result`);
    const request = await requestJson(opsUrl(), `/requests/${state.latestRequestId}`);
    state.latestRequest = request.body || null;
    state.latestResult = result.body || null;
    renderSelectedRequest();
    requestOutput.textContent = JSON.stringify({ request, result }, null, 2);
    if (result.body?.available) {
      stopResultPolling();
    }
  } catch (error) {
    requestOutput.textContent = `Result fetch failed: ${error instanceof Error ? error.message : "unknown_error"}`;
  }
}

function stopResultPolling() {
  if (state.resultPollTimer) {
    clearInterval(state.resultPollTimer);
    state.resultPollTimer = null;
  }
}

function startResultPolling() {
  stopResultPolling();
  state.resultPollTimer = setInterval(() => {
    void fetchResult();
  }, 1000);
}

document.querySelector("#refresh-status").addEventListener("click", refreshStatus);
document.querySelector("#setup-session").addEventListener("click", setupSession);
document.querySelector("#login-session").addEventListener("click", loginSession);
document.querySelector("#logout-session").addEventListener("click", logoutSession);
document.querySelector("#change-passphrase").addEventListener("click", changePassphrase);
document.querySelector("#setup-client").addEventListener("click", setupClient);
document.querySelector("#register-caller").addEventListener("click", registerCaller);
document.querySelector("#refresh-runtime").addEventListener("click", refreshRuntimeLogs);
document.querySelector("#debug-snapshot").addEventListener("click", refreshDebugSnapshot);
document.querySelector("#save-transport").addEventListener("click", saveTransportConfig);
document.querySelector("#test-transport").addEventListener("click", testTransportConfig);
document.querySelector("#refresh-catalog").addEventListener("click", refreshCatalog);
document.querySelector("#refresh-requests").addEventListener("click", refreshRequests);
addExampleHotlineButton.addEventListener("click", addExampleHotline);
document.querySelector("#add-hotline").addEventListener("click", addHotline);
document.querySelector("#reset-hotline-form").addEventListener("click", () => setHotlineForm());
document.querySelector("#submit-review").addEventListener("click", submitReview);
document.querySelector("#enable-responder").addEventListener("click", enableResponder);
document.querySelector("#run-example-request").addEventListener("click", runExampleRequest);
document.querySelector("#load-first-catalog").addEventListener("click", loadFirstCatalogItem);
document.querySelector("#prepare-call").addEventListener("click", prepareCall);
document.querySelector("#confirm-call").addEventListener("click", confirmCall);
document.querySelector("#cancel-prepared-call").addEventListener("click", clearPreparedCall);
document.querySelector("#poll-result").addEventListener("click", fetchResult);
setupWizard.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-wizard-action]");
  if (!button) {
    return;
  }
  const action = button.dataset.wizardAction;
  if (action === "setup") {
    await setupClient();
    return;
  }
  if (action === "register-caller") {
    await registerCaller();
    return;
  }
  if (action === "focus-hotline-form") {
    hotlineIdInput.focus();
    return;
  }
  if (action === "add-example-hotline") {
    await addExampleHotline();
    return;
  }
  if (action === "submit-review") {
    await submitReview();
    return;
  }
  if (action === "enable-responder") {
    await enableResponder();
  }
});
runtimeServiceInput.addEventListener("change", () => {
  state.runtimeService = runtimeServiceInput.value;
  void refreshRuntimeAlerts();
  void refreshRuntimeLogs();
});
transportTypeInput.addEventListener("change", applyTransportFormVisibility);
transportEmailProviderInput.addEventListener("change", applyTransportFormVisibility);
requestsList.addEventListener("click", async (event) => {
  const card = event.target.closest("[data-request-id]");
  if (!card) {
    return;
  }
  state.latestRequestId = card.dataset.requestId;
  await fetchResult();
});
callConfirmation.addEventListener("click", (event) => {
  const button = event.target.closest("[data-candidate-hotline-id]");
  if (!button) {
    return;
  }
  state.selectedCandidateKey = `${button.dataset.candidateResponderId || ""}:${button.dataset.candidateHotlineId || ""}`;
  renderPreparedCall();
});
responderHotlines.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-hotline-action]");
  if (!button) {
    return;
  }
  const hotlineId = button.dataset.hotlineId;
  const action = button.dataset.hotlineAction;
  if (!hotlineId || !action) {
    return;
  }
  if (action === "edit") {
    const hotline = state.status?.config?.responder?.hotlines?.find((item) => item.hotline_id === hotlineId);
    if (hotline) {
      setHotlineForm(hotline);
    }
    return;
  }
  if (action === "remove") {
    await removeHotline(hotlineId);
    return;
  }
  await toggleHotline(hotlineId, action === "enable");
});
callerFilterInput.addEventListener("input", () => {
  if (state.requests.length > 0) {
    renderRequests(applyCallerFilter(state.requests));
  }
  if (state.catalogItems.length > 0) {
    renderCatalogItems(applyCallerFilter(state.catalogItems));
  }
});
callerEmailInput.addEventListener("change", savePrefs);

loadPrefs();
setHotlineForm();
setTransportForm();
renderPreparedCall();
renderSelectedRequest();
renderAuthState();
void refreshSessionState();
