/**
 * Vitest ortamında Electron için derlenmiş better-sqlite3 yerine
 * Node'un yerleşik node:sqlite (DatabaseSync) kullanılır — aynı prepare/run/transaction kalıbı.
 */
import { DatabaseSync } from 'node:sqlite'

function isNamedParams(x: unknown): x is Record<string, unknown> {
  return x !== null && typeof x === 'object' && !Array.isArray(x)
}

export function createBetterSqliteShim() {
  const native = new DatabaseSync(':memory:')
  let savepointSeq = 0
  let txDepth = 0

  function prepare(sql: string) {
    return {
      run(...args: unknown[]) {
        const stmt = native.prepare(sql)
        if (args.length === 1 && isNamedParams(args[0])) stmt.run(args[0] as object)
        else stmt.run(...(args as never[]))
      },
      get(...args: unknown[]) {
        const stmt = native.prepare(sql)
        if (args.length === 1 && isNamedParams(args[0])) {
          return stmt.get(args[0] as object) ?? undefined
        }
        if (args.length > 0) {
          return (stmt.get as (...a: unknown[]) => object | undefined)(...args) ?? undefined
        }
        return stmt.get() ?? undefined
      },
      all(...args: unknown[]) {
        const stmt = native.prepare(sql)
        if (args.length === 1 && isNamedParams(args[0])) {
          return stmt.all(args[0] as object)
        }
        if (args.length > 0) {
          return (stmt.all as (...a: unknown[]) => unknown[])(...args)
        }
        return stmt.all()
      },
    }
  }

  function transaction(fn: () => void) {
    return () => {
      const top = txDepth === 0
      const sp = `sp_${savepointSeq++}`
      if (top) native.exec('BEGIN IMMEDIATE')
      else native.exec(`SAVEPOINT ${sp}`)
      txDepth++
      try {
        fn()
        txDepth--
        if (top) native.exec('COMMIT')
        else native.exec(`RELEASE SAVEPOINT ${sp}`)
      } catch (e) {
        txDepth--
        if (top) native.exec('ROLLBACK')
        else {
          native.exec(`ROLLBACK TO SAVEPOINT ${sp}`)
          native.exec(`RELEASE SAVEPOINT ${sp}`)
        }
        throw e
      }
    }
  }

  return {
    prepare,
    exec: (sql: string) => native.exec(sql),
    transaction,
    close: () => native.close(),
  }
}

export type BetterSqliteShim = ReturnType<typeof createBetterSqliteShim>
