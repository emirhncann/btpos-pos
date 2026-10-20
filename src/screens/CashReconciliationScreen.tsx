import { useEffect, useState, type CSSProperties } from 'react'
import {
  UNKNOWN_BANK_KEY,
  buildLockedLines,
  diffTone,
  isoToLocalInput,
  money,
  noteRequired,
  nowLocalInput,
  periodBoundIso,
  round2,
  todayStartLocalInput,
  type ReconCatalogItem,
  type ReconLine,
  type ReconSnapshot,
} from '../lib/cashReconciliation'
import { pavoListPendingSales, type PavoSettings } from '../lib/pavoService'

interface Props {
  companyId: string
  terminalId: string
  cashier: CashierRow
  onClose: () => void
  onQueued: () => void
}

type Step = 1 | 2 | 3 | 4

function parseAmount(raw: string): number | null {
  const t = raw.trim().replace(/\s/g, '').replace(/\./g, '').replace(',', '.')
  if (!t || t === '-') return null
  const n = Number(t)
  return Number.isFinite(n) ? round2(n) : null
}

function amountText(n: number): string {
  return round2(n).toFixed(2).replace('.', ',')
}

function showWhen(iso: string): string {
  const local = isoToLocalInput(iso)
  if (!local) return iso
  const [d, t] = local.split('T')
  const [y, m, day] = d.split('-')
  return `${day}.${m}.${y} ${t}`
}

const fieldStyle: CSSProperties = {
  background: 'var(--pos-surface)',
  color: 'var(--pos-text)',
  border: '1.5px solid var(--pos-border)',
  borderRadius: 12,
  padding: '12px 14px',
  fontSize: 18,
  fontFamily: 'inherit',
  textAlign: 'left',
  minHeight: 52,
  width: '100%',
}

const amountBtn: CSSProperties = {
  background: 'var(--pos-surface-alt)',
  color: 'var(--pos-text)',
  border: '1.5px solid var(--pos-border)',
  borderRadius: 12,
  minWidth: 180,
  height: 56,
  padding: '0 16px',
  fontSize: 22,
  fontWeight: 700,
  fontFamily: 'inherit',
  fontVariantNumeric: 'tabular-nums',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'flex-end',
  gap: 8,
  cursor: 'pointer',
}

const primaryBtn: CSSProperties = {
  background: 'var(--pos-primary)',
  color: 'var(--pos-primary-text)',
  border: 'none',
  borderRadius: 10,
  padding: '12px 18px',
  fontWeight: 700,
  cursor: 'pointer',
}

const secondaryBtn: CSSProperties = {
  background: 'var(--pos-surface-alt)',
  color: 'var(--pos-text)',
  border: '1px solid var(--pos-border)',
  borderRadius: 10,
  padding: '12px 18px',
  fontWeight: 700,
  cursor: 'pointer',
}

export async function countPavoPendingSales(): Promise<number> {
  const device = await window.electron.db.getPaymentDeviceSettings('pavo')
  if (!device?.ipAddress || !device.isActive) return 0
  const settings: PavoSettings = {
    ipAddress: device.ipAddress,
    port: device.port,
    serialNo: device.serialNo ?? '',
    cardReadTimeout: device.cardReadTimeout,
    printWidth: device.printWidth,
  }
  try {
    const seq = await window.electron.db.nextPavoSequence()
    const pending = await pavoListPendingSales(settings, seq)
    if (!pending.success) return 0
    return pending.sales.length
  } catch {
    return 0
  }
}

function toneVar(tone: ReturnType<typeof diffTone>): string {
  if (tone === 'ok') return 'var(--pos-success)'
  if (tone === 'warn') return 'var(--pos-warning)'
  if (tone === 'bad') return 'var(--pos-danger)'
  return 'var(--pos-text-muted)'
}

function toneMark(tone: ReturnType<typeof diffTone>): string {
  if (tone === 'ok') return '✓'
  if (tone === 'warn') return '●'
  if (tone === 'bad') return '⚠'
  return ''
}

function showEntry(raw: string): string {
  const n = parseAmount(raw)
  return n == null ? '' : money(n)
}

function AmountField({ label, value, onOpen }: { label: string; value: string; onOpen: () => void }) {
  const shown = showEntry(value)
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, padding: '10px 0', borderBottom: '1px solid var(--pos-border)' }}>
      <div style={{ fontSize: 16, fontWeight: 600 }}>{label}</div>
      <button type="button" onClick={onOpen} style={amountBtn}>
        <span style={{ color: shown ? 'var(--pos-text)' : 'var(--pos-text-muted)' }}>{shown || '0,00'}</span>
        <span style={{ color: 'var(--pos-text-muted)', fontSize: 15, fontWeight: 600 }}>₺</span>
      </button>
    </div>
  )
}

function NumPad({
  title, value, onChange, onConfirm, onClose,
}: {
  title: string
  value: string
  onChange: (v: string) => void
  onConfirm: (v: string) => void
  onClose: () => void
}) {
  function press(key: string) {
    if (key === '⌫') { onChange(value.slice(0, -1)); return }
    if (key === 'C') { onChange(''); return }
    if (key === ',' && value.includes(',')) return
    if (key === ',' && !value) { onChange('0,'); return }
    const next = value + key
    const decimals = next.split(',')[1]
    if (decimals && decimals.length > 2) return
    onChange(next)
  }
  const keyStyle: CSSProperties = {
    background: 'var(--pos-key-bg)',
    color: 'var(--pos-key-text)',
    border: '1px solid var(--pos-key-border)',
    borderRadius: 12,
    fontSize: 26,
    fontWeight: 700,
    fontFamily: 'inherit',
    height: 64,
    cursor: 'pointer',
  }
  const keys = ['7', '8', '9', '4', '5', '6', '1', '2', '3', ',', '0', '⌫']
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 60, background: 'var(--pos-scrim)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', padding: 16 }}>
      <div style={{ background: 'var(--pos-surface)', color: 'var(--pos-text)', border: '1px solid var(--pos-border)', borderRadius: 18, padding: 18, width: 'min(420px, 100%)', marginBottom: 12 }}>
        <div style={{ color: 'var(--pos-text-muted)', fontSize: 14, marginBottom: 8 }}>{title}</div>
        <div style={{
          background: 'var(--pos-surface-alt)',
          border: '1.5px solid var(--pos-primary)',
          borderRadius: 12,
          minHeight: 64,
          marginBottom: 14,
          padding: '8px 16px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'flex-end',
          fontSize: 32,
          fontWeight: 700,
          fontVariantNumeric: 'tabular-nums',
        }}>
          {value || '0'}<span style={{ marginLeft: 8, fontSize: 18, color: 'var(--pos-text-muted)' }}>₺</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
          {keys.map(key => (
            <button key={key} type="button" className="pos-key" onClick={() => press(key)} style={keyStyle}>{key}</button>
          ))}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.4fr', gap: 8, marginTop: 10 }}>
          <button type="button" onClick={() => press('C')} style={{ ...keyStyle, fontSize: 16 }}>Temizle</button>
          <button type="button" className="pos-key-action" onClick={() => onConfirm(value)} style={{ ...keyStyle, background: 'var(--pos-key-action-bg)', color: 'var(--pos-key-action-text)', border: 'none', fontSize: 18 }}>Tamam</button>
        </div>
        <button type="button" onClick={onClose} style={{ ...secondaryBtn, width: '100%', marginTop: 8 }}>Vazgeç</button>
      </div>
    </div>
  )
}

export function CashReconciliationHistory({
  terminalId, cashierId, onClose,
}: {
  terminalId: string
  cashierId: string
  onClose: () => void
}) {
  const [rows, setRows] = useState<CashReconciliationRecord[]>([])
  const [row, setRow] = useState<CashReconciliationRecord | null>(null)
  useEffect(() => {
    void window.electron.db.listCashReconciliations(terminalId).then(setRows).catch(() => setRows([]))
  }, [terminalId])

  async function printRow(item: CashReconciliationRecord) {
    const result = await window.electron.templates.printWithBehavior({
      triggerType: 'hesap_alma',
      cashierId,
      data: {
        hesap: {
          lines: JSON.parse(item.lines),
          cash_detail: JSON.parse(item.cashDetail),
          info: JSON.parse(item.info),
          total_diff: item.totalDiff,
          note: item.note,
          entered: JSON.parse(item.entered || '{}'),
          locked_at: item.lockedAt,
          period_overridden: item.periodOverridden,
        },
      },
    })
    const templateId = result.pendingPrint ? result.template?.id : result.needsSelection ? result.templates?.[0]?.id : undefined
    if (templateId) {
      const printed = await window.electron.templates.printWithBehavior({
        triggerType: 'hesap_alma', cashierId, templateId,
        data: { hesap: { lines: JSON.parse(item.lines), total_diff: item.totalDiff, note: item.note } },
      })
      if (!printed.success && printed.message) window.alert(printed.message)
      return
    }
    if (result.skipped) window.alert('Hesap alma şablonu kapalı.')
    else if (!result.success && result.message) window.alert(result.message)
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 50, background: 'var(--pos-scrim)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div style={{ background: 'var(--pos-surface)', color: 'var(--pos-text)', border: '1px solid var(--pos-border)', borderRadius: 16, width: 'min(760px, 100%)', maxHeight: '90%', overflow: 'auto', padding: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div style={{ fontWeight: 700 }}>Hesap alma geçmişi</div>
          <button type="button" onClick={onClose} style={secondaryBtn}>Kapat</button>
        </div>
        {row ? (
          <div style={{ display: 'grid', gap: 8 }}>
            <div>{showWhen(row.periodStart)} — {showWhen(row.periodEnd)}</div>
            <div>Toplam fark {money(row.totalDiff)} · {row.synced ? 'Gönderildi' : 'Bekliyor'}{row.periodOverridden ? ' · Dönem elle değiştirildi' : ''}</div>
            <div style={{ color: 'var(--pos-text-muted)' }}>{row.note || ''}</div>
            <pre style={{ whiteSpace: 'pre-wrap', color: 'var(--pos-text)', fontSize: 12 }}>{row.lines}</pre>
            <button type="button" onClick={() => void printRow(row)} style={{ ...primaryBtn, justifySelf: 'start' }}>Yazdır</button>
          </div>
        ) : rows.length === 0 ? (
          <div style={{ color: 'var(--pos-text-muted)' }}>Kayıt yok</div>
        ) : rows.map(item => (
          <button key={item.id} type="button" onClick={() => setRow(item)} style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr 110px 100px', gap: 8, width: '100%', textAlign: 'left', padding: '10px 4px', background: 'transparent', color: 'var(--pos-text)', border: 'none', borderBottom: '1px solid var(--pos-border)', cursor: 'pointer' }}>
            <span>{showWhen(item.periodStart)} — {showWhen(item.periodEnd)}</span>
            <span>{item.cashierName || '—'}</span>
            <span>{money(item.totalDiff)}</span>
            <span>{item.synced ? 'Gönderildi' : 'Bekliyor'}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

export default function CashReconciliationScreen({
  companyId, terminalId, cashier, onClose, onQueued,
}: Props) {
  const [step, setStep] = useState<Step>(1)
  const [startLocal, setStartLocal] = useState(todayStartLocalInput)
  const [defaultStart, setDefaultStart] = useState(todayStartLocalInput)
  const [endLocal, setEndLocal] = useState(nowLocalInput)
  const [endEdited, setEndEdited] = useState(false)
  const [cashiers, setCashiers] = useState<CashierRow[]>([])
  const [filterCashierId, setFilterCashierId] = useState('')
  const [catalog, setCatalog] = useState<{ banks: ReconCatalogItem[]; others: ReconCatalogItem[] }>({ banks: [], others: [] })
  // Küpür sayımı şimdilik kapalı. Geri açmak için denomCounts / countMode ve adım 2'deki küpür bloğu yorumdan çıkarılır.
  // const [denomCounts, setDenomCounts] = useState<Record<string, string>>({})
  // const [countMode, setCountMode] = useState<'denom' | 'manual'>('manual')
  const [manualCount, setManualCount] = useState('')
  const [opening, setOpening] = useState('0,00')
  const [cashOut, setCashOut] = useState('0,00')
  const [cashOutNote, setCashOutNote] = useState('')
  const [cardEntered, setCardEntered] = useState<Record<string, string>>({})
  const [otherEntered, setOtherEntered] = useState<Record<string, string>>({})
  const [pad, setPad] = useState<{ title: string; value: string; onConfirm: (v: string) => void } | null>(null)
  const [lockAsk, setLockAsk] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [lines, setLines] = useState<ReconLine[]>([])
  const [snap, setSnap] = useState<ReconSnapshot | null>(null)
  const [expected, setExpected] = useState(0)
  const [totalDiff, setTotalDiff] = useState(0)
  const [savedId, setSavedId] = useState<string | null>(null)
  const [cashDetail, setCashDetail] = useState<Record<string, unknown> | null>(null)
  const [enteredJson, setEnteredJson] = useState<Record<string, unknown> | null>(null)
  const [note, setNote] = useState('')
  const [carry, setCarry] = useState('0,00')
  const [sent, setSent] = useState(false)
  const [lockedAt, setLockedAt] = useState('')
  const [blankKeys, setBlankKeys] = useState<string[]>([])

  useEffect(() => {
    void (async () => {
      const [lastZ, carryCash, people, names] = await Promise.all([
        window.electron.db.getLastDayEndAt().catch(() => null),
        window.electron.db.getLastCountedCash(terminalId).catch(() => null),
        window.electron.db.getAllCashiers().catch(() => [] as CashierRow[]),
        window.electron.db.listReconCatalog(terminalId).catch(() => ({ banks: [], others: [] })),
      ])
      const start = lastZ ? (isoToLocalInput(lastZ) || todayStartLocalInput()) : todayStartLocalInput()
      setStartLocal(start)
      setDefaultStart(start)
      setEndLocal(nowLocalInput())
      if (carryCash != null) setOpening(amountText(carryCash))
      setCashiers(people.filter(c => c.isActive))
      setCatalog(names)
    })()
  }, [terminalId])

  useEffect(() => {
    if (step !== 1 || endEdited) return
    const timer = setInterval(() => setEndLocal(nowLocalInput()), 1000)
    return () => clearInterval(timer)
  }, [step, endEdited])

  const counted = parseAmount(manualCount) ?? 0
  const openingN = parseAmount(opening) ?? 0
  const cashOutN = parseAmount(cashOut) ?? 0

  function openPad(title: string, value: string, onConfirm: (v: string) => void) {
    setPad({ title, value, onConfirm })
  }

  function commitAmount(raw: string, write: (v: string) => void) {
    const n = parseAmount(raw)
    write(n == null ? '' : amountText(n))
  }

  function freezeEnd() {
    if (!endEdited) setEndLocal(nowLocalInput())
    setStep(2)
  }

  const periodInvalid = (() => {
    const a = periodBoundIso(startLocal, 'start')
    const b = periodBoundIso(endLocal, 'end')
    return !a || !b || a > b
  })()

  function blanks(): string[] {
    const missing: string[] = []
    for (const bank of catalog.banks) {
      if (parseAmount(cardEntered[bank.key] ?? '') == null) missing.push(bank.label)
    }
    for (const brand of catalog.others) {
      if (parseAmount(otherEntered[brand.key] ?? '') == null) missing.push(brand.label)
    }
    return missing
  }

  function coerceBlanks() {
    const cards = { ...cardEntered }
    const others = { ...otherEntered }
    for (const bank of catalog.banks) {
      if (parseAmount(cards[bank.key] ?? '') == null) cards[bank.key] = '0,00'
    }
    for (const brand of catalog.others) {
      if (parseAmount(others[brand.key] ?? '') == null) others[brand.key] = '0,00'
    }
    setCardEntered(cards)
    setOtherEntered(others)
    return { cards, others }
  }

  async function lock(cards: Record<string, string>, others: Record<string, string>) {
    const startIso = periodBoundIso(startLocal, 'start')
    const endIso = periodBoundIso(endLocal, 'end')
    if (!startIso || !endIso) return
    setBusy(true)
    setError('')
    try {
      const snapshot = await window.electron.db.computeCashReconciliation({
        companyId,
        terminalId,
        startIso,
        endIso,
        cashierId: filterCashierId || null,
      })
      const cardNumbers: Record<string, number> = {}
      const otherNumbers: Record<string, number> = {}
      for (const bank of catalog.banks) cardNumbers[bank.key] = parseAmount(cards[bank.key] ?? '') ?? 0
      for (const brand of catalog.others) otherNumbers[brand.key] = parseAmount(others[brand.key] ?? '') ?? 0
      const built = buildLockedLines(snapshot, catalog.banks, catalog.others, {
        opening: openingN,
        cashOut: cashOutN,
        counted,
        cards: cardNumbers,
        others: otherNumbers,
      })
      const denoms: Record<string, number> = {}
      // Küpür dökümü kapalı. Açılınca countMode === 'denom' iken DENOMINATIONS adetleri buraya yazılır.
      const entered = {
        counted_mode: 'manual' as const,
        denominations: denoms,
        counted,
        opening: openingN,
        cash_out: cashOutN,
        cash_out_note: cashOutNote.trim(),
        cards: cardNumbers,
        others: otherNumbers,
      }
      const detail = {
        opening: openingN,
        cash_sales: snapshot.cashSales,
        cash_collections: snapshot.cashCollections,
        cash_payments: snapshot.cashPayments,
        cash_refunds: snapshot.cashRefunds,
        cash_out: cashOutN,
        expected: built.expected,
        counted,
        denominations: denoms,
        carry_over: null,
      }
      const info = {
        on_account: snapshot.onAccount,
        discount: snapshot.discount,
        sale_count: snapshot.saleCount,
        refund_count: snapshot.refundCount,
      }
      const overridden = startLocal !== defaultStart || filterCashierId !== '' || endEdited
      const id = crypto.randomUUID()
      const lockedAt = new Date().toISOString()
      await window.electron.db.saveCashReconciliation({
        id,
        terminalId,
        cashierId: cashier.id,
        filterCashierId: filterCashierId || null,
        periodStart: startIso,
        periodEnd: endIso,
        periodOverridden: overridden ? 1 : 0,
        entered: JSON.stringify(entered),
        lockedAt,
        lines: JSON.stringify(built.lines),
        cashDetail: JSON.stringify(detail),
        info: JSON.stringify(info),
        totalDiff: built.totalDiff,
        note: null,
        createdAt: lockedAt,
      })
      setSavedId(id)
      setLines(built.lines)
      setSnap(snapshot)
      setExpected(built.expected)
      setTotalDiff(built.totalDiff)
      setCashDetail(detail)
      setEnteredJson(entered)
      setCarry(amountText(counted))
      setLockedAt(lockedAt)
      setStep(4)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Kilit kaydı yazılamadı')
    } finally {
      setBusy(false)
      setLockAsk(false)
    }
  }

  function askLock() {
    const missing = blanks()
    if (missing.length > 0) {
      const ok = window.confirm(`${missing.length} alan boş, 0 olarak kaydedilsin mi?`)
      if (!ok) return
      const keys = [
        ...catalog.banks.filter(b => parseAmount(cardEntered[b.key] ?? '') == null).map(b => b.key),
        ...catalog.others.filter(b => parseAmount(otherEntered[b.key] ?? '') == null).map(b => b.key),
      ]
      setBlankKeys(keys)
      const filled = coerceBlanks()
      setLockAsk(true)
      setCardEntered(filled.cards)
      setOtherEntered(filled.others)
      return
    }
    setBlankKeys([])
    setLockAsk(true)
  }

  async function tryClose() {
    if (step !== 4 || !savedId || !cashDetail) {
      onClose()
      return
    }
    if (noteRequired(totalDiff) && !note.trim()) {
      setError('Toplam fark toleransı aşıyor. Açıklama zorunlu.')
      return
    }
    if (sent) { onClose(); return }
    setBusy(true)
    try {
      const carryN = parseAmount(carry) ?? counted
      const detail = { ...cashDetail, carry_over: carryN }
      await window.electron.db.finalizeCashReconciliation({
        id: savedId,
        note: note.trim() || null,
        cashDetail: JSON.stringify(detail),
      })
      const startIso = periodBoundIso(startLocal, 'start')
      const endIso = periodBoundIso(endLocal, 'end')
      await window.electron.db.enqueueOperation({
        id: crypto.randomUUID(),
        companyId,
        type: 'cash_reconciliation',
        payload: {
          endpoint: '/pos/cash-reconciliations',
          method: 'POST',
          reconciliation_id: savedId,
          body: {
            id: savedId,
            terminal_id: terminalId,
            cashier_id: cashier.id,
            filter_cashier_id: filterCashierId || null,
            period_start: startIso,
            period_end: endIso,
            period_overridden: (startLocal !== defaultStart || filterCashierId !== '' || endEdited) ? 1 : 0,
            entered: enteredJson,
            locked_at: lockedAt,
            lines: lines,
            cash_detail: detail,
            info: snap ? {
              on_account: snap.onAccount,
              discount: snap.discount,
              sale_count: snap.saleCount,
              refund_count: snap.refundCount,
            } : {},
            total_diff: totalDiff,
            note: note.trim() || null,
            created_at: lockedAt,
          },
        },
        label: 'Hesap alma',
      })
      onQueued()
      setSent(true)
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Kayıt gönderilemedi')
    } finally {
      setBusy(false)
    }
  }

  async function printResult() {
    if (!snap || !cashDetail || !enteredJson) return
    const payload = {
      lines,
      cash_detail: { ...cashDetail, carry_over: parseAmount(carry) },
      info: {
        on_account: snap.onAccount,
        discount: snap.discount,
        sale_count: snap.saleCount,
        refund_count: snap.refundCount,
      },
      total_diff: totalDiff,
      note: note.trim() || null,
      entered: enteredJson,
    }
    const result = await window.electron.templates.printWithBehavior({
      triggerType: 'hesap_alma',
      cashierId: cashier.id,
      data: { hesap: payload },
    })
    const templateId = result.pendingPrint ? result.template?.id : result.needsSelection ? result.templates?.[0]?.id : undefined
    if (templateId) {
      const printed = await window.electron.templates.printWithBehavior({
        triggerType: 'hesap_alma', cashierId: cashier.id, templateId, data: { hesap: payload },
      })
      if (!printed.success && printed.message) window.alert(printed.message)
      return
    }
    if (result.skipped) window.alert('Hesap alma şablonu kapalı.')
    else if (!result.success && result.message) window.alert(result.message)
  }

  const steps = ['Dönem', 'Nakit', 'Z Raporu', 'Sonuç']
  const cardLines = lines.filter(l => l.group === 'card')
  const otherLines = lines.filter(l => l.group === 'other')
  const diffWord = totalDiff < 0 ? 'eksik' : totalDiff > 0 ? 'fazla' : 'denk'
  const badgeBg = totalDiff === 0 ? 'var(--pos-success)' : totalDiff < 0 ? 'var(--pos-danger)' : 'var(--pos-warning)'

  return (
    <div className="pos-osk-inset" style={{
      position: 'fixed', inset: 0, zIndex: 40,
      backgroundColor: 'var(--pos-screen-bg)',
      backgroundImage: 'var(--pos-bg-image)',
      backgroundSize: 'var(--pos-bg-size)',
      color: 'var(--pos-text)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
    }}>
      <div style={{ background: 'var(--pos-surface)', border: '1px solid var(--pos-border)', borderRadius: 16, width: 'min(920px, 100%)', maxHeight: '100%', overflow: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: 22, fontWeight: 700 }}>Hesap Alma</div>
          <button type="button" onClick={() => void tryClose()} style={secondaryBtn}>✕</button>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {steps.map((label, i) => {
            const n = (i + 1) as Step
            const color = n === step ? 'var(--pos-primary)' : n < step ? 'var(--pos-success)' : 'var(--pos-disabled-fg)'
            return <div key={label} style={{ color, fontWeight: 700 }}>{['①', '②', '③', '④'][i]} {label}</div>
          })}
        </div>

        {step === 1 && (
          <div style={{ display: 'grid', gap: 12 }}>
            <div style={{ fontSize: 18, fontWeight: 700 }}>Hesap Alma — Dönem</div>
            <div style={{ color: 'var(--pos-text-muted)' }}>Başlangıç
              <input type="datetime-local" step={1} value={startLocal} onChange={e => setStartLocal(e.target.value)} style={{ ...fieldStyle, display: 'block', marginTop: 4, textAlign: 'left', colorScheme: document.documentElement.dataset.posDark === 'true' ? 'dark' : 'light' }} />
            </div>
            <div style={{ color: 'var(--pos-text-muted)' }}>Bitiş
              <span style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                <input type="datetime-local" step={1} value={endLocal} onChange={e => { setEndLocal(e.target.value); setEndEdited(true) }} style={{ ...fieldStyle, textAlign: 'left', colorScheme: document.documentElement.dataset.posDark === 'true' ? 'dark' : 'light' }} />
                <button type="button" onClick={() => { setEndLocal(nowLocalInput()); setEndEdited(false) }} style={secondaryBtn}>Şimdi</button>
              </span>
            </div>
            <div style={{ color: 'var(--pos-text-muted)' }}>Kasiyer
              <select value={filterCashierId} onChange={e => setFilterCashierId(e.target.value)} style={{ ...fieldStyle, display: 'block', marginTop: 4, textAlign: 'left', colorScheme: document.documentElement.dataset.posDark === 'true' ? 'dark' : 'light' }}>
                <option value="">Tüm kasiyerler</option>
                {cashiers.map(c => <option key={c.id} value={c.id}>{c.fullName}</option>)}
              </select>
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button type="button" disabled={periodInvalid} onClick={freezeEnd} style={{ ...primaryBtn, opacity: periodInvalid ? 0.5 : 1 }}>Devam →</button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div style={{ display: 'grid', gap: 4 }}>
            <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>Kasadaki nakiti sayın</div>
            {/* Küpür sayımı şimdilik kapalı.
            {DENOMINATIONS.map(d => (
              <div key={d.key}>{d.label} × adet → satır toplamı</div>
            ))}
            <button type="button">Küpürle say</button>
            */}
            <AmountField label="Sayılan nakit" value={manualCount} onOpen={() => openPad('Sayılan nakit', manualCount, v => commitAmount(v, setManualCount))} />
            <AmountField label="Gün başı devir nakiti" value={opening} onOpen={() => openPad('Devir nakiti', opening, v => commitAmount(v, setOpening))} />
            <AmountField label="Kasadan çıkan" value={cashOut} onOpen={() => openPad('Kasadan çıkan', cashOut, v => commitAmount(v, setCashOut))} />
            <input value={cashOutNote} onChange={e => setCashOutNote(e.target.value)} placeholder="Çıkan nakit açıklaması" style={{ ...fieldStyle, marginTop: 8 }} />
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 12 }}>
              <button type="button" onClick={() => setStep(1)} style={secondaryBtn}>← Geri</button>
              <button type="button" onClick={() => setStep(3)} style={primaryBtn}>Devam →</button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div style={{ display: 'grid', gap: 8 }}>
            <div style={{ fontSize: 18, fontWeight: 700 }}>Z raporu / POS fişindeki tutarları girin</div>
            <div style={{ background: 'var(--pos-surface-alt)', padding: 8, borderRadius: 8, fontWeight: 700 }}>KREDİ KARTI</div>
            {catalog.banks.map(bank => (
              <AmountField
                key={bank.key}
                label={bank.label}
                value={cardEntered[bank.key] ?? ''}
                onOpen={() => openPad(bank.label, cardEntered[bank.key] ?? '', v => commitAmount(v, next => setCardEntered(s => ({ ...s, [bank.key]: next }))))}
              />
            ))}
            <div style={{ background: 'var(--pos-surface-alt)', padding: 8, borderRadius: 8, fontWeight: 700 }}>DİĞER ÖDEMELER</div>
            {catalog.others.map(brand => (
              <AmountField
                key={brand.key}
                label={brand.label}
                value={otherEntered[brand.key] ?? ''}
                onOpen={() => openPad(brand.label, otherEntered[brand.key] ?? '', v => commitAmount(v, next => setOtherEntered(s => ({ ...s, [brand.key]: next }))))}
              />
            ))}
            {error && <div style={{ color: 'var(--pos-danger)' }}>{error}</div>}
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <button type="button" onClick={() => setStep(2)} style={secondaryBtn}>← Geri</button>
              <button type="button" disabled={busy} onClick={askLock} style={primaryBtn}>Onayla ve Kilitle</button>
            </div>
          </div>
        )}

        {step === 4 && snap && (
          <div style={{ display: 'grid', gap: 8 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 120px 120px 120px', gap: 6, alignItems: 'center' }}>
              <div />
              <div style={{ textAlign: 'right', fontWeight: 700 }}>SİSTEM</div>
              <div style={{ textAlign: 'right', fontWeight: 700 }}>GİRİLEN</div>
              <div style={{ textAlign: 'right', fontWeight: 700 }}>FARK</div>
              <div style={{ gridColumn: '1 / -1', background: 'var(--pos-surface-alt)', padding: 8, borderRadius: 8, fontWeight: 700 }}>KREDİ KARTI</div>
              {cardLines.map(line => {
                const tone = diffTone(line.diff)
                return (
                  <div key={line.key} style={{ display: 'contents' }}>
                    <div>{line.label}</div>
                    <div style={{ textAlign: 'right' }}>{money(line.system)}</div>
                    <div style={{ textAlign: 'right' }}>{blankKeys.includes(line.key) ? '—' : money(line.entered)}</div>
                    <div style={{ textAlign: 'right', color: toneVar(tone), fontWeight: 700 }}>{money(line.diff)} {toneMark(tone)}</div>
                  </div>
                )
              })}
              <div style={{ gridColumn: '1 / -1', background: 'var(--pos-surface-alt)', padding: 8, borderRadius: 8, fontWeight: 700 }}>DİĞER ÖDEMELER</div>
              {otherLines.map(line => {
                const tone = diffTone(line.diff)
                return (
                  <div key={line.key} style={{ display: 'contents' }}>
                    <div>{line.label}</div>
                    <div style={{ textAlign: 'right' }}>{money(line.system)}</div>
                    <div style={{ textAlign: 'right' }}>{blankKeys.includes(line.key) ? '—' : money(line.entered)}</div>
                    <div style={{ textAlign: 'right', color: toneVar(tone), fontWeight: 700 }}>{money(line.diff)} {toneMark(tone)}</div>
                  </div>
                )
              })}
            </div>
            <div style={{ color: 'var(--pos-text-muted)' }}>
              Devir {money(openingN)} + Nakit satış {money(snap.cashSales)} + Nakit tahsilat {money(snap.cashCollections)}
              {' '}− Nakit iade {money(snap.cashRefunds)}
              {' '}− Cari ödeme {money(snap.cashPayments)}
              {' '}− Çıkan {money(cashOutN)}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Olması gereken</span><strong>{money(expected)}</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Sayılan</span>
              <span style={{ color: toneVar(diffTone(round2(counted - expected))), fontWeight: 700 }}>
                {money(counted)} {money(round2(counted - expected))} {toneMark(diffTone(round2(counted - expected)))}
              </span>
            </div>
            <div style={{ color: 'var(--pos-text-muted)' }}>
              Veresiye {money(snap.onAccount)} · İskonto {money(snap.discount)} · {snap.saleCount} satış · {snap.refundCount} iade
            </div>
            <div style={{ background: badgeBg, color: 'var(--pos-primary-text)', borderRadius: 10, padding: '10px 12px', fontWeight: 700 }}>
              TOPLAM FARK {money(totalDiff)} ({diffWord})
            </div>
            <input value={note} onChange={e => setNote(e.target.value)} placeholder={noteRequired(totalDiff) ? 'Açıklama zorunlu' : 'Açıklama'} style={{ ...fieldStyle, textAlign: 'left' }} />
            <AmountField label="Devredilen nakit" value={carry} onOpen={() => openPad('Devredilen nakit', carry, v => commitAmount(v, setCarry))} />
            {error && <div style={{ color: 'var(--pos-danger)' }}>{error}</div>}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button type="button" onClick={() => void printResult()} style={secondaryBtn}>Yazdır</button>
              <button type="button" disabled={busy} onClick={() => void tryClose()} style={primaryBtn}>Kaydet ve Kapat</button>
            </div>
          </div>
        )}
      </div>

      {pad && (
        <NumPad
          title={pad.title}
          value={pad.value}
          onChange={v => setPad(p => p ? { ...p, value: v } : p)}
          onConfirm={v => { pad.onConfirm(v); setPad(null) }}
          onClose={() => setPad(null)}
        />
      )}

      {lockAsk && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 55, background: 'var(--pos-scrim)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div style={{ background: 'var(--pos-surface)', color: 'var(--pos-text)', border: '1px solid var(--pos-border)', borderRadius: 16, padding: 16, width: 'min(460px, 100%)', display: 'grid', gap: 12 }}>
            <div>Girdiğiniz tutarlar kilitlenecek ve değiştirilemeyecek. Sonrasında sistem tutarları ve farklar gösterilecek. Devam edilsin mi?</div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button type="button" onClick={() => setLockAsk(false)} style={secondaryBtn}>Vazgeç</button>
              <button type="button" disabled={busy} onClick={() => void lock(cardEntered, otherEntered)} style={primaryBtn}>Kilitle</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
