import { drizzle } from "drizzle-orm/postgres-js"
import postgres from "postgres"

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  "postgres://pluto_test:pluto_test@localhost:5434/pluto_test"

let sql: ReturnType<typeof postgres> | null = null
let db: ReturnType<typeof drizzle> | null = null

export function getTestDb() {
  if (!db) {
    sql = postgres(TEST_DATABASE_URL, { max: 5 })
    db = drizzle(sql)
  }
  return db
}

export function getTestSql() {
  if (!sql) {
    sql = postgres(TEST_DATABASE_URL, { max: 5 })
    db = drizzle(sql)
  }
  return sql
}

export async function cleanTestDb() {
  const rawSql = getTestSql()
  await rawSql`TRUNCATE TABLE run_events, artifacts, approval_tasks, run_sessions, policy_snapshots, run_plans, runs, harnesses, playbooks CASCADE`
}

export async function closeTestDb() {
  if (sql) {
    await sql.end()
    sql = null
    db = null
  }
}
