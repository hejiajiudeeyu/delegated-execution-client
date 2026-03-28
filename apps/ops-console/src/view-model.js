export function renderCallerSummaryCard({ health, root }) {
  const usingLocalCredential = root?.body?.local_defaults?.platform_api_key_configured;
  const contactEmail = root?.body?.local_defaults?.caller_contact_email;
  return `
    <article class="item-card">
      <div class="item-head">
        <div>
          <strong>${root?.body?.service || "caller-controller"}</strong>
          <p>${root?.body?.platform?.configured ? "Platform connected" : "Platform not configured"}</p>
        </div>
        <span class="status ${health?.body?.ok ? "healthy" : "disabled"}">${health?.body?.ok ? "healthy" : "down"}</span>
      </div>
      <p class="meta">Mode: caller runtime${usingLocalCredential ? " · local env credential loaded" : ""}</p>
      ${contactEmail ? `<p class="meta">Caller: ${contactEmail}</p>` : ""}
    </article>
  `;
}

export function renderRequestSummaryMarkup(summary) {
  if (!summary) {
    return `<div class="empty">No request summary available yet.</div>`;
  }
  const statuses = Object.entries(summary.by_status || {})
    .map(([status, count]) => `${status}: ${count}`)
    .join(" · ");
  return `
    <article class="item-card">
      <div class="item-head">
        <div>
          <strong>Recent Requests</strong>
          <p>${summary.total || 0} total</p>
        </div>
        <span class="status ${summary.total > 0 ? "healthy" : "disabled"}">${summary.total > 0 ? "active" : "idle"}</span>
      </div>
      <p class="meta">${statuses || "No recent requests"}</p>
    </article>
  `;
}

export function renderSetupWizardMarkup(status) {
  const config = status?.config || {};
  const responder = config.responder || {};
  const caller = config.caller || {};
  const callerRegistered = caller.api_key_configured === true;
  const hotlines = responder.hotlines || [];
  const exampleConfigured = hotlines.some((item) => item.hotline_id === "local.summary.v1");
  const submittedCount = hotlines.filter((item) => item.submitted_for_review === true).length;
  const pendingReviewCount = hotlines.filter((item) => item.submitted_for_review !== true).length;
  const steps = [
    {
      title: "Setup Local Client",
      done: Boolean(status?.runtime?.supervisor?.port),
      detail: "Initialize ~/.delexec and local supervisor defaults.",
      action: "setup",
      actionLabel: "Run Setup"
    },
    {
      title: "Register Caller",
      done: callerRegistered,
      detail: caller.contact_email ? `Caller: ${caller.contact_email}` : "Create a caller API key for local use.",
      action: "register-caller",
      actionLabel: "Register Caller"
    },
    {
      title: "Add Local Example",
      done: exampleConfigured,
      detail: exampleConfigured
        ? "Official local.summary.v1 demo hotline is configured."
        : "Install the official example hotline to learn the local responder shape.",
      action: "add-example-hotline",
      actionLabel: "Add Example"
    },
    {
      title: "Submit Review",
      done: submittedCount > 0,
      detail: submittedCount > 0
        ? "At least one local hotline has been submitted for review."
        : "Submit local hotlines to the platform review queue.",
      action: "submit-review",
      actionLabel: "Submit Review",
      blockedReason: !callerRegistered
        ? "Register caller before submitting review."
        : hotlines.length === 0
          ? "Add at least one local hotline before review."
          : pendingReviewCount === 0
            ? "No pending local hotlines to submit."
            : null
    },
    {
      title: "Enable Responder",
      done: responder.enabled === true,
      detail: responder.enabled === true ? "Responder runtime enabled locally." : "Enable the local responder runtime after review submission.",
      action: "enable-responder",
      actionLabel: "Enable Responder",
      blockedReason: !callerRegistered
        ? "Register caller before enabling responder."
        : hotlines.length === 0
          ? "Add a local hotline before enabling responder."
          : null
    }
  ];

  const cards = steps
    .map(
      (step) => `
        <article class="item-card">
          <div class="item-head">
            <div>
              <strong>${step.title}</strong>
              <p>${step.detail}</p>
              ${step.blockedReason && !step.done ? `<p class="meta">Blocked: ${step.blockedReason}</p>` : ""}
            </div>
            <span class="status ${step.done ? "healthy" : "disabled"}">${step.done ? "done" : "pending"}</span>
          </div>
          <div class="actions">
            <button data-wizard-action="${step.action}" class="${step.done ? "ghost" : ""}" ${
              step.blockedReason && !step.done ? "disabled" : ""
            }>${step.done ? "Review" : step.actionLabel}</button>
          </div>
        </article>
      `
    )
    .join("");

  return `
    <article class="item-card">
      <div class="item-head">
        <div>
          <strong>Onboarding Summary</strong>
          <p>caller ${callerRegistered ? "registered" : "pending"} · responder ${responder.enabled ? "enabled" : "disabled"}</p>
        </div>
        <span class="status ${callerRegistered ? "healthy" : "disabled"}">${hotlines.length} hotlines</span>
      </div>
      <p class="meta">Submitted: ${submittedCount} · Pending review: ${pendingReviewCount}</p>
    </article>
    ${cards}
  `;
}

export function renderCatalogItemsMarkup(items) {
  if (!Array.isArray(items) || items.length === 0) {
    return `<div class="empty">No catalog items match the current filter.</div>`;
  }
  return items
    .map(
      (item) => `
        <article class="item-card" data-hotline-detail-id="${item.hotline_id}">
          <div class="item-head">
            <div>
              <strong>${item.display_name || item.hotline_id}</strong>
              <p>${item.hotline_id}</p>
            </div>
            <span class="status ${item.availability_status || "healthy"}">${item.availability_status || "healthy"}</span>
          </div>
          <p class="meta">${item.responder_id} · ${(item.capabilities || []).join(", ") || "no capabilities"}</p>
          <p class="meta">${
            item.hotline_id === "local.summary.v1" || (item.tags || []).includes("demo")
              ? "local demo responder"
              : "catalog / remote responder"
          }</p>
        </article>
      `
    )
    .join("");
}

function candidateKey(item) {
  return `${item?.responder_id || ""}:${item?.hotline_id || ""}`;
}

export function renderCallConfirmationMarkup(preparedCall, selectedCandidateKey = null) {
  if (!preparedCall?.selected_hotline) {
    return `<div class="empty">Prepare a call to inspect the selected hotline, candidates, and task-type preference.</div>`;
  }

  const selected =
    preparedCall.candidate_hotlines?.find((item) => candidateKey(item) === selectedCandidateKey) ||
    preparedCall.selected_hotline;
  const candidates = Array.isArray(preparedCall.candidate_hotlines) ? preparedCall.candidate_hotlines : [];

  const candidateMarkup = candidates
    .map(
      (item) => `
        <article class="item-card candidate-card ${candidateKey(item) === candidateKey(selected) ? "selected" : ""}">
          <div class="item-head">
            <div>
              <strong>${item.display_name || item.hotline_id}</strong>
              <p>${item.responder_display_name || item.responder_id}</p>
            </div>
            <span class="status ${item.availability_status || "healthy"}">${item.availability_status || "healthy"}</span>
          </div>
          <p class="meta">${(item.capabilities || []).join(", ") || "no capabilities"}</p>
          <p class="meta">${item.difference_note || "candidate route"}</p>
          <div class="actions">
            <button
              class="${candidateKey(item) === candidateKey(selected) ? "ghost" : ""}"
              data-candidate-hotline-id="${item.hotline_id}"
              data-candidate-responder-id="${item.responder_id}"
            >${candidateKey(item) === candidateKey(selected) ? "Selected" : "Choose this hotline"}</button>
          </div>
        </article>
      `
    )
    .join("");

  return `
    <article class="item-card confirmation-selected">
      <div class="item-head">
        <div>
          <strong>${selected.display_name || selected.hotline_id}</strong>
          <p>${selected.responder_display_name || selected.responder_id}</p>
        </div>
        <span class="status ${selected.availability_status || "healthy"}">${selected.availability_status || "healthy"}</span>
      </div>
      <p class="meta">Why this match: ${preparedCall.selection_reason || (selected.match_reasons || []).join(" · ") || "selected candidate"}</p>
      <p class="meta">Task type: ${preparedCall.task_type || "n/a"}${preparedCall.remembered_preference ? " · remembered preference available" : ""}</p>
      <p class="meta">Capabilities: ${(selected.capabilities || []).join(", ") || "n/a"}</p>
      <p class="meta">Template: ${selected.template_summary?.template_ref || "n/a"} · output ${
        (selected.template_summary?.output_properties || []).join(", ") || "n/a"
      }</p>
    </article>
    <div class="confirmation-grid">${candidateMarkup || `<div class="empty">No alternative hotlines available.</div>`}</div>
  `;
}

export function renderRequestsMarkup(items) {
  if (!Array.isArray(items) || items.length === 0) {
    return `<div class="empty">No requests match the current filter.</div>`;
  }
  return items
    .map(
      (item) => `
        <article class="item-card" data-request-id="${item.request_id}">
          <div class="item-head">
            <div>
              <strong>${item.request_id}</strong>
              <p>${item.responder_id || "unbound responder"} · ${item.hotline_id || "unbound hotline"}</p>
            </div>
            <span class="status ${String(item.status || "").toLowerCase()}">${item.status}</span>
          </div>
          <p class="meta">Updated: ${item.updated_at || item.created_at || "n/a"}</p>
        </article>
      `
    )
    .join("");
}

export function renderRequestDetailMarkup({ request, result }) {
  if (!request) {
    return `<div class="empty">No request selected yet.</div>`;
  }

  const resultStatus = result?.available
    ? result.result_package?.status || "available"
    : result?.available === false
      ? "pending"
      : "unknown";
  const summary =
    result?.result_package?.output?.summary ||
    result?.result_package?.error?.message ||
    request.result_package?.output?.summary ||
    request.last_error_code ||
    "No result payload yet.";
  const timeline = Array.isArray(request.timeline)
    ? request.timeline.map((entry) => `<li>${entry.at || "n/a"} · ${entry.event || "UNKNOWN"}</li>`).join("")
    : "";
  const platformEvents = Array.isArray(request.platform_events)
    ? request.platform_events.map((entry) => `<li>${entry.at || "n/a"} · ${entry.event_type || "UNKNOWN"}</li>`).join("")
    : "";
  const resultPayload = result?.result_package || request.result_package || null;
  const topSummary =
    result?.available === false
      ? "Waiting for responder result."
      : resultPayload?.error?.message || resultPayload?.output?.summary || "No result payload yet.";

  return `
    <article class="item-card">
      <div class="item-head">
        <div>
          <strong>${request.request_id}</strong>
          <p>${request.responder_id || "unbound responder"} · ${request.hotline_id || "unbound hotline"}</p>
        </div>
        <span class="status ${String(request.status || "unknown").toLowerCase()}">${request.status || "UNKNOWN"}</span>
      </div>
      <p class="meta">Result: ${resultStatus} · Updated: ${request.updated_at || request.created_at || "n/a"}</p>
      <div class="item-card">
        <strong>Result Summary</strong>
        <p class="meta">status=${resultStatus}</p>
        <p class="meta">${topSummary}</p>
      </div>
      <div class="stack">
        <div class="item-card">
          <strong>Result Payload</strong>
          <pre class="output compact">${JSON.stringify(resultPayload, null, 2) || "null"}</pre>
        </div>
        <div class="item-card">
          <strong>Timeline</strong>
          ${timeline ? `<ul class="meta-list">${timeline}</ul>` : `<div class="empty">No timeline yet.</div>`}
        </div>
        <div class="item-card">
          <strong>Platform Events</strong>
          ${platformEvents ? `<ul class="meta-list">${platformEvents}</ul>` : `<div class="empty">No platform events yet.</div>`}
        </div>
      </div>
    </article>
  `;
}

export function renderTransportConfigMarkup(transport, lastTest = null) {
  if (!transport) {
    return `<div class="empty">Transport config not loaded yet.</div>`;
  }

  const details = [];
  details.push(`type=${transport.type}`);
  if (transport.type === "relay_http") {
    details.push(`base_url=${transport.relay_http?.base_url || "unset"}`);
  }
  if (transport.type === "email") {
    details.push(`provider=${transport.email?.provider || "unset"}`);
    details.push(`sender=${transport.email?.sender || "unset"}`);
    details.push(`receiver=${transport.email?.receiver || "unset"}`);
    details.push(`poll=${transport.email?.poll_interval_ms || "unset"}ms`);
    if (transport.email?.provider === "emailengine") {
      details.push(`account=${transport.email?.emailengine?.account || "unset"}`);
      details.push(`token=${transport.email?.emailengine?.access_token_configured ? "configured" : "missing"}`);
    }
    if (transport.email?.provider === "gmail") {
      details.push(`user=${transport.email?.gmail?.user || "unset"}`);
      details.push(`client_secret=${transport.email?.gmail?.client_secret_configured ? "configured" : "missing"}`);
      details.push(`refresh_token=${transport.email?.gmail?.refresh_token_configured ? "configured" : "missing"}`);
    }
  }

  const lastTestMarkup = lastTest
    ? `<div class="item-card">
        <strong>Last Test</strong>
        <pre class="output compact">${JSON.stringify(lastTest, null, 2)}</pre>
      </div>`
    : `<div class="empty">No connection test run yet.</div>`;

  return `
    <article class="item-card">
      <div class="item-head">
        <div>
          <strong>Runtime Transport</strong>
          <p>${details.join(" · ")}</p>
        </div>
        <span class="status ${transport.type === "email" ? "pending" : "healthy"}">${transport.type}</span>
      </div>
    </article>
    ${lastTestMarkup}
  `;
}

export function renderResponderHotlinesMarkup(items) {
  if (!Array.isArray(items) || items.length === 0) {
    return `<div class="empty">No local hotlines configured yet.</div>`;
  }
  return items
    .map(
      (item) => `
        <article class="item-card">
          <div class="item-head">
            <div>
              <strong>${item.display_name || item.hotline_id}</strong>
              <p>${item.hotline_id}</p>
            </div>
            <span class="status ${item.enabled === false ? "disabled" : "healthy"}">${item.enabled === false ? "disabled" : "enabled"}</span>
          </div>
          <p class="meta">${item.adapter_type || "process"} · ${(item.capabilities || []).join(", ") || "no capabilities"}</p>
          <p class="meta">Review: ${item.review_status || "local_only"} · ${item.submitted_for_review ? "submitted" : "local only"}</p>
          ${item.metadata?.project?.path ? `<p class="meta">Project: ${item.metadata.project.path}</p>` : ""}
          ${item.metadata?.project?.description ? `<p class="meta">Project Summary: ${item.metadata.project.description}</p>` : ""}
          <p class="meta">${item.hotline_id === "local.summary.v1" ? "official local demo responder" : "custom local responder"}</p>
          <div class="actions">
            <button data-hotline-action="edit" data-hotline-id="${item.hotline_id}">Edit</button>
            ${
              item.enabled === false
                ? `<button data-hotline-action="enable" data-hotline-id="${item.hotline_id}">Enable</button>`
                : `<button data-hotline-action="disable" data-hotline-id="${item.hotline_id}" class="ghost">Disable</button>`
            }
            <button data-hotline-action="remove" data-hotline-id="${item.hotline_id}" class="ghost">Remove</button>
          </div>
        </article>
      `
    )
    .join("");
}

export function renderRuntimeCardsMarkup(runtime) {
  if (!runtime) {
    return `<div class="empty">No runtime status available yet.</div>`;
  }

  const services = ["relay", "caller", "responder"];
  return services
    .map((name) => {
      const item = runtime[name] || {};
      const healthy = item.health?.body?.ok === true;
      const running = item.running === true;
      const badge = healthy ? "healthy" : running ? "acked" : "disabled";
      return `
        <article class="item-card">
          <div class="item-head">
            <div>
              <strong>${name}</strong>
              <p>pid: ${item.pid || "n/a"}</p>
            </div>
            <span class="status ${badge}">${healthy ? "healthy" : running ? "running" : "stopped"}</span>
          </div>
          <p class="meta">Started: ${item.started_at || "n/a"}</p>
          <p class="meta">Exit: ${item.exit_code ?? "n/a"}${item.last_error ? ` · ${item.last_error}` : ""}</p>
        </article>
      `;
    })
    .join("");
}

export function renderRuntimeAlertsMarkup(service, alerts) {
  if (!Array.isArray(alerts) || alerts.length === 0) {
    return `<div class="empty">No recent errors or warnings for ${service}.</div>`;
  }
  return alerts
    .map(
      (item) => `
        <article class="item-card">
          <div class="item-head">
            <div>
              <strong>${item.service || service}</strong>
              <p>${item.source || "runtime"}${item.at ? ` · ${item.at}` : ""}</p>
            </div>
            <span class="status ${item.severity === "error" ? "disabled" : "warm"}">${item.severity || "info"}</span>
          </div>
          <p class="meta">${item.message || "unknown_alert"}</p>
        </article>
      `
    )
    .join("");
}
