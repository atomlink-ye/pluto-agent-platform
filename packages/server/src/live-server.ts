import type { AddressInfo } from "node:net"

import { createLiveRuntime } from "./live-runtime.js"

const PORT = Number(process.env.PORT ?? 4000)

async function main() {
  const runtime = await createLiveRuntime(process.env)
  const server = runtime.app.listen(PORT, () => {
    const address = server.address() as AddressInfo | null
    const resolvedPort = address?.port ?? PORT

    console.log(`Pluto live server running at http://localhost:${resolvedPort}`)
    console.log(`MCP endpoint: http://localhost:${resolvedPort}/mcp`)
  })

  const shutdown = async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error)
          return
        }
        resolve()
      })
    })
    await runtime.close()
  }

  process.once("SIGINT", () => {
    void shutdown().finally(() => process.exit(0))
  })
  process.once("SIGTERM", () => {
    void shutdown().finally(() => process.exit(0))
  })
}

main().catch((error) => {
  console.error("Failed to start live server:", error)
  process.exit(1)
})
