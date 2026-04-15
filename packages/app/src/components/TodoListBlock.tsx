import type { TodoListItem } from "../types/paseo"

export function TodoListBlock({ item }: { item: TodoListItem }) {
  return (
    <div className="flex justify-start">
      <div className="max-w-[75%] rounded-lg bg-white border border-slate-200 p-3">
        <p className="text-xs font-medium text-slate-500 mb-2">Tasks</p>
        <ul className="space-y-1">
          {item.items.map((entry) => (
            <li key={entry.id} className="flex items-center gap-2 text-sm">
              <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${entry.done ? "border-emerald-300 bg-emerald-50 text-emerald-600" : "border-slate-300 bg-white"}`}>
                {entry.done ? (
                  <svg className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                ) : null}
              </span>
              <span className={entry.done ? "text-slate-400 line-through" : "text-slate-700"}>{entry.text}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
