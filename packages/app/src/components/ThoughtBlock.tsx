import type { ThoughtItem } from "../types/paseo"

export function ThoughtBlock({ item }: { item: ThoughtItem }) {
  return (
    <div className="flex justify-start">
      <div className="max-w-[75%] rounded-lg bg-slate-50 border border-slate-200 p-3">
        <div className="flex items-center gap-2 text-xs text-slate-500 mb-1">
          {item.status === "loading" ? (
            <svg className="h-3.5 w-3.5 animate-spin text-slate-400" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          ) : (
            <svg className="h-3.5 w-3.5 text-emerald-500" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
            </svg>
          )}
          <span className="font-medium">Thinking</span>
        </div>
        <p className="text-sm text-slate-500 italic whitespace-pre-wrap">{item.text}</p>
      </div>
    </div>
  )
}
