import { Link } from "react-router-dom"
import { BookOpen, PlayCircle, ShieldCheck, MessageSquareWarning } from "lucide-react"

/**
 * Built-in 「上手 & 帮助」 entry — Stage 1 stub.
 *
 * The full content (8-section TOC + scroll-anchored articles) is specified
 * in `console-content-spec.md §5.7` and prototyped at
 * `call-anything-brand-site/src/design-system/patterns/console-page-help.tsx`.
 *
 * Stage 1 ships only this navigational landing so the sidebar Help footer
 * has a real destination. Stage 3 ports the full multi-article page.
 */
export function HelpPage() {
  return (
    <div className="space-y-6">
      <div>
        <div className="c-kicker mb-2">GENERAL · 上手与帮助</div>
        <h1 className="text-[22px] font-semibold tracking-tight text-[var(--ink)] leading-tight">
          使用指南
        </h1>
        <p className="mt-1.5 text-[13px] text-[var(--brand-muted)] max-w-2xl leading-relaxed">
          搞清楚 caller / responder / hotline 是什么 · 5 分钟跑通第一次调用 · 审批与白名单 · 故障排查 · 反馈渠道。
        </p>
      </div>

      <div
        className="border-l-[3px] border-l-[var(--brand-orange)] bg-[color-mix(in_oklab,var(--brand-orange)_5%,transparent)] p-4 c-ink-border"
        style={{ borderRadius: "var(--c-radius)" }}
      >
        <p className="text-[12.5px] font-semibold text-[var(--ink)]">完整内容下个版本上线</p>
        <p className="text-[12px] text-[var(--brand-muted)] mt-1 leading-relaxed">
          内容契约已写完（见 <code className="console-mono text-[11.5px]">console-content-spec.md §5.7</code>）。
          原型可在 <a href="https://github.com/anyone/call-anything-brand-site" target="_blank" rel="noreferrer" className="underline underline-offset-2 text-[var(--ink)]">call-anything-brand-site</a> 的 <code className="console-mono text-[11.5px]">/console/help</code> 路径预览。
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <HelpShortcut
          icon={PlayCircle}
          title="跑通第一次调用"
          description="去 Hotline 目录挑一个 official Hotline，点「试拨」即可。"
          to="/caller/catalog?from=dashboard-onboarding"
          cta="打开热线目录"
        />
        <HelpShortcut
          icon={ShieldCheck}
          title="审批与白名单"
          description="Agent 调用 Hotline 默认走人工审批；信任的 Hotline 可加入白名单自动放行。"
          to="/caller/lists"
          cta="打开名单管理"
        />
        <HelpShortcut
          icon={BookOpen}
          title="Hotline 是什么"
          description="一组可被 Agent 调用的能力 / API。由 Responder 实现并发布。"
          to="/responder"
          cta="去 Responder 概览"
        />
        <HelpShortcut
          icon={MessageSquareWarning}
          title="报告问题"
          description="把 request_id 一并贴上来，方便排查。"
          to="#feedback"
          cta="提交反馈"
        />
      </div>
    </div>
  )
}

interface HelpShortcutProps {
  icon: typeof BookOpen
  title: string
  description: string
  to: string
  cta: string
}

function HelpShortcut({ icon: Icon, title, description, to, cta }: HelpShortcutProps) {
  const isExternalAnchor = to.startsWith("#")
  const Inner = (
    <div
      className="bg-white border p-4 c-lift h-full"
      style={{
        borderColor: "var(--border)",
        borderRadius: "var(--c-radius)",
      }}
    >
      <div className="flex items-start gap-2.5">
        <Icon
          className="h-4 w-4 mt-0.5 text-[var(--brand-ink)] shrink-0"
          strokeWidth={2.25}
        />
        <div className="min-w-0">
          <p className="text-[13px] font-semibold text-[var(--ink)]">{title}</p>
          <p className="text-[12px] text-[var(--brand-muted)] mt-1 leading-relaxed">
            {description}
          </p>
          <p className="text-[12px] font-semibold text-[var(--ink)] mt-2 inline-flex items-center gap-1">
            {cta} →
          </p>
        </div>
      </div>
    </div>
  )
  if (isExternalAnchor) {
    return (
      <a href={to} className="block">
        {Inner}
      </a>
    )
  }
  return (
    <Link to={to} className="block">
      {Inner}
    </Link>
  )
}
