import { spawn } from "node:child_process";

export function deferTask(reason = "deferred") {
  return {
    deferred: true,
    reason
  };
}

function normalizeExecutionResult(result) {
  if (!result || typeof result !== "object") {
    return {
      status: "error",
      error: {
        code: "HOTLINE_INVALID_RESULT",
        message: "hotline returned an invalid result payload",
        retryable: false
      },
      schema_valid: true,
      usage: { tokens_in: 0, tokens_out: 0 }
    };
  }

  if (result.status === "ok" || result.status === "error" || result.deferred === true) {
    return result;
  }

  return {
    status: "ok",
    output: result,
    schema_valid: true,
    usage: { tokens_in: 0, tokens_out: 0 }
  };
}

function resolveAdapterTimeouts(hotline, context) {
  const hotlineTimeouts = hotline?.timeouts || {};
  const constraintTimeouts = context?.constraints || {};
  return {
    soft_timeout_s: Number(constraintTimeouts.soft_timeout_s ?? hotlineTimeouts.soft_timeout_s ?? 0) || null,
    hard_timeout_s: Number(constraintTimeouts.hard_timeout_s ?? hotlineTimeouts.hard_timeout_s ?? 0) || null
  };
}

function parsePartialJsonOutput(stdout) {
  const trimmed = String(stdout || "").trim();
  if (!trimmed) {
    return null;
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    return { partial_text: trimmed };
  }
}

export function createFunctionExecutor(fn, { name = "function-executor", allowedTaskTypes = null } = {}) {
  if (typeof fn !== "function") {
    throw new TypeError("responder_executor_fn_required");
  }

  return {
    name,
    allowedTaskTypes: Array.isArray(allowedTaskTypes) ? [...allowedTaskTypes] : null,
    async execute(context) {
      return normalizeExecutionResult(await fn(context));
    }
  };
}

async function runProcessAdapter(adapter, context, timeouts = {}, hooks = {}) {
  if (!adapter?.cmd) {
    throw new Error("process_adapter_cmd_required");
  }

  return new Promise((resolve, reject) => {
    const child = spawn(adapter.cmd, {
      cwd: adapter.cwd || process.cwd(),
      env: {
        ...process.env,
        ...(adapter.env || {})
      },
      shell: true,
      stdio: ["pipe", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";
    let softFired = false;
    let hardFired = false;
    let settled = false;

    const finish = (result) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(softTimer);
      clearTimeout(hardTimer);
      resolve(result);
    };

    const softMs = timeouts.soft_timeout_s ? timeouts.soft_timeout_s * 1000 : null;
    const hardMs = timeouts.hard_timeout_s ? timeouts.hard_timeout_s * 1000 : null;

    const softTimer =
      softMs && softMs > 0
        ? setTimeout(() => {
            softFired = true;
            try {
              child.kill("SIGUSR1");
            } catch {
              // optional adapter signal handling
            }
            if (typeof hooks.onSoftTimeout === "function") {
              hooks.onSoftTimeout();
            }
          }, softMs)
        : null;

    const hardTimer =
      hardMs && hardMs > 0
        ? setTimeout(() => {
            hardFired = true;
            try {
              child.kill("SIGKILL");
            } catch {
              // force terminate
            }
          }, hardMs)
        : null;

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });

    child.on("error", (error) => {
      if (!settled) {
        reject(error);
      }
    });

    child.on("close", (code) => {
      if (hardFired) {
        finish({
          status: "error",
          error: {
            code: "EXEC_TIMEOUT",
            message: stderr.trim() || "process exceeded hard timeout",
            retryable: true
          },
          output: parsePartialJsonOutput(stdout),
          schema_valid: true,
          usage: { tokens_in: 0, tokens_out: 0 },
          timing: {
            soft_timeout_fired: softFired,
            hard_timeout_fired: true
          }
        });
        return;
      }

      if (code !== 0) {
        finish({
          status: "error",
          error: {
            code: "HOTLINE_PROCESS_EXITED",
            message: stderr.trim() || `process exited with code ${code}`,
            retryable: false
          },
          schema_valid: true,
          usage: { tokens_in: 0, tokens_out: 0 },
          timing: {
            soft_timeout_fired: softFired,
            hard_timeout_fired: false
          }
        });
        return;
      }

      try {
        const parsed = stdout.trim() ? JSON.parse(stdout) : null;
        const normalized = normalizeExecutionResult(parsed);
        if (softFired && normalized.status === "ok") {
          normalized.timing = {
            ...(normalized.timing || {}),
            soft_timeout_fired: true
          };
        }
        finish(normalized);
      } catch {
        finish({
          status: "error",
          error: {
            code: "HOTLINE_PROCESS_INVALID_JSON",
            message: "process adapter must emit a single JSON payload on stdout",
            retryable: false
          },
          schema_valid: true,
          usage: { tokens_in: 0, tokens_out: 0 }
        });
      }
    });

    child.stdin.write(
      JSON.stringify({
        request_id: context.requestId,
        responder_id: context.responderId,
        hotline_id: context.hotlineId,
        task_type: context.taskType,
        input: context.taskInput,
        payload: context.payload,
        constraints: context.constraints,
        task: context.task
      })
    );
    child.stdin.end();
  });
}

async function runHttpAdapter(adapter, context, timeouts = {}, hooks = {}) {
  if (!adapter?.url) {
    throw new Error("http_adapter_url_required");
  }

  const controller = new AbortController();
  const softMs = timeouts.soft_timeout_s ? timeouts.soft_timeout_s * 1000 : null;
  const hardMs = timeouts.hard_timeout_s ? timeouts.hard_timeout_s * 1000 : null;
  let softFired = false;

  const softTimer =
    softMs && softMs > 0
      ? setTimeout(() => {
          softFired = true;
          if (typeof hooks.onSoftTimeout === "function") {
            hooks.onSoftTimeout();
          }
        }, softMs)
      : null;

  const hardTimer =
    hardMs && hardMs > 0
      ? setTimeout(() => {
          controller.abort();
        }, hardMs)
      : null;

  try {
    const response = await fetch(adapter.url, {
      method: adapter.method || "POST",
      headers: {
        "content-type": "application/json; charset=utf-8",
        ...(adapter.headers || {})
      },
      body: JSON.stringify({
        request_id: context.requestId,
        responder_id: context.responderId,
        hotline_id: context.hotlineId,
        task_type: context.taskType,
        input: context.taskInput,
        payload: context.payload,
        constraints: context.constraints,
        task: context.task
      }),
      signal: controller.signal
    });

    const text = await response.text();
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      return {
        status: "error",
        error: {
          code: "HOTLINE_HTTP_INVALID_JSON",
          message: "http adapter must return JSON",
          retryable: false
        },
        schema_valid: true,
        usage: { tokens_in: 0, tokens_out: 0 }
      };
    }

    if (!response.ok) {
      return {
        status: "error",
        error: {
          code: "HOTLINE_HTTP_FAILED",
          message: body?.error?.message || body?.message || `http adapter returned ${response.status}`,
          retryable: false
        },
        schema_valid: true,
        usage: { tokens_in: 0, tokens_out: 0 }
      };
    }

    const normalized = normalizeExecutionResult(body);
    if (softFired && normalized.status === "ok") {
      normalized.timing = {
        ...(normalized.timing || {}),
        soft_timeout_fired: true
      };
    }
    return normalized;
  } catch (error) {
    if (controller.signal.aborted) {
      return {
        status: "error",
        error: {
          code: "EXEC_TIMEOUT",
          message: error instanceof Error ? error.message : "http adapter exceeded hard timeout",
          retryable: true
        },
        schema_valid: true,
        usage: { tokens_in: 0, tokens_out: 0 },
        timing: {
          soft_timeout_fired: softFired,
          hard_timeout_fired: true
        }
      };
    }
    throw error;
  } finally {
    clearTimeout(softTimer);
    clearTimeout(hardTimer);
  }
}

export function createConfiguredHotlineExecutor(hotline) {
  const allowedTaskTypes = Array.isArray(hotline?.task_types) ? [...hotline.task_types] : null;

  if (hotline?.adapter_type === "http") {
    return {
      name: `http-adapter:${hotline.hotline_id}`,
      allowedTaskTypes,
      async execute(context, hooks = {}) {
        return runHttpAdapter(hotline.adapter, context, resolveAdapterTimeouts(hotline, context), hooks);
      }
    };
  }

  if (hotline?.adapter_type === "function" && typeof hotline?.adapter?.fn === "function") {
    return createFunctionExecutor(hotline.adapter.fn, {
      name: `function-adapter:${hotline.hotline_id}`,
      allowedTaskTypes
    });
  }

  return {
    name: `process-adapter:${hotline?.hotline_id || "unknown"}`,
    allowedTaskTypes,
    async execute(context, hooks = {}) {
      return runProcessAdapter(hotline?.adapter || {}, context, resolveAdapterTimeouts(hotline, context), hooks);
    }
  };
}

export function createHotlineRouterExecutor(hotlines = [], fallback = createSimulatorExecutor()) {
  const enabled = new Map(
    (Array.isArray(hotlines) ? hotlines : [])
      .filter((item) => item?.hotline_id)
      .map((item) => [item.hotline_id, { definition: item, executor: createConfiguredHotlineExecutor(item) }])
  );

  return {
    name: "hotline-router-executor",
    listHotlines() {
      return Array.from(enabled.values()).map(({ definition }) => ({
        hotline_id: definition.hotline_id,
        display_name: definition.display_name || definition.hotline_id,
        enabled: definition.enabled !== false,
        adapter_type: definition.adapter_type || "process",
        task_types: definition.task_types || [],
        tags: definition.tags || []
      }));
    },
    getAllowedTaskTypes(hotlineId) {
      return enabled.get(hotlineId)?.executor.allowedTaskTypes || fallback?.allowedTaskTypes || null;
    },
    async execute(context, hooks = {}) {
      const selected = enabled.get(context.hotlineId);
      if (!selected || selected.definition.enabled === false) {
        if (fallback?.execute) {
          return fallback.execute(context, hooks);
        }
        return {
          status: "error",
          error: {
            code: "HOTLINE_NOT_CONFIGURED",
            message: `hotline '${context.hotlineId}' is not configured locally`,
            retryable: false
          },
          schema_valid: true,
          usage: { tokens_in: 0, tokens_out: 0 }
        };
      }
      return selected.executor.execute(context, hooks);
    }
  };
}

export function createSimulatorExecutor() {
  return createFunctionExecutor(
    async ({ task }) => {
      if (task.simulate === "timeout") {
        return deferTask("timeout");
      }

      if (task.simulate === "token_expired") {
        return {
          status: "error",
          error: {
            code: "AUTH_TOKEN_EXPIRED",
            message: "Token expired during responder validation",
            retryable: false
          },
          schema_valid: true,
          usage: { tokens_in: 0, tokens_out: 0 }
        };
      }

      if (task.simulate === "schema_invalid") {
        return {
          status: "ok",
          output: { malformed_field: true },
          schema_valid: false,
          usage: { tokens_in: 0, tokens_out: 0 }
        };
      }

      if (task.simulate === "reject") {
        return {
          status: "error",
          error: {
            code: "CONTRACT_REJECTED",
            message: "Responder guardrail rejected this task",
            retryable: false
          },
          schema_valid: true,
          usage: { tokens_in: 0, tokens_out: 0 }
        };
      }

      return {
        status: "ok",
        output: {
          summary: "Task completed",
          task_id: task.task_id
        },
        schema_valid: true,
        usage: { tokens_in: 42, tokens_out: 24 }
      };
    },
    { name: "simulator-executor" }
  );
}

export function createExampleFunctionExecutor() {
  return createFunctionExecutor(
    async ({ taskInput, task }) => ({
      status: "ok",
      output: {
        summary: `Handled ${task.task_type || "task"} for ${task.hotline_id}`,
        received: taskInput ?? null
      },
      schema_valid: true,
      usage: { tokens_in: 1, tokens_out: 1 }
    }),
    { name: "example-function-executor" }
  );
}
