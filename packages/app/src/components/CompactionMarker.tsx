export function CompactionMarker() {
  return (
    <div className="flex items-center gap-3 py-2">
      <div className="flex-1 border-t border-slate-200" />
      <span className="text-xs text-slate-400">context compacted</span>
      <div className="flex-1 border-t border-slate-200" />
    </div>
  )
}
