/**
 * Human-readable Chinese messages for canonical error codes.
 *
 * The canonical code list lives in `@delexec/contracts` (`ERROR_REGISTRY`).
 * We mirror only the codes consoles can surface, keeping the console
 * runtime free of the contracts package. When a new code starts showing
 * up in toasts as raw `XXX_YYY`, add an entry here.
 *
 * Synthetic codes (no contracts entry):
 *   - NETWORK_ERROR — fetch threw (offline, DNS, CORS, etc.)
 *   - PARSE_ERROR   — body wasn't valid JSON
 *   - HTTP_<N>      — non-2xx with no recognizable error envelope
 *   - ABORTED       — AbortController fired (no toast)
 */

export const ERROR_MESSAGES: Record<string, string> = {
  NETWORK_ERROR: "网络异常，请检查连接后重试",
  PARSE_ERROR: "服务器返回格式异常",

  HTTP_400: "请求参数错误",
  HTTP_401: "登录已失效，请重新解锁",
  HTTP_403: "没有访问权限",
  HTTP_404: "资源不存在",
  HTTP_409: "状态冲突，请刷新后重试",
  HTTP_429: "请求过于频繁，请稍后再试",
  HTTP_500: "服务异常，请稍后重试",
  HTTP_502: "上游服务异常",
  HTTP_503: "服务暂不可用",

  AUTH_UNAUTHORIZED: "登录已失效，请重新解锁",
  AUTH_INVALID_PASSPHRASE: "口令不正确",
  AUTH_INVALID_CREDENTIALS: "凭据无效",
  AUTH_TOKEN_EXPIRED: "会话已过期，请重新解锁",
  AUTH_TOKEN_INVALID: "凭据已失效",
  AUTH_SESSION_REQUIRED: "需要先解锁后再访问",
  AUTH_SECRET_STORE_EXISTS: "已经初始化过，无需再次配置",
  AUTH_SECRET_STORE_MISSING: "尚未初始化，请先完成首次设置",
  AUTH_BOOTSTRAP_FORBIDDEN: "当前不允许执行初始化",
  AUTH_KEY_NOT_FOUND: "找不到对应的密钥",

  CATALOG_HOTLINE_NOT_FOUND: "Hotline 不存在或未启用",
  HOTLINE_NOT_FOUND: "Hotline 不存在",
  HOTLINE_NOT_APPROVED: "Hotline 尚未通过审核",
  HOTLINE_NOT_CONFIGURED: "Hotline 未配置",
  HOTLINE_INVALID_INPUT: "输入不符合 Hotline schema",
  HOTLINE_INVALID_RESULT: "Hotline 返回结果不符合 schema",
  HOTLINE_ID_ALREADY_EXISTS: "Hotline ID 已存在",
  HOTLINE_ID_REQUIRED: "缺少 Hotline ID",
  HOTLINE_QUOTA_EXCEEDED: "Hotline 数量已达上限",

  REQUEST_NOT_FOUND: "找不到对应的请求",
  REQUEST_BINDING_MISMATCH: "请求与凭据不匹配",
  REQUEST_ALREADY_TERMINAL: "请求已处于终态，无法再操作",

  RESPONDER_NOT_FOUND: "Responder 不存在",
  RESPONDER_NOT_APPROVED: "Responder 尚未通过审核",
  RESPONDER_NOT_ENABLED: "Responder 未启用",
  RESPONDER_PLATFORM_REGISTER_FAILED: "向 Platform 注册 Responder 失败",

  CALLER_NOT_REGISTERED: "Caller 尚未注册",
  CALLER_PLATFORM_REGISTER_FAILED: "向 Platform 注册 Caller 失败",
  CALLER_PLATFORM_CATALOG_FAILED: "从 Platform 拉取 Catalog 失败",
  CALLER_PLATFORM_RESPONDER_REGISTER_FAILED: "向 Platform 注册 Responder 失败",
  CALLER_PLATFORM_TOKEN_FAILED: "申请 Platform 令牌失败",
  CALLER_PLATFORM_PREPARE_FAILED: "准备调用失败",
  CALLER_REMOTE_REQUEST_FAILED: "远程调用失败",
  CALLER_CONTROLLER_INTERNAL_ERROR: "Caller 控制器内部错误",

  PLATFORM_NOT_CONFIGURED: "Platform 未配置",
  PLATFORM_RATE_LIMITED: "请求过于频繁，请稍后再试",
  PLATFORM_API_INTERNAL_ERROR: "Platform 内部错误",
  PLATFORM_REVIEW_TRANSPORT_NOT_CONFIGURED: "审核 Transport 未配置",

  TRANSPORT_NOT_CONFIGURED: "Transport 未配置",
  TRANSPORT_SEND_NOT_AVAILABLE: "Transport 不支持发送",
  TRANSPORT_POLL_NOT_AVAILABLE: "Transport 不支持轮询",
  TRANSPORT_CONNECTION_FAILED: "Transport 连接失败",

  CONTRACT_INVALID_JSON: "请求格式错误",
  CONTRACT_REJECTED: "调用被合约拒绝",
  CONTRACT_INVALID_PREPARE_REQUEST: "调用准备参数无效",
  CONTRACT_INVALID_REMOTE_REQUEST: "远程调用参数无效",
  CONTRACT_INVALID_REGISTER_BODY: "注册参数无效",
  CONTRACT_INVALID_RESPONDER_REGISTER_BODY: "Responder 注册参数无效",
  CONTRACT_TIMEOUT_EXCEEDS_RESPONDER_LIMIT: "超时设置超过 Responder 上限",
  CONTRACT_TASK_TYPE_UNSUPPORTED: "Responder 不支持该任务类型",

  EXEC_TIMEOUT: "执行超时",
  EXEC_TIMEOUT_HARD: "执行硬超时（被强制结束）",
  EXEC_TIMEOUT_MANUAL_STOP: "执行被手动停止",
  EXEC_INTERNAL_ERROR: "执行器内部错误",
  EXEC_QUEUE_FULL: "执行队列已满",
  EXECUTOR_RUNTIME_ERROR: "执行器运行错误",
  EXECUTOR_INVALID_RESULT: "执行结果不符合 schema",

  RESULT_NOT_READY: "结果尚未就绪",
  RESULT_SIGNATURE_INVALID: "结果签名无效",
  RESULT_SCHEMA_INVALID: "结果不符合 schema",
  RESULT_ARTIFACT_INVALID: "结果产物无效",
  RESULT_ARTIFACT_TOO_LARGE: "结果产物超过大小限制",

  OPS_SUPERVISOR_INTERNAL_ERROR: "Ops Supervisor 内部错误",
}

/**
 * Look up a localized message for an error code, falling back to the
 * synthetic `HTTP_<status>` family. Returns null if neither matches so
 * the caller can use the server `error.message` or its own fallback.
 */
export function getErrorMessage(code: string, status?: number): string | null {
  if (ERROR_MESSAGES[code]) return ERROR_MESSAGES[code]
  if (status && ERROR_MESSAGES[`HTTP_${status}`]) return ERROR_MESSAGES[`HTTP_${status}`]
  return null
}
