import { Navigate, Route, Routes } from "react-router-dom"

import { Layout } from "./components/Layout"
import { PaseoSocketProvider } from "./hooks/PaseoSocketContext"
import { ToastProvider } from "./hooks/useToast"
import { ApprovalsPage } from "./pages/ApprovalsPage"
import { ChatPage } from "./pages/ChatPage"
import { DashboardPage } from "./pages/DashboardPage"
import { PlaybookDetailPage } from "./pages/PlaybookDetailPage"
import { PlaybookFormPage } from "./pages/PlaybookFormPage"
import { PlaybookListPage } from "./pages/PlaybookListPage"
import { RunDetailPage } from "./pages/RunDetailPage"
import { RunListPage } from "./pages/RunListPage"

export function App() {
  return (
    <PaseoSocketProvider>
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
            <Route path="runs/:id/agents/:agentId/chat" element={<ChatPage />} />
            <Route path="approvals" element={<ApprovalsPage />} />
          </Route>
        </Routes>
      </ToastProvider>
    </PaseoSocketProvider>
  )
}
