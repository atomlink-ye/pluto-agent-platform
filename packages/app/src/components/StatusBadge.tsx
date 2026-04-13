const statusStyles: Record<string, string> = {
  queued: "bg-gray-100 text-gray-700",
  initializing: "bg-blue-50 text-blue-700",
  running: "bg-blue-100 text-blue-800",
  waiting_approval: "bg-amber-100 text-amber-800",
  blocked: "bg-red-100 text-red-700",
  failing: "bg-red-50 text-red-600",
  failed: "bg-red-100 text-red-800",
  succeeded: "bg-green-100 text-green-800",
  canceled: "bg-gray-100 text-gray-500",
  archived: "bg-gray-50 text-gray-400",
  pending: "bg-amber-100 text-amber-800",
  approved: "bg-green-100 text-green-800",
  denied: "bg-red-100 text-red-800",
  expired: "bg-gray-100 text-gray-500",
  draft: "bg-gray-100 text-gray-600",
  created: "bg-blue-100 text-blue-700",
  registered: "bg-green-100 text-green-700",
}

export function StatusBadge({ status }: { status: string }) {
  const style = statusStyles[status] ?? "bg-gray-100 text-gray-600"
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${style}`}>
      {status.replace(/_/g, " ")}
    </span>
  )
}
