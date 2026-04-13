import { Routes, Route, Navigate } from "react-router-dom"
import { Layout } from "./components/Layout"
import { PlaybookListPage } from "./pages/PlaybookListPage"
import { PlaybookDetailPage } from "./pages/PlaybookDetailPage"
import { RunListPage } from "./pages/RunListPage"
import { RunDetailPage } from "./pages/RunDetailPage"

export function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Navigate to="/playbooks" replace />} />
        <Route path="playbooks" element={<PlaybookListPage />} />
        <Route path="playbooks/:id" element={<PlaybookDetailPage />} />
        <Route path="runs" element={<RunListPage />} />
        <Route path="runs/:id" element={<RunDetailPage />} />
      </Route>
    </Routes>
  )
}
