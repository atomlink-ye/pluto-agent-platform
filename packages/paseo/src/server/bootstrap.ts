import express from "express";
import { createServer as createHTTPServer } from "node:http";
import { unlink } from "node:fs/promises";
import path from "node:path";
import type { AddressInfo } from "node:net";
import type { Logger } from "pino";

import { AgentManager } from "./agent/agent-manager.js";
import { AgentStorage } from "./agent/agent-storage.js";
import type { AgentClient, AgentProvider } from "./agent/agent-sdk-types.js";

export type ListenTarget =
  | { type: "tcp"; host: string; port: number }
  | { type: "socket"; path: string }
  | { type: "pipe"; path: string };

const WINDOWS_DRIVE_RE = /^[A-Za-z]:\\/;

export function parseListenString(listen: string): ListenTarget {
  if (listen.startsWith("\\\\.\\pipe\\") || listen.startsWith("pipe://")) {
    return {
      type: "pipe",
      path: listen.startsWith("pipe://") ? listen.slice("pipe://".length) : listen,
    };
  }

  if (listen.startsWith("unix://")) {
    return { type: "socket", path: listen.slice(7) };
  }

  if (WINDOWS_DRIVE_RE.test(listen)) {
    throw new Error(`Invalid listen string (Windows path is not a valid listen target): ${listen}`);
  }

  if (listen.startsWith("/") || listen.startsWith("~")) {
    return { type: "socket", path: listen };
  }

  const trimmed = listen.trim();
  if (/^\d+$/.test(trimmed)) {
    return { type: "tcp", host: "127.0.0.1", port: Number.parseInt(trimmed, 10) };
  }

  if (listen.includes(":")) {
    const [host, portStr] = listen.split(":");
    const parsedPort = Number.parseInt(portStr, 10);
    if (!Number.isFinite(parsedPort)) {
      throw new Error(`Invalid port in listen string: ${listen}`);
    }
    return { type: "tcp", host: host || "127.0.0.1", port: parsedPort };
  }

  throw new Error(`Invalid listen string: ${listen}`);
}

function formatListenTarget(listenTarget: ListenTarget | null): string | null {
  if (!listenTarget) {
    return null;
  }
  return listenTarget.type === "tcp"
    ? `${listenTarget.host}:${listenTarget.port}`
    : listenTarget.path;
}

export type PaseoDaemonConfig = {
  listen: string;
  paseoHome: string;
  corsAllowedOrigins?: string[];
  staticDir?: string;
  agentClients?: Partial<Record<AgentProvider, AgentClient>>;
  agentStoragePath?: string;
  maxTimelineItems?: number;
};

export interface PaseoDaemon {
  config: PaseoDaemonConfig;
  agentManager: AgentManager;
  agentStorage: AgentStorage;
  start(): Promise<void>;
  stop(): Promise<void>;
  getListenTarget(): ListenTarget | null;
}

export async function createPaseoDaemon(
  config: PaseoDaemonConfig,
  rootLogger: Logger,
): Promise<PaseoDaemon> {
  const logger = rootLogger.child({ module: "bootstrap" });
  const listenTarget = parseListenString(config.listen);
  const app = express();
  const agentStoragePath = config.agentStoragePath ?? path.join(config.paseoHome, "agents");
  const agentStorage = new AgentStorage(agentStoragePath, logger);
  await agentStorage.initialize();

  const agentManager = new AgentManager({
    logger,
    registry: agentStorage,
    clients: config.agentClients,
    maxTimelineItems: config.maxTimelineItems,
  });

  app.use(express.json({ limit: "2mb" }));

  if (config.corsAllowedOrigins?.length) {
    const allowedOrigins = new Set(config.corsAllowedOrigins);
    app.use((req, res, next) => {
      const origin = req.headers.origin;
      if (origin && (allowedOrigins.has("*") || allowedOrigins.has(origin))) {
        res.setHeader("Access-Control-Allow-Origin", origin);
        res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
        res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
      }
      if (req.method === "OPTIONS") {
        res.sendStatus(204);
        return;
      }
      next();
    });
  }

  if (config.staticDir) {
    app.use(express.static(config.staticDir));
  }

  let boundListenTarget: ListenTarget | null = null;
  let httpServer: ReturnType<typeof createHTTPServer> | null = null;

  app.get("/health", (_req, res) => {
    res.json({
      ok: true,
      listen: formatListenTarget(boundListenTarget),
      agents: agentManager.listAgents().length,
    });
  });

  return {
    config,
    agentManager,
    agentStorage,
    async start() {
      if (httpServer) {
        return;
      }

      const server = createHTTPServer(app);
      httpServer = server;

      await new Promise<void>((resolvePromise, reject) => {
        server.once("error", reject);

        if (listenTarget.type === "tcp") {
          server.listen(listenTarget.port, listenTarget.host, () => resolvePromise());
          return;
        }

        const socketPath = path.resolve(listenTarget.path);
        unlink(socketPath)
          .catch(() => undefined)
          .finally(() => {
            server.listen(socketPath, () => resolvePromise());
          });
      });

      if (listenTarget.type === "tcp") {
        const address = server.address() as AddressInfo | null;
        boundListenTarget = address
          ? { type: "tcp", host: listenTarget.host, port: address.port }
          : listenTarget;
      } else {
        boundListenTarget = listenTarget;
      }

      logger.info({ listen: formatListenTarget(boundListenTarget) }, "Paseo daemon started");
    },
    async stop() {
      const server = httpServer;
      if (!server) {
        await agentStorage.flush();
        return;
      }

      httpServer = null;
      await new Promise<void>((resolvePromise, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolvePromise();
        });
      });
      boundListenTarget = null;
      await agentStorage.flush();
      logger.info("Paseo daemon stopped");
    },
    getListenTarget() {
      return boundListenTarget;
    },
  };
}
