import { Navigate, Route, Routes } from "react-router-dom"

import { Layout } from "./components/Layout"
import { ToastProvider } from "./hooks/useToast"
import { ApprovalsPage } from "./pages/ApprovalsPage"
import { DashboardPage } from "./pages/DashboardPage"
import { PlaybookDetailPage } from "./pages/PlaybookDetailPage"
import { PlaybookFormPage } from "./pages/PlaybookFormPage"
import { PlaybookListPage } from "./pages/PlaybookListPage"
import { RunDetailPage } from "./pages/RunDetailPage"
import { RunListPage } from "./pages/RunListPage"

export function App() {
  return (
    <ToastProvider>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="dashboard" element={<DashboardPage />} />
          <Route path="playbooks" element={<PlaybookListPage />} />
          <Route path="playbooks/new" element={<PlaybookFormPage />} />
          <Route path="playbooks/:id" element={<PlaybookDetailPage />} />
          <Route path="playbooks/:id/edit" element={<PlaybookFormPage />} />
          <Route path="runs" element={<RunListPage />} />
          <Route path="runs/:id" element={<RunDetailPage />} />
          <Route path="approvals" element={<ApprovalsPage />} />
        </Route>
      </Routes>
    </ToastProvider>
  )
}
