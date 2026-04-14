import { NavLink, Outlet } from "react-router-dom"

const navItems = [
  { to: "/playbooks", label: "Playbooks" },
  { to: "/runs", label: "Runs" },
  { to: "/approvals", label: "Approvals" },
]

export function Layout() {
  return (
    <div className="flex h-screen bg-gray-50 text-gray-900">
      <aside className="w-56 shrink-0 border-r border-gray-200 bg-white flex flex-col">
        <div className="px-5 py-4 border-b border-gray-200">
          <h1 className="text-lg font-semibold tracking-tight">Pluto</h1>
          <p className="text-xs text-gray-500">Agent Platform</p>
        </div>
        <nav className="flex-1 px-3 py-3 space-y-0.5">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `block px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                  isActive
                    ? "bg-gray-100 text-gray-900"
                    : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
                }`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
      </aside>
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-5xl mx-auto px-6 py-6">
          <Outlet />
        </div>
      </main>
    </div>
  )
}
