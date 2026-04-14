const BASE = "/api"

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error ?? `Request failed: ${res.status}`)
  }
  const body = await res.json()
  return body.data
}

export const api = {
  playbooks: {
    list: () => request<any[]>("/playbooks"),
    get: (id: string) => request<any>(`/playbooks/${id}`),
    create: (data: any) => request<any>("/playbooks", { method: "POST", body: JSON.stringify(data) }),
  },
  harnesses: {
    list: () => request<any[]>("/harnesses"),
    get: (id: string) => request<any>(`/harnesses/${id}`),
    create: (data: any) => request<any>("/harnesses", { method: "POST", body: JSON.stringify(data) }),
    attach: (harnessId: string, playbookId: string) =>
      request<any>(`/harnesses/${harnessId}/attach/${playbookId}`, { method: "POST" }),
  },
  runs: {
    list: () => request<any[]>("/runs"),
    get: (id: string) => request<any>(`/runs/${id}`),
    create: (data: { playbookId: string; harnessId: string; inputs?: Record<string, unknown> }) =>
      request<any>("/runs", { method: "POST", body: JSON.stringify(data) }),
  },
  approvals: {
    list: (status?: string) =>
      request<any[]>(status ? `/approvals?status=${encodeURIComponent(status)}` : "/approvals"),
    listByRun: (runId: string) => request<any[]>(`/runs/${runId}/approvals`),
    resolve: (id: string, data: { decision: string; note?: string }) =>
      request<any>(`/approvals/${id}/resolve`, { method: "POST", body: JSON.stringify(data) }),
  },
  artifacts: {
    listByRun: (runId: string) => request<any[]>(`/runs/${runId}/artifacts`),
  },
  events: {
    listByRun: (runId: string) => request<any[]>(`/runs/${runId}/events`),
  },
}
