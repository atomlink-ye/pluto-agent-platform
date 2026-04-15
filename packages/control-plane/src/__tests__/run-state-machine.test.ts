import type { RunStatus } from "@pluto-agent-platform/contracts"
import { describe, expect, it } from "vitest"

import {
  canTransition,
  isTerminalRunStatus,
  TERMINAL_RUN_STATUSES,
  transition,
} from "../services/run-state-machine.js"

const validTransitions: Array<[RunStatus, RunStatus]> = [
  ["queued", "initializing"],
  ["initializing", "running"],
  ["initializing", "failed"],
  ["running", "blocked"],
  ["running", "waiting_approval"],
  ["running", "failing"],
  ["running", "failed"],
  ["running", "succeeded"],
  ["running", "canceled"],
  ["blocked", "running"],
  ["blocked", "failed"],
  ["blocked", "canceled"],
  ["waiting_approval", "running"],
  ["waiting_approval", "failed"],
  ["waiting_approval", "canceled"],
  ["failing", "running"],
  ["failing", "failed"],
  ["failed", "archived"],
  ["succeeded", "archived"],
  ["canceled", "archived"],
]

const invalidTransitions: Array<[RunStatus, RunStatus]> = [
  ["queued", "running"],
  ["initializing", "succeeded"],
  ["succeeded", "running"],
  ["archived", "queued"],
  ["running", "queued"],
]

const terminalStatuses: RunStatus[] = ["failed", "succeeded", "canceled", "archived"]
const nonTerminalStatuses: RunStatus[] = [
  "queued",
  "initializing",
  "running",
  "blocked",
  "waiting_approval",
  "failing",
]

describe("run state machine", () => {
  describe("valid transitions", () => {
    it.each(validTransitions)("allows %s -> %s", (from, to) => {
      expect(canTransition(from, to)).toBe(true)
      expect(transition(from, to)).toBe(to)
    })
  })

  describe("invalid transitions", () => {
    it.each(invalidTransitions)("rejects %s -> %s", (from, to) => {
      expect(canTransition(from, to)).toBe(false)
      expect(() => transition(from, to)).toThrow(`Invalid run status transition: ${from} -> ${to}`)
    })
  })

  describe("TERMINAL_RUN_STATUSES", () => {
    it("contains exactly the terminal statuses", () => {
      expect([...TERMINAL_RUN_STATUSES]).toEqual(terminalStatuses)
      expect(TERMINAL_RUN_STATUSES.size).toBe(terminalStatuses.length)
    })

    it("does not contain non-terminal statuses", () => {
      for (const status of nonTerminalStatuses) {
        expect(TERMINAL_RUN_STATUSES.has(status)).toBe(false)
      }
    })
  })

  describe("isTerminalRunStatus", () => {
    it.each(terminalStatuses)("returns true for %s", (status) => {
      expect(isTerminalRunStatus(status)).toBe(true)
    })

    it.each(nonTerminalStatuses)("returns false for %s", (status) => {
      expect(isTerminalRunStatus(status)).toBe(false)
    })
  })
})
