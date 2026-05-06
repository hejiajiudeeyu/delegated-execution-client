import { useState } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { ChevronDown, ChevronRight, ExternalLink, Info, X } from "lucide-react"

const SESSION_DISMISS_KEY = "dashboard.platform-value-table.dismissed"

interface PlatformValueDisclosureProps {
  onEnable: () => void
  toggling: boolean
  platformUrl: string
}

interface RowSpec {
  dimension: string
  local: string
  platform: string
}

const ROWS: RowSpec[] = [
  {
    dimension: "Catalog 来源",
    local: "仅本机 Responder 提供的 hotline",
    platform: "本机 + 平台社区已发布的 hotline",
  },
  {
    dimension: "Hotline 可见性",
    local: "仅自己",
    platform: "可发布给他人发现 / 调用",
  },
  {
    dimension: "隐私边界",
    local: "完全本地，零网络",
    platform: "hotline 元数据会同步到平台；调用输入仍在本机 Responder 进程",
  },
  {
    dimension: "需要的网络",
    local: "无",
    platform: "平台 API 可达",
  },
  {
    dimension: "适合",
    local: "个人脚本 / 内网工具 / 隐私敏感场景",
    platform: "想找现成 hotline 用 / 想把能力分享出去",
  },
]

export function PlatformValueDisclosure({ onEnable, toggling, platformUrl }: PlatformValueDisclosureProps) {
  const [dismissed, setDismissed] = useState<boolean>(() => {
    if (typeof sessionStorage === "undefined") return false
    return sessionStorage.getItem(SESSION_DISMISS_KEY) === "1"
  })
  const [open, setOpen] = useState(false)

  if (dismissed) return null

  const handleDismiss = () => {
    if (typeof sessionStorage !== "undefined") {
      sessionStorage.setItem(SESSION_DISMISS_KEY, "1")
    }
    setDismissed(true)
  }

  return (
    <Card className="border-dashed bg-muted/20">
      <CardContent className="p-3">
        <Collapsible open={open} onOpenChange={setOpen}>
          <div className="flex items-center justify-between gap-3">
            <CollapsibleTrigger asChild>
              <button
                type="button"
                className="flex items-center gap-2 text-left text-sm font-medium text-foreground hover:text-foreground/80"
              >
                {open ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
                <Info className="h-3.5 w-3.5 text-muted-foreground" />
                了解平台模式可以多做什么
              </button>
            </CollapsibleTrigger>
            <button
              type="button"
              onClick={handleDismiss}
              className="text-muted-foreground hover:text-foreground"
              aria-label="本会话不再显示"
              title="本会话不再显示"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <CollapsibleContent className="pt-3">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-xs">
                <thead>
                  <tr className="border-b border-border">
                    <th className="py-1.5 pr-3 text-left font-semibold text-muted-foreground">维度</th>
                    <th className="py-1.5 px-3 text-left font-semibold">本地模式（当前）</th>
                    <th className="py-1.5 pl-3 text-left font-semibold">平台模式</th>
                  </tr>
                </thead>
                <tbody>
                  {ROWS.map((row) => (
                    <tr key={row.dimension} className="border-b border-border/40 last:border-0">
                      <td className="py-2 pr-3 align-top text-muted-foreground">{row.dimension}</td>
                      <td className="py-2 px-3 align-top leading-relaxed">{row.local}</td>
                      <td className="py-2 pl-3 align-top leading-relaxed">{row.platform}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-3 flex items-center justify-between gap-3 text-xs">
              <p className="text-muted-foreground">
                Platform URL: <code className="rounded bg-muted px-1 font-mono">{platformUrl}</code>
              </p>
              <div className="flex items-center gap-3">
                <a
                  href="/help#platform-mode"
                  className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
                >
                  阅读完整说明
                  <ExternalLink className="h-3 w-3" />
                </a>
                <Button size="sm" disabled={toggling} onClick={onEnable}>
                  {toggling ? "切换中…" : "开启平台模式"}
                </Button>
              </div>
            </div>
          </CollapsibleContent>
        </Collapsible>
      </CardContent>
    </Card>
  )
}
