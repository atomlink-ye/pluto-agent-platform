export function CompactionMarker({ dark }: { dark?: boolean }) {
  const borderClass = dark ? "border-slate-700" : "border-slate-200"
  const textClass = dark ? "text-slate-500" : "text-slate-400"

  return (
    <div className="flex items-center gap-3 py-2">
      <div className={`flex-1 border-t ${borderClass}`} />
      <span className={`text-xs ${textClass}`}>context compacted</span>
      <div className={`flex-1 border-t ${borderClass}`} />
    </div>
  )
}
