import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { chromium, type Browser, type Page } from "playwright"
import { PlaywrightAgent } from "@midscene/web/playwright"

const APP_URL = process.env.UI_APP_URL ?? "http://127.0.0.1:3000"
const UI_E2E_ENABLED = process.env.UI_E2E === "1"

type MidsceneAgentLike = Pick<PlaywrightAgent, "aiTap" | "aiAssert" | "aiWaitFor">

function createVision(page: Page) {
  const agent: MidsceneAgentLike = new PlaywrightAgent(page)

  const tryCall = async (
    action: (instruction: string) => Promise<unknown>,
    instruction: string,
    fallback: () => Promise<void>,
  ) => {
    try {
      await action(instruction)
      return
    } catch {
      await fallback()
    }
  }

  return {
    assert: (instruction: string, fallback: () => Promise<void>) =>
      tryCall((text) => agent.aiAssert(text), instruction, fallback),
    tap: (instruction: string, fallback: () => Promise<void>) =>
      tryCall((text) => agent.aiTap(text), instruction, fallback),
    waitFor: (instruction: string, fallback: () => Promise<void>) =>
      tryCall((text) => agent.aiWaitFor(text), instruction, fallback),
  }
}

async function gotoPlaybooks(page: Page) {
  await page.goto(`${APP_URL}/playbooks`)
  await page.waitForLoadState("networkidle")
}

async function assertVisible(page: Page, text: string) {
  const visible = await page.getByText(text, { exact: true }).isVisible()
  expect(visible).toBe(true)
}

async function openFirstPlaybook(page: Page) {
  await gotoPlaybooks(page)

  const vision = createVision(page)
  await vision.assert("The Playbooks page shows at least one playbook card.", async () => {
    expect(await page.locator('a[href^="/playbooks/"]').first().isVisible()).toBe(true)
  })

  const firstPlaybook = page.locator('a[href^="/playbooks/"]').first()
  const title = (await firstPlaybook.locator("h3").textContent())?.trim() ?? ""
  const href = await firstPlaybook.getAttribute("href")

  expect(href).toMatch(/^\/playbooks\//)

  return {
    href: href!,
    title,
  }
}

async function findRunnablePlaybook(page: Page) {
  await gotoPlaybooks(page)

  const playbookLinks = page.locator('a[href^="/playbooks/"]')
  const count = await playbookLinks.count()
  const candidates: Array<{ href: string; title: string }> = []

  for (let index = 0; index < count; index += 1) {
    const link = playbookLinks.nth(index)
    const href = await link.getAttribute("href")
    const title = (await link.locator("h3").textContent())?.trim() ?? ""

    if (href) {
      candidates.push({ href, title })
    }
  }

  for (const candidate of candidates) {
    await page.goto(`${APP_URL}${candidate.href}`)
    await page.waitForLoadState("networkidle")

    if (await page.getByRole("button", { name: /start run/i }).isVisible().catch(() => false)) {
      return candidate
    }
  }

  throw new Error("No runnable playbook with a Start Run button was available in the app data.")
}

async function startRunFromFirstPlaybook(page: Page) {
  const playbook = await findRunnablePlaybook(page)
  await page.goto(`${APP_URL}${playbook.href}`)
  await page.waitForLoadState("networkidle")

  const startRunButton = page.getByRole("button", { name: /start run/i })
  expect(await startRunButton.isVisible()).toBe(true)

  const vision = createVision(page)
  await vision.tap(
    `Click the Start Run button for the playbook${playbook.title ? ` titled ${playbook.title}` : ""}.`,
    async () => {
      await startRunButton.click()
    },
  )

  await page.waitForURL(/\/runs\//)
  await page.waitForLoadState("networkidle")

  return {
    playbook,
    runPath: new URL(page.url()).pathname,
  }
}

describe.skipIf(!UI_E2E_ENABLED)("operator UI browser flows", () => {
  let browser: Browser
  let page: Page

  beforeAll(async () => {
    browser = await chromium.launch({ headless: true })
  })

  afterAll(async () => {
    await browser?.close()
  })

  beforeEach(async () => {
    page = await browser.newPage()
  })

  afterEach(async () => {
    await page?.close()
  })

  it("navigates from the playbook list to a playbook detail page", async () => {
    const playbook = await openFirstPlaybook(page)

    const vision = createVision(page)
    await vision.tap(
      `Open the playbook detail for ${playbook.title || "the first playbook in the list"}.`,
      async () => {
        await page.locator('a[href^="/playbooks/"]').first().click()
      },
    )

    await page.waitForURL((url: URL) => url.pathname === playbook.href)
    await vision.assert(
      "The playbook detail page is visible and shows task intent information.",
      async () => {
        expect(
          await page.getByRole("heading", { name: playbook.title || /.+/ }).isVisible(),
        ).toBe(true)
        await assertVisible(page, "Task Intent")
      },
    )
  })

  it("starts a run from the playbook detail page", async () => {
    const { runPath } = await startRunFromFirstPlaybook(page)

    const vision = createVision(page)
    await vision.assert(
      "A run detail page is open after starting the run.",
      async () => {
        expect(runPath).toMatch(/^\/runs\//)
        await assertVisible(page, "Business")
      },
    )
  })

  it("shows run list rows with status information", async () => {
    const { runPath } = await startRunFromFirstPlaybook(page)
    await page.goto(`${APP_URL}/runs`)
    await page.waitForLoadState("networkidle")

    const runIdPrefix = runPath.split("/").at(-1)?.slice(0, 8)
    const matchingRun = runIdPrefix
      ? page.locator("a", { has: page.getByText(runIdPrefix, { exact: false }) }).first()
      : page.locator('a[href^="/runs/"]').first()

    const vision = createVision(page)
    await vision.assert(
      "The Runs page shows a run row with a visible status badge.",
      async () => {
        expect(await matchingRun.isVisible()).toBe(true)
        expect(await matchingRun.textContent()).toMatch(
          /queued|initializing|running|waiting approval|waiting_approval|blocked|failing|failed|succeeded|pending|created/i,
        )
      },
    )
  })

  it("shows business, governance, and operator sections on run detail", async () => {
    await startRunFromFirstPlaybook(page)

    const vision = createVision(page)
    await vision.waitFor(
      "The run detail page shows Business, Governance, and Operator sections.",
      async () => {
        await assertVisible(page, "Business")
        await assertVisible(page, "Governance")
        await assertVisible(page, "Operator")
      },
    )
  })
})
