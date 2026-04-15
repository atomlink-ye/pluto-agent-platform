import type { TodoListItem } from "../types/paseo"

export function TodoListBlock({ item, dark }: { item: TodoListItem; dark?: boolean }) {
  const containerClass = dark
    ? "max-w-[75%] rounded-lg bg-slate-800 border border-slate-700 p-3"
    : "max-w-[75%] rounded-lg bg-white border border-slate-200 p-3"
  const labelClass = dark ? "text-xs font-medium text-slate-400 mb-2" : "text-xs font-medium text-slate-500 mb-2"

  return (
    <div className="flex justify-start">
      <div className={containerClass}>
        <p className={labelClass}>Tasks</p>
        <ul className="space-y-1">
          {item.items.map((entry) => {
            const checkboxClass = entry.done
              ? dark ? "border-emerald-700 bg-emerald-900/50 text-emerald-400" : "border-emerald-300 bg-emerald-50 text-emerald-600"
              : dark ? "border-slate-600 bg-slate-700" : "border-slate-300 bg-white"
            const textClass = entry.done
              ? dark ? "text-slate-500 line-through" : "text-slate-400 line-through"
              : dark ? "text-slate-200" : "text-slate-700"
            return (
              <li key={entry.id} className="flex items-center gap-2 text-sm">
                <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${checkboxClass}`}>
                  {entry.done ? (
                    <svg className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                  ) : null}
                </span>
                <span className={textClass}>{entry.text}</span>
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}
