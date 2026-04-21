import { useNavigate, useSearchParams } from "react-router-dom"
import { ChevronLeft, X } from "lucide-react"
import { cn } from "@/components/ui/utils"

/**
 * Cross-page deep-link breadcrumb chip.
 *
 * See `console-content-spec.md §0.6` (canonical mirror in
 * call-anything-brand-site/docs/console-content-spec.md).
 *
 * Reads `?from=<key>` from the current URL. If the key is registered in
 * `FROM_LABELS`, renders a tiny chip near the top of the page so the user
 * knows where they came from and can pop back.
 *
 * Pages opt in just by accepting `?from=...` as part of their deep links.
 * Unregistered keys are ignored — fail-safe (no chip) rather than confuse.
 */
const FROM_LABELS: Record<string, string> = {
  "dashboard-onboarding": "上手清单",
  "dashboard-nextup": "工作台 · 下一步",
  "calls-retry": "调用记录 · 重试",
  "calls-detail": "调用记录",
  "approvals-add-whitelist": "审批中心 · 加入白名单",
  "approvals-tired-banner": "审批中心 · 切换模式",
}

export function FromContextChip({ className }: { className?: string }) {
  const [search, setSearch] = useSearchParams()
  const navigate = useNavigate()
  const fromKey = search.get("from")
  if (!fromKey) return null
  const label = FROM_LABELS[fromKey] ?? fromKey

  const handleDismiss = () => {
    const next = new URLSearchParams(search)
    next.delete("from")
    setSearch(next, { replace: true })
  }

  return (
    <div
      className={cn(
        "console-mode-chip mb-4 inline-flex items-center gap-2 px-3 py-1.5 bg-white c-ink-border text-[12px]",
        className,
      )}
      style={{ borderRadius: "var(--c-radius)" }}
      role="status"
    >
      <button
        type="button"
        onClick={() => navigate(-1)}
        className="inline-flex items-center gap-1 font-medium text-[var(--ink)] hover:text-[var(--brand-orange)]"
      >
        <ChevronLeft className="h-3.5 w-3.5" strokeWidth={2.5} />
        从「{label}」跳过来
      </button>
      <button
        type="button"
        onClick={handleDismiss}
        className="text-[var(--brand-muted)] hover:text-[var(--ink)] ml-1"
        aria-label="清除"
        title="清除来路标记"
      >
        <X className="h-3 w-3" strokeWidth={2.5} />
      </button>
    </div>
  )
}
