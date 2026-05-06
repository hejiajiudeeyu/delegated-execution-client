import { useEffect, useMemo, useRef, useState } from "react"
import { Link, useLocation } from "react-router-dom"
import {
  BookOpen,
  PlayCircle,
  ShieldCheck,
  ShieldAlert,
  Users,
  Phone,
  Globe,
  Wrench,
  HelpCircle,
  MessageSquareWarning,
  ChevronRight,
} from "lucide-react"

/**
 * Built-in 「上手 & 帮助」 page. Implements console-content-spec.md §5.7:
 * sticky 8-chapter TOC + scroll-anchored articles, organised by user
 * journey rather than by system module. All deep links from Stage 2
 * pages (`?from=...` hand-offs, `/help#anchor` jumps from M7 banner /
 * NextUp card / Calls failure CTAs) resolve here.
 */

interface Section {
  id: string
  number: number
  icon: typeof BookOpen
  title: string
  blurb: string
}

const SECTIONS: Section[] = [
  { id: "what-is-caller", number: 1, icon: Users, title: "什么是 Caller / Responder", blurb: "一图说清『我让 Agent 帮我调东西』 vs. 『我把能力发布给别人调』。" },
  { id: "first-call", number: 2, icon: PlayCircle, title: "5 分钟跑通第一次调用", blurb: "端到端：注册 → 启用 responder → 加 hotline → 试拨 → 看结果。" },
  { id: "what-is-hotline", number: 3, icon: Phone, title: "什么是 Hotline", blurb: "把 Hotline 类比成『REST API + Schema + 审批策略』的复合体。" },
  { id: "approvals", number: 4, icon: ShieldCheck, title: "审批与白名单", blurb: "三种模式 / 加白名单 / 加黑名单 / 模式切换的 trade-off。" },
  { id: "platform-mode", number: 5, icon: Globe, title: "本地模式 vs. 平台模式", blurb: "价值对比表 + 何时该开启 + 如何开启。" },
  { id: "troubleshooting", number: 6, icon: Wrench, title: "常见故障排查", blurb: "Responder 连不上 / 调用失败 / 平台 API 不可达 / 审批不动了。" },
  { id: "faq", number: 7, icon: HelpCircle, title: "FAQ", blurb: "10 条常见问答。" },
  { id: "feedback", number: 8, icon: MessageSquareWarning, title: "反馈与报告问题", blurb: "diagnostic-bundle 流程 + GitHub issue 模板 + 邮件。" },
]

export function HelpPage() {
  const location = useLocation()
  const [activeId, setActiveId] = useState<string>(SECTIONS[0].id)
  const sectionRefs = useRef<Map<string, HTMLElement>>(new Map())

  // Scroll to the requested anchor whenever the URL hash changes. The default
  // react-router `BrowserRouter` does not auto-scroll for hash changes, so the
  // page would otherwise stay at the top no matter what link the user clicked.
  useEffect(() => {
    const hash = location.hash.replace(/^#/, "")
    if (!hash) {
      window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior })
      return
    }
    const target = sectionRefs.current.get(hash)
    if (target) {
      target.scrollIntoView({ behavior: "smooth", block: "start" })
      setActiveId(hash)
    }
  }, [location.hash, location.key])

  // ScrollSpy: highlight the TOC entry whose section is currently in view.
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0]
        if (visible?.target instanceof HTMLElement) {
          const id = visible.target.id
          if (id) setActiveId(id)
        }
      },
      { rootMargin: "-30% 0px -55% 0px", threshold: 0 },
    )
    sectionRefs.current.forEach((el) => observer.observe(el))
    return () => observer.disconnect()
  }, [])

  const fromContext = useMemo(() => {
    const sp = new URLSearchParams(location.search)
    return sp.get("from")
  }, [location.search])

  const fromLabel = fromContext ? FROM_LABELS[fromContext] ?? null : null

  function registerSection(el: HTMLElement | null, id: string) {
    if (el) {
      sectionRefs.current.set(id, el)
    } else {
      sectionRefs.current.delete(id)
    }
  }

  return (
    <div className="space-y-4">
      {/* Page header */}
      <div>
        <div className="c-kicker mb-2">GENERAL · 上手与帮助</div>
        <h1 className="text-[22px] font-semibold tracking-tight text-[var(--ink)] leading-tight">
          使用指南
        </h1>
        <p className="mt-1.5 text-[13px] text-[var(--brand-muted)] max-w-2xl leading-relaxed">
          搞清楚 caller / responder / hotline 是什么 · 5 分钟跑通第一次调用 · 审批与白名单 · 故障排查 · 反馈渠道。
        </p>
        {fromLabel && (
          <p className="mt-2 inline-flex items-center gap-1 text-[11.5px] text-[var(--brand-muted)] bg-[color-mix(in_oklab,var(--brand-orange)_8%,transparent)] border border-[color-mix(in_oklab,var(--brand-orange)_25%,transparent)] rounded px-2 py-0.5">
            ← 从 {fromLabel} 跳过来
          </p>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[200px_1fr] gap-6">
        {/* Sticky TOC */}
        <nav
          aria-label="目录"
          className="lg:sticky lg:top-4 self-start lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto"
        >
          <ol className="space-y-0.5 text-[12.5px]">
            {SECTIONS.map((s) => {
              const Icon = s.icon
              const active = activeId === s.id
              return (
                <li key={s.id}>
                  <a
                    href={`#${s.id}`}
                    className={`flex items-center gap-1.5 px-2 py-1.5 rounded transition-colors ${
                      active
                        ? "bg-[color-mix(in_oklab,var(--brand-orange)_10%,transparent)] text-[var(--ink)] font-semibold"
                        : "text-[var(--brand-muted)] hover:text-[var(--ink)] hover:bg-[color-mix(in_oklab,var(--ink)_4%,transparent)]"
                    }`}
                  >
                    <Icon
                      className={`h-3.5 w-3.5 shrink-0 ${active ? "text-[var(--brand-orange)]" : ""}`}
                      strokeWidth={2.25}
                    />
                    <span className="font-mono opacity-70 w-3.5 text-center">{s.number}</span>
                    <span className="truncate">{s.title}</span>
                  </a>
                </li>
              )
            })}
          </ol>
          <div className="mt-3 pt-3 border-t border-[var(--border)] text-[11px] text-[var(--brand-muted)]">
            找不到答案？查看 <Link to="/help#feedback" className="text-[var(--ink)] underline underline-offset-2">反馈渠道</Link>。
          </div>
        </nav>

        {/* Articles */}
        <div className="space-y-10 max-w-3xl">
          <Section1 register={registerSection} />
          <Section2 register={registerSection} />
          <Section3 register={registerSection} />
          <Section4 register={registerSection} />
          <Section5 register={registerSection} />
          <Section6 register={registerSection} />
          <Section7 register={registerSection} />
          <Section8 register={registerSection} />
        </div>
      </div>
    </div>
  )
}

const FROM_LABELS: Record<string, string> = {
  "approvals-tired-banner": "审批中心 · 审批疲劳横幅",
  "approvals-add-whitelist": "审批中心 · 加白名单",
  "calls-retry": "调用记录 · 重试",
  "dashboard-onboarding": "Dashboard · 引导步骤",
  "dashboard-nextup": "Dashboard · 下一步推荐",
}

// ─── helpers ─────────────────────────────────────────────────────────

interface SectionProps {
  register: (el: HTMLElement | null, id: string) => void
}

function SectionShell({
  id,
  number,
  title,
  intro,
  children,
  register,
}: {
  id: string
  number: number
  title: string
  intro: string
  children: React.ReactNode
  register: SectionProps["register"]
}) {
  return (
    <section
      id={id}
      ref={(el) => register(el, id)}
      className="scroll-mt-6 space-y-3"
    >
      <header className="space-y-1">
        <p className="text-[11px] font-mono text-[var(--brand-muted)] tracking-wide uppercase">
          第 {number} 章
        </p>
        <h2 className="text-[18px] font-semibold tracking-tight text-[var(--ink)] leading-tight">
          {title}
        </h2>
        <p className="text-[13px] text-[var(--brand-muted)] leading-relaxed">
          {intro}
        </p>
      </header>
      <div className="space-y-3 text-[13px] leading-relaxed text-[var(--ink)]">
        {children}
      </div>
    </section>
  )
}

function P({ children }: { children: React.ReactNode }) {
  return <p className="leading-relaxed">{children}</p>
}

function Code({ children }: { children: React.ReactNode }) {
  return (
    <code className="console-mono text-[12px] bg-[color-mix(in_oklab,var(--ink)_5%,transparent)] px-1 py-0.5 rounded">
      {children}
    </code>
  )
}

function Callout({
  tone = "info",
  title,
  children,
}: {
  tone?: "info" | "warn" | "good"
  title?: string
  children: React.ReactNode
}) {
  const palette =
    tone === "warn"
      ? "border-l-amber-500 bg-amber-50/70"
      : tone === "good"
        ? "border-l-green-500 bg-green-50/70"
        : "border-l-cyan-500 bg-cyan-50/70"
  return (
    <div className={`border-l-[3px] ${palette} px-3 py-2 rounded-r`}>
      {title && <p className="font-semibold text-[12.5px] mb-0.5">{title}</p>}
      <div className="text-[12.5px] leading-relaxed text-[var(--ink)]">
        {children}
      </div>
    </div>
  )
}

function CtaRow({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap gap-2 pt-1">{children}</div>
  )
}

function CtaPrimary({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <Link
      to={to}
      className="inline-flex items-center gap-1 rounded bg-[var(--brand-orange)] px-3 py-1.5 text-[12.5px] font-semibold text-white hover:opacity-90"
    >
      {children}
      <ChevronRight className="h-3.5 w-3.5" />
    </Link>
  )
}

function CtaLink({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <Link
      to={to}
      className="inline-flex items-center gap-1 rounded border border-[var(--border)] bg-white px-3 py-1.5 text-[12.5px] font-semibold text-[var(--ink)] hover:bg-[color-mix(in_oklab,var(--ink)_4%,transparent)]"
    >
      {children}
      <ChevronRight className="h-3.5 w-3.5" />
    </Link>
  )
}

// ─── chapter 1 · what is Caller / Responder ──────────────────────────

function Section1({ register }: SectionProps) {
  return (
    <SectionShell
      id="what-is-caller"
      number={1}
      title="什么是 Caller / Responder"
      intro="如果你刚到这个 console 看着满屏选项不知道哪个是给你的——这一章决定你后面应该把时间花在哪边。"
      register={register}
    >
      <P>
        Delegated Execution 系统里只有两种角色，它们正交存在，<strong>同一个账户可以同时是两边</strong>：
      </P>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Callout tone="info" title="Caller · 我让 Agent 帮我调东西">
          你（或你的 Agent / 应用）想用某个能力，不想自己实现。你在 console 里浏览
          <Link to="/caller/catalog" className="text-cyan-700 underline underline-offset-2 mx-1">Hotline 目录</Link>
          、点「试拨」、批准 Agent 的请求、看
          <Link to="/caller/calls" className="text-cyan-700 underline underline-offset-2 mx-1">调用记录</Link>。
          关心的事：能不能调通、要不要审批、结果对不对。
        </Callout>
        <Callout tone="good" title="Responder · 我把能力发布给别人调">
          你有一个本地脚本 / 服务 / 模型，想让别人能定向调用它。你在
          <Link to="/responder/hotlines" className="text-cyan-700 underline underline-offset-2 mx-1">Hotline 管理</Link>
          里发布
          <Link to="/help#what-is-hotline" className="text-cyan-700 underline underline-offset-2 mx-1">Hotline</Link>，
          维护它的契约、定价（计划中）、平均响应时间。
          关心的事：调用进来时执行成功率、平均时延、审核状态。
        </Callout>
      </div>
      <P>
        Sidebar 上 <Code>caller/*</Code> 是 caller 视角的页，<Code>responder/*</Code> 是 responder 视角的页，
        <Code>general/*</Code>（Dashboard / Runtime / 传输配置）是与角色无关的"基础设施层"。Caller 完全可以一辈子不去 Responder 区，反之亦然。
      </P>
      <CtaRow>
        <CtaPrimary to="/caller/register">注册 Caller 身份</CtaPrimary>
        <CtaLink to="/responder">查看 Responder 概览</CtaLink>
      </CtaRow>
    </SectionShell>
  )
}

// ─── chapter 2 · 5-minute first call ─────────────────────────────────

function Section2({ register }: SectionProps) {
  return (
    <SectionShell
      id="first-call"
      number={2}
      title="5 分钟跑通第一次调用"
      intro="这一章是『从空白 console 到看到一条 SUCCEEDED 调用记录』的最短路径。中间不绕路 Stripe、不连 Email、不接 Platform。"
      register={register}
    >
      <ol className="list-decimal pl-5 space-y-2.5">
        <li>
          <strong>注册 Caller 身份。</strong>
          打开
          <Link to="/caller/register" className="text-cyan-700 underline underline-offset-2 mx-1">注册 Caller</Link>
          ，只填一个邮箱，提交。模式默认 <Code>local_only</Code>——先不接平台，纯本地走通。
        </li>
        <li>
          <strong>启用 Responder（或别人替你启用）。</strong>
          打开
          <Link to="/responder" className="text-cyan-700 underline underline-offset-2 mx-1">Responder 概览</Link>
          ，按提示初始化本地 responder。你可以选择"先不启用 Responder"——但你就只能调别人发的 hotline，不能自己发布。
        </li>
        <li>
          <strong>有一个 Hotline 可调。</strong>
          全新的本地环境只会有一个 <strong>官方示例 hotline</strong>（<Code>workspace-summary</Code>），它在
          <Link to="/caller/catalog" className="text-cyan-700 underline underline-offset-2 mx-1">Catalog</Link>
          里有 official 标签。本地没有自己发布的 hotline 也没关系，先用这个。
        </li>
        <li>
          <strong>试拨。</strong>
          在 Catalog 选中那个 hotline，点右下「试拨」，弹出抽屉，必填字段已经预填，点「发送调用」。
        </li>
        <li>
          <strong>看结果。</strong>
          成功后会自动跳到
          <Link to="/caller/calls" className="text-cyan-700 underline underline-offset-2 mx-1">调用记录</Link>
          并选中这条新记录。绿色 Outcome 段会展示 <Code>human_summary</Code> + 结构化输出字段。
        </li>
      </ol>
      <Callout tone="warn" title="如果第一次没通——">
        失败时调用记录会显示一个 next-step CTA（重试 / 看日志 / 报告问题）。最常见的失败是 responder 服务没起来或 hotline 还没 enable——优先去
        <Link to="/general/runtime" className="text-cyan-700 underline underline-offset-2 mx-1">Runtime 监控</Link>
        看 PID 和 last_error。
      </Callout>
      <CtaRow>
        <CtaPrimary to="/caller/catalog?from=dashboard-onboarding">打开 Catalog 试拨</CtaPrimary>
        <CtaLink to="/general/runtime">Runtime 监控</CtaLink>
      </CtaRow>
    </SectionShell>
  )
}

// ─── chapter 3 · what is Hotline ─────────────────────────────────────

function Section3({ register }: SectionProps) {
  return (
    <SectionShell
      id="what-is-hotline"
      number={3}
      title="什么是 Hotline"
      intro="Hotline 不是 API、也不是 webhook、也不是 OpenAPI 规范——它是『API + Schema + 审批策略 + 计费契约』的复合体。把它当成一台『可以委托别人帮你做事的电话』理解。"
      register={register}
    >
      <P>每条 Hotline 至少包含：</P>
      <ul className="list-disc pl-5 space-y-1.5">
        <li>
          <strong>身份：</strong>稳定 ID（<Code>foxlab.text.classifier.v1</Code>）+ display name + 描述 + task_types/tags
        </li>
        <li>
          <strong>契约：</strong><Code>input_schema</Code>（哪些字段、type、是否必填）+ <Code>output_schema</Code>（返回什么）+ <Code>output_display_hints</Code>（哪个字段是 primary、字段顺序、字段标签）
        </li>
        <li>
          <strong>使用建议：</strong>什么场景适合 / 不适合调用（<Code>recommended</Code> / <Code>limitations</Code>）
        </li>
        <li>
          <strong>审批/计费策略</strong>（计划中）：调用前是否需要 caller 同意、最高扣费上限、计价模型
        </li>
      </ul>
      <P>
        当你点「试拨」时 ops-console 是按 <Code>input_schema</Code> 自动渲染表单的——所以发布 hotline 时把 schema 写好，对调用方体验影响很大。Schema 可以参考 Catalog 里
        <Link to="/caller/catalog" className="text-cyan-700 underline underline-offset-2 mx-1">官方 example hotline</Link>
        的字段结构。
      </P>
      <Callout tone="info" title="一个常见误解">
        Hotline 不是某个 LLM/Agent 本身，也不是某个外部 API 的 thin wrapper。它定义的是"我这边愿意以什么契约向外提供这件事"——后端用什么实现是 responder 自己的事。
      </Callout>
      <CtaRow>
        <CtaPrimary to="/caller/catalog">浏览 Hotline 目录</CtaPrimary>
        <CtaLink to="/responder/hotlines">发布我的第一条 Hotline</CtaLink>
      </CtaRow>
    </SectionShell>
  )
}

// ─── chapter 4 · approvals & whitelist ───────────────────────────────

function Section4({ register }: SectionProps) {
  return (
    <SectionShell
      id="approvals"
      number={4}
      title="审批与白名单"
      intro="Caller 端默认假设：『Agent 可能在我没看到的地方调出敏感东西』。所以默认走人工审批；信任的 hotline 才加白名单。这一章决定你以后会被多少弹窗打扰。"
      register={register}
    >
      <P>三种审批模式（在 <Link to="/caller/preferences" className="text-cyan-700 underline underline-offset-2">偏好设置</Link> 切换）：</P>
      <div className="space-y-2">
        <Callout tone="info" title="manual · 全部手动审批（默认）">
          每一次 Agent 发起的 hotline 调用都会进
          <Link to="/caller/approvals" className="text-cyan-700 underline underline-offset-2 mx-1">审批中心</Link>
          等你批准。最安全；但用得多了你会被打扰到累。这就是『审批疲劳横幅』(M7) 出现的时候——它是在催你升级到下一档。
        </Callout>
        <Callout tone="good" title="allow_listed · 白名单自动放行（推荐）">
          只对加进白名单的 hotline 自动放行；其他还是走 manual。日常用法：发现某个 hotline 已经手动批准 ≥5 次，就把它加进白名单。
        </Callout>
        <Callout tone="warn" title="allow_all · 全部自动放行">
          所有调用直接放行。仅当你完全控制 Agent 的输出域、且环境隔离时才考虑。从其他模式切到这一档时 console 会强制弹 destructive 确认对话框。
        </Callout>
      </div>
      <P>
        <strong>白名单的两个维度：</strong>白名单可以按 <em>responder 维度</em>（信任整个发布者）或 <em>hotline 维度</em>（信任某个特定接口）。审批中心里点「加入白名单」默认走 <em>hotline 维度</em>，是颗粒度最小最安全的版本。
      </P>
      <Callout tone="warn" title="加白名单后的常见困惑">
        加白名单是<strong>幂等操作</strong>，但只有在 <Code>mode=allow_listed</Code> 时它才会真正影响放行。如果你当前是 <Code>manual</Code> 模式，加白名单只是把名单准备好——还得切到 allow_listed 才会按白名单走。Console 在加白名单后会弹一条 popover 提示你这件事。
      </Callout>
      <CtaRow>
        <CtaPrimary to="/caller/preferences">去切换审批模式</CtaPrimary>
        <CtaLink to="/caller/lists">名单管理</CtaLink>
        <CtaLink to="/caller/approvals">审批中心</CtaLink>
      </CtaRow>
    </SectionShell>
  )
}

// ─── chapter 5 · local vs platform mode ──────────────────────────────

function Section5({ register }: SectionProps) {
  return (
    <SectionShell
      id="platform-mode"
      number={5}
      title="本地模式 vs. 平台模式"
      intro="本地模式 = 你机器上的 caller / responder 互相调；平台模式 = 你接入官方 / 自托管 platform，能调全网公开的 hotline、被全网调用、参与点数计费。这一章是判断你<strong>该不该</strong>开启平台模式的尺。"
      register={register}
    >
      <div className="overflow-x-auto rounded border border-[var(--border)]">
        <table className="w-full text-[12.5px]">
          <thead className="bg-[color-mix(in_oklab,var(--ink)_4%,transparent)]">
            <tr>
              <th className="px-3 py-2 text-left font-semibold">维度</th>
              <th className="px-3 py-2 text-left font-semibold">本地模式（默认）</th>
              <th className="px-3 py-2 text-left font-semibold">平台模式</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)]">
            <tr>
              <td className="px-3 py-2 align-top font-medium">可调用的 hotline</td>
              <td className="px-3 py-2 align-top">仅本机 responder 发布的 + 官方示例</td>
              <td className="px-3 py-2 align-top text-green-700">+ 平台 catalog 上其他人公开的 hotline</td>
            </tr>
            <tr>
              <td className="px-3 py-2 align-top font-medium">谁能调你</td>
              <td className="px-3 py-2 align-top">仅本机 caller</td>
              <td className="px-3 py-2 align-top text-green-700">平台上的远端 caller（受你的审批策略约束）</td>
            </tr>
            <tr>
              <td className="px-3 py-2 align-top font-medium">计费</td>
              <td className="px-3 py-2 align-top">无</td>
              <td className="px-3 py-2 align-top text-green-700">点数（Call Credit）系统，预存扣费 / 接 hotline 赚回</td>
            </tr>
            <tr>
              <td className="px-3 py-2 align-top font-medium">审批与名单</td>
              <td className="px-3 py-2 align-top">完全本地</td>
              <td className="px-3 py-2 align-top">仍由本地 console 决策；平台不强制</td>
            </tr>
            <tr>
              <td className="px-3 py-2 align-top font-medium">网络要求</td>
              <td className="px-3 py-2 align-top">无</td>
              <td className="px-3 py-2 align-top">长连接到 platform API（默认官方实例）</td>
            </tr>
            <tr>
              <td className="px-3 py-2 align-top font-medium">何时该开</td>
              <td className="px-3 py-2 align-top" colSpan={2}>
                <ul className="list-disc pl-5 space-y-0.5">
                  <li><strong>开</strong>：你想用别人的 hotline / 你想发布给别人调 / 你想参与计费</li>
                  <li><strong>不开</strong>：纯本地脚本场景 / 内网受限环境 / 你只想跑示例做一两次试调</li>
                </ul>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <P>
        Dashboard 上有一张
        <Link to="/general" className="text-cyan-700 underline underline-offset-2 mx-1">PlatformValueDisclosure</Link>
        的对比表（折叠态可关闭，session 内不再出现）；它是这张表的实时简化版，会读取你当前的真实状态来判断要不要给你看。
      </P>
      <Callout tone="info" title="开启平台模式后会发生什么">
        Dashboard 顶端的 platform 状态指示从灰色变绿色，Catalog 多出一个「来源 = 平台」的 chip 区分本机 vs. 远端 hotline，调用记录里会出现 <Code>responder_id</Code> = 远端账号的条目，Caller / Responder 偏好也会同步到平台账户。
      </Callout>
      <CtaRow>
        <CtaPrimary to="/general">在 Dashboard 启用平台模式</CtaPrimary>
        <CtaLink to="/general/transport">配置传输方式</CtaLink>
      </CtaRow>
    </SectionShell>
  )
}

// ─── chapter 6 · troubleshooting ─────────────────────────────────────

function Section6({ register }: SectionProps) {
  return (
    <SectionShell
      id="troubleshooting"
      number={6}
      title="常见故障排查"
      intro="按『症状 → 最常见原因 → 怎么自查』组织。看到一个症状先在这里查，再去 GitHub。"
      register={register}
    >
      <Trouble
        title="Responder 连不上 / 调用立刻失败"
        symptoms="试拨返回 UNVERIFIED 或 FAILED-immediate；Calls 详情显示 responder_id 但没有 accepted_at。"
        likely="responder 进程没起来 / hotline 在 ResponderHotlinesPage 没 enable / responder 的 transport 配置（adapter_type=process|http）写错。"
        steps={[
          <>查 <Link to="/general/runtime" className="text-cyan-700 underline underline-offset-2">Runtime 监控</Link>，确认 responder service 是 healthy；</>,
          <>查 <Link to="/responder/hotlines" className="text-cyan-700 underline underline-offset-2">Hotline 管理</Link>，确认对应 hotline 的 enable 开关打开；</>,
          <>process 类型的 hotline，确认 cmd 在终端能跑通；</>,
          <>http 类型的 hotline，确认 url 在本地 curl 能通。</>,
        ]}
      />
      <Trouble
        title="Calls 一直停在 PENDING_APPROVAL"
        symptoms="Catalog 试拨提交后 Calls 列表里有这条记录但状态 PENDING_APPROVAL 不动。"
        likely="审批中心里有一条 pending 没批 / 审批模式是 manual 但用户忘了去批。"
        steps={[
          <>打开 <Link to="/caller/approvals" className="text-cyan-700 underline underline-offset-2">审批中心</Link>，应该能看到对应记录；</>,
          <>批准之后 Calls 详情会自动从 PENDING_APPROVAL 转到 RUNNING / SUCCEEDED；</>,
          <>如果嫌麻烦，去 <Link to="/help#approvals" className="text-cyan-700 underline underline-offset-2">第 4 章审批与白名单</Link> 切模式或加白名单。</>,
        ]}
      />
      <Trouble
        title="平台 API 不可达"
        symptoms="Dashboard 顶端 platform 状态灯红色 / 远端 hotline 在 catalog 里灰掉无法试拨。"
        likely="网络受限 / platform endpoint 写错 / token 过期 / 长连接被防火墙断了。"
        steps={[
          <>查 <Link to="/general/transport" className="text-cyan-700 underline underline-offset-2">传输配置</Link> 里 platform endpoint 是否填对；</>,
          <>用 curl 直接打 <Code>{"<endpoint>/healthz"}</Code> 看能不能通；</>,
          <>如果是公司内网，确认 outbound HTTPS 没被拦截；</>,
          <>不行就先切回本地模式继续工作，拦截定位完再切回来。</>,
        ]}
      />
      <Trouble
        title="审批中心『加白名单』点了之后好像没反应"
        symptoms="点了「加入白名单」toast 提示成功，但下次同一个 hotline 来还是要审批。"
        likely="当前 mode=manual，白名单本身已经加成功，但 manual 模式不读白名单。"
        steps={[
          <>看加白名单后弹出来的 popover——它会告诉你当前模式是否会让白名单生效；</>,
          <>切到 <Code>allow_listed</Code> 模式：<Link to="/caller/preferences" className="text-cyan-700 underline underline-offset-2">偏好设置</Link>；</>,
          <>查名单本身是否真的加成功：<Link to="/caller/lists" className="text-cyan-700 underline underline-offset-2">名单管理</Link>。</>,
        ]}
      />
      <Trouble
        title="调用结果是英文 / 输出格式很乱"
        symptoms="Calls 详情『请求结果』段直接是一坨 JSON，没有 human_summary 或字段标签。"
        likely="Hotline 没声明 output_display_hints / 没有 human_summary 字段。"
        steps={[
          <>这是 hotline 实现的责任——联系发布它的 responder 让他在响应里加 <Code>human_summary</Code>；</>,
          <>临时方案：详情页右上的 raw JSON toggle 至少能让你看到完整数据。</>,
        ]}
      />
    </SectionShell>
  )
}

interface TroubleProps {
  title: string
  symptoms: string
  likely: string
  steps: React.ReactNode[]
}

function Trouble({ title, symptoms, likely, steps }: TroubleProps) {
  return (
    <div className="rounded border border-[var(--border)] p-3 space-y-1.5 bg-white">
      <p className="font-semibold text-[13px] flex items-center gap-1.5">
        <ShieldAlert className="h-3.5 w-3.5 text-amber-600" />
        {title}
      </p>
      <p className="text-[12.5px]">
        <span className="font-medium text-[var(--brand-muted)]">症状：</span>
        {symptoms}
      </p>
      <p className="text-[12.5px]">
        <span className="font-medium text-[var(--brand-muted)]">最可能原因：</span>
        {likely}
      </p>
      <div className="text-[12.5px]">
        <span className="font-medium text-[var(--brand-muted)]">怎么自查：</span>
        <ol className="list-decimal pl-5 mt-0.5 space-y-0.5">
          {steps.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ol>
      </div>
    </div>
  )
}

// ─── chapter 7 · FAQ ─────────────────────────────────────────────────

function Section7({ register }: SectionProps) {
  return (
    <SectionShell
      id="faq"
      number={7}
      title="FAQ"
      intro="只回答 console 里最常被问、又最容易在搜索引擎被错答的 10 条问题。"
      register={register}
    >
      <div className="space-y-3">
        <Q q="我必须接 Stripe 或绑信用卡吗？" a={<>不需要。本地模式完全不涉及计费。平台模式用的是『点数（Call Credit）』系统，预存 + 扣费 + 接 hotline 赚回；初版不开放提现到法币。详细方向见 <a href="https://callanything.xyz/pricing" target="_blank" rel="noreferrer" className="text-cyan-700 underline">brand-site / 计费</a>。</>} />
        <Q q="点数能提现成现金吗？" a={<>当前不可提现。点数是『参与平台调用与发布的内部货币』，不挂钩任何法币兑换体系。</>} />
        <Q q="我同时是 caller 和 responder，要开两个账号吗？" a={<>不需要。同一个账户上 caller 余额和 responder 收益是合并的——你 caller 侧消费扣的就是 responder 侧赚到的同一份点数池。</>} />
        <Q q="LLM 幻觉导致 hotline 返回错误信息算谁的责任？" a={<>责任在发布 hotline 的 responder。协议层不区分『主观恶意』vs.『模型不可控输出』——只要输出有害，responder 都会被记 trust_tier 下调直到 frozen。详细治理立场见 <Link to="/help#approvals" className="text-cyan-700 underline">审批与白名单章</Link> 引用的零信任原则。</>} />
        <Q q="我能改 hotline 的定价吗？" a={<>责任在 responder。Caller 在调用前会看到 preflight 给出的 max_charge 报价并必须显式同意；超出 max_charge 的部分由 responder 自负，不会自动扣 caller 多余点数。</>} />
        <Q q="把所有 hotline 都加白名单算白名单模式生效吗？" a={<>不算。白名单是数据，模式才是开关。把全网 hotline 加进白名单 + mode=manual 等于白白做了体力活。如果你的意图就是『只要在白名单上的都自动放』，请同时把模式切到 <Code>allow_listed</Code>。</>} />
        <Q q="本地模式能测试别人发布的 hotline 吗？" a={<>不能。Catalog 在本地模式下只列你自己 responder 发布的 + 官方示例。要看全网 hotline，必须开平台模式。</>} />
        <Q q="重启电脑后 console 数据会丢吗？" a={<>不会。设置、白名单、调用记录都持久化在 <Code>$DELEXEC_HOME</Code>（默认是 <Code>~/.delexec</Code>）。备份这个目录就等于备份了整个 console。</>} />
        <Q q="一定要开 Email 才能用吗？" a={<>不一定。注册 Caller 时填邮箱，但默认 transport 是本地 IPC——不会真的发邮件。Email 作为通讯通道是个独立 transport（见 <Link to="/general/transport" className="text-cyan-700 underline">传输配置</Link>），目前是 feature-present 但不是默认主路径。</>} />
        <Q q="我看到的『审批疲劳横幅』是怎么算的？" a={<>三个触发条件，任一满足都会显示——同 hotline 7 天内手动批准 ≥5 次 / mode=manual 且 30 天内手动批准 ≥20 次 / 当前 pending ≥5 条。横幅 × 关掉之后 24h 内不会再出现，下次打开页面重新评估。</>} />
      </div>
      <CtaRow>
        <CtaLink to="/help#feedback">没找到我的问题</CtaLink>
      </CtaRow>
    </SectionShell>
  )
}

function Q({ q, a }: { q: string; a: React.ReactNode }) {
  return (
    <details className="rounded border border-[var(--border)] bg-white px-3 py-2 group">
      <summary className="cursor-pointer text-[13px] font-semibold text-[var(--ink)] list-none flex items-center justify-between gap-2">
        <span>{q}</span>
        <ChevronRight className="h-3.5 w-3.5 transition-transform group-open:rotate-90" />
      </summary>
      <div className="mt-2 text-[12.5px] leading-relaxed">{a}</div>
    </details>
  )
}

// ─── chapter 8 · feedback ────────────────────────────────────────────

function Section8({ register }: SectionProps) {
  return (
    <SectionShell
      id="feedback"
      number={8}
      title="反馈与报告问题"
      intro="开源项目，反馈进来的 issue 会被处理。但请先把基本信息凑齐——你帮我们快定位 = 你早一点拿到修复。"
      register={register}
    >
      <P><strong>三步：</strong></P>
      <ol className="list-decimal pl-5 space-y-2">
        <li>
          <strong>打 diagnostic-bundle。</strong>在终端运行：
          <pre className="mt-1 console-mono text-[11.5px] bg-[color-mix(in_oklab,var(--ink)_5%,transparent)] p-2 rounded overflow-x-auto">node apps/ops/src/cli.js diagnostic-bundle &gt; bundle.txt</pre>
          这个 bundle 包含本机 supervisor 状态、最近 100 条调用记录的 metadata（不含输入输出 payload）、版本号、配置摘要——不含敏感数据。
        </li>
        <li>
          <strong>记下 request_id。</strong>如果是某条调用出问题，从
          <Link to="/caller/calls" className="text-cyan-700 underline underline-offset-2 mx-1">调用记录</Link>
          详情面板右上 mono 区复制。
        </li>
        <li>
          <strong>提 issue。</strong>到
          <a href="https://github.com/hejiajiudeeyu/delegated-execution-client/issues/new" target="_blank" rel="noreferrer" className="text-cyan-700 underline underline-offset-2 mx-1">GitHub issues</a>
          。模板预设了"复现步骤 / 期望行为 / 实际行为 / bundle / request_id"四段，请尽量都填。
        </li>
      </ol>
      <Callout tone="info" title="不会公开但又想让我们看的">
        如果 issue 内容涉及 hotline 内部 schema、未公开的 platform 部署细节，发邮件到
        <a href="mailto:opc-feedback@callanything.xyz" className="text-cyan-700 underline underline-offset-2 mx-1">opc-feedback@callanything.xyz</a>
        ；附上 bundle 与 request_id 即可，邮件不会自动转 issue。
      </Callout>
      <CtaRow>
        <CtaLink to="/general/runtime">查看 Runtime 监控</CtaLink>
      </CtaRow>
    </SectionShell>
  )
}
