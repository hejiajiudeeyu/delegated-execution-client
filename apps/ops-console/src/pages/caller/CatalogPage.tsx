import { useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { requestJson } from "@/lib/api"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Search, Zap } from "lucide-react"

interface HotlineItem {
  hotline_id: string
  display_name?: string
  responder_id?: string
  description?: string
  tags?: string[]
  status?: string
  task_types?: string[]
}

export function CatalogPage() {
  const navigate = useNavigate()
  const [items, setItems] = useState<HotlineItem[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState("")

  useEffect(() => {
    requestJson<{ items: HotlineItem[] }>("/catalog/hotlines").then((res) => {
      if (res.body?.items) setItems(res.body.items)
      setLoading(false)
    })
  }, [])

  const filtered = items.filter((item) => {
    const q = query.toLowerCase()
    return (
      !q ||
      item.hotline_id.toLowerCase().includes(q) ||
      (item.display_name ?? "").toLowerCase().includes(q) ||
      (item.description ?? "").toLowerCase().includes(q)
    )
  })

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-base font-bold">Hotline Catalog</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            浏览平台上可用的 Hotline
          </p>
        </div>
      </div>

      <div className="relative max-w-xs">
        <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
        <Input
          placeholder="搜索 Hotline…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="pl-8 text-sm"
        />
      </div>

      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="py-12 text-center text-sm text-muted-foreground">
          {query ? "没有匹配的 Hotline" : "暂无可用 Hotline"}
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((item) => (
            <Card key={item.hotline_id} className="hover:border-teal-500/50 transition-colors">
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold truncate">
                        {item.display_name ?? item.hotline_id}
                      </span>
                      <Badge
                        variant="outline"
                        className="text-[10px] border-pink-500/40 text-pink-600 shrink-0"
                      >
                        Hotline
                      </Badge>
                    </div>
                    <p className="text-xs font-mono text-muted-foreground mt-0.5 truncate">
                      {item.hotline_id}
                    </p>
                    {item.description && (
                      <p className="text-xs text-muted-foreground mt-1.5 line-clamp-2">
                        {item.description}
                      </p>
                    )}
                    {item.tags && item.tags.length > 0 && (
                      <div className="flex gap-1 mt-2 flex-wrap">
                        {item.tags.map((tag) => (
                          <Badge key={tag} variant="secondary" className="text-[10px]">
                            {tag}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="shrink-0 border-teal-500/40 text-teal-600 hover:bg-teal-500/10"
                    onClick={() =>
                      navigate(`/caller/calls/new?hotline_id=${encodeURIComponent(item.hotline_id)}`)
                    }
                  >
                    <Zap className="h-3.5 w-3.5 mr-1" />
                    调用
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
