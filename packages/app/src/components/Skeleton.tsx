export interface SkeletonProps {
  width?: string
  height?: string
  rounded?: "none" | "sm" | "md" | "lg" | "full"
  className?: string
}

export function Skeleton({ width = "w-full", height = "h-4", rounded = "md", className = "" }: SkeletonProps) {
  const roundedMap = { none: "", sm: "rounded-sm", md: "rounded-md", lg: "rounded-lg", full: "rounded-full" }
  return <div className={`animate-pulse bg-slate-200 ${width} ${height} ${roundedMap[rounded]} ${className}`} />
}

export function SkeletonText({ lines = 3 }: { lines?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} width={i === lines - 1 ? "w-3/4" : "w-full"} />
      ))}
    </div>
  )
}
