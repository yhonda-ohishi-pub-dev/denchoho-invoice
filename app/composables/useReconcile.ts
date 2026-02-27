import type { Invoice } from '~/types/invoice'
import type { MFJournalRow, MFTransaction, ReconcileResult } from '~/types/reconcile'

/** CSVフィールドをパース（ダブルクォート対応） */
function parseCSVLine(line: string): string[] {
  const fields: string[] = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < line.length; i++) {
    const char = line[i]
    if (inQuotes) {
      if (char === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        current += char
      }
    } else {
      if (char === '"') {
        inQuotes = true
      } else if (char === ',') {
        fields.push(current)
        current = ''
      } else {
        current += char
      }
    }
  }
  fields.push(current)
  return fields
}

/** YYYY/MM/DD → YYYY-MM-DD */
function convertDate(mfDate: string): string {
  return mfDate.replace(/\//g, '-')
}

/** CSVの1行を MFJournalRow に変換 */
function rowFromFields(fields: string[]): MFJournalRow {
  return {
    transactionNo: fields[0] || '',
    date: fields[1] ? convertDate(fields[1]) : '',
    debitAccount: fields[2] || '',
    debitSubAccount: fields[3] || '',
    debitDepartment: fields[4] || '',
    debitCounterparty: fields[5] || '',
    debitTaxCategory: fields[6] || '',
    debitInvoice: fields[7] || '',
    debitAmount: parseInt(fields[8] || '0', 10) || 0,
    creditAccount: fields[9] || '',
    creditSubAccount: fields[10] || '',
    creditDepartment: fields[11] || '',
    creditCounterparty: fields[12] || '',
    creditTaxCategory: fields[13] || '',
    creditInvoice: fields[14] || '',
    creditAmount: parseInt(fields[15] || '0', 10) || 0,
    description: fields[16] || '',
    tag: fields[17] || '',
    memo: fields[18] || '',
  }
}

/** 税区分に「課税」が含まれるか判定 */
function hasTaxableCategory(row: MFJournalRow): boolean {
  return row.debitTaxCategory.includes('課税') || row.creditTaxCategory.includes('課税')
}

/** 取引グループからメイン勘定科目・金額・税区分を決定 */
function resolveTransaction(rows: MFJournalRow[]): {
  primaryAccount: string
  amount: number
  taxCategory: string
} {
  // 課税仕入のある行を優先
  for (const row of rows) {
    if (row.debitTaxCategory.includes('課税仕入')) {
      return {
        primaryAccount: row.debitAccount,
        amount: row.debitAmount,
        taxCategory: row.debitTaxCategory,
      }
    }
    if (row.creditTaxCategory.includes('課税売上')) {
      return {
        primaryAccount: row.creditAccount,
        amount: row.creditAmount,
        taxCategory: row.creditTaxCategory,
      }
    }
  }
  // 課税区分がない場合は最初の行の借方を使用
  const first = rows[0]!
  const taxCat = first.debitTaxCategory || first.creditTaxCategory
  return {
    primaryAccount: first.debitAccount || first.creditAccount,
    amount: first.debitAmount || first.creditAmount,
    taxCategory: taxCat,
  }
}

export function useReconcile() {
  /** Money Forward 仕訳帳CSVをパースして取引リストを返す */
  async function parseCSV(file: File): Promise<MFTransaction[]> {
    const buffer = await file.arrayBuffer()
    const decoder = new TextDecoder('shift_jis')
    const text = decoder.decode(buffer)

    const lines = text.split(/\r?\n/).filter(line => line.trim())
    // ヘッダー行をスキップ
    const dataLines = lines.slice(1)

    // 全行パース
    const allRows: MFJournalRow[] = dataLines.map(line => rowFromFields(parseCSVLine(line)))

    // 取引Noでグループ化（出現順を保持）
    const groups = new Map<string, MFJournalRow[]>()
    const order: string[] = []
    for (const row of allRows) {
      if (!row.transactionNo) continue
      if (!groups.has(row.transactionNo)) {
        groups.set(row.transactionNo, [])
        order.push(row.transactionNo)
      }
      groups.get(row.transactionNo)!.push(row)
    }

    // 取引単位にまとめる（日付順にソート）
    const transactions: MFTransaction[] = order.map((no) => {
      const rows = groups.get(no)!
      const firstRow = rows[0]!
      const description = rows.find(r => r.description)?.description || ''
      const needsDocument = rows.some(hasTaxableCategory)
      const { primaryAccount, amount, taxCategory } = resolveTransaction(rows)

      return {
        transactionNo: no,
        date: firstRow.date,
        rows,
        description,
        needsDocument,
        primaryAccount,
        amount,
        taxCategory,
      }
    })

    // 日付順にソート
    transactions.sort((a, b) => a.date.localeCompare(b.date))

    return transactions
  }

  /** 摘要からマッチング用キーワードを抽出 */
  function extractKeywords(description: string): string[] {
    // "VISA海外利用 GITHUB, INC." → ["GITHUB", "INC"]
    // "VISA国内利用 VS カゴヤ ジヤパン" → ["カゴヤ", "ジヤパン"]
    return description
      .replace(/^VISA[^\s]*\s*(VS\s+)?/i, '')
      .replace(/[,.*()（）]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length >= 2)
      .map(w => w.toUpperCase())
  }

  /** 取引先名と摘要キーワードのあいまいマッチ */
  function fuzzyMatchCounterparty(invoiceCounterparty: string, mfDescription: string): boolean {
    if (!invoiceCounterparty || !mfDescription) return false

    const keywords = extractKeywords(mfDescription)
    if (keywords.length === 0) return false

    const counterpartyUpper = invoiceCounterparty.toUpperCase()

    // インボイスの取引先名が摘要キーワードのいずれかを含む、または逆
    return keywords.some(kw =>
      counterpartyUpper.includes(kw) || kw.includes(counterpartyUpper)
    )
  }

  /** 請求書日付がMF取引日付の maxDays 日前以内かを判定 */
  function isDateInRange(invoiceDate: string, txDate: string, maxDays: number): boolean {
    if (maxDays === 0) return invoiceDate === txDate
    const invTime = new Date(invoiceDate).getTime()
    const txTime = new Date(txDate).getTime()
    const diffDays = (txTime - invTime) / (1000 * 60 * 60 * 24)
    return diffDays >= 0 && diffDays <= maxDays
  }

  /** 日付差（日数）を返す */
  function dateDiff(invoiceDate: string, txDate: string): number {
    return (new Date(txDate).getTime() - new Date(invoiceDate).getTime()) / (1000 * 60 * 60 * 24)
  }

  /** MF取引リストとインボイスを突合 */
  function reconcile(transactions: MFTransaction[], invoices: Invoice[], dateTolerance: number = 0): ReconcileResult[] {
    // インボイスのコピーを作り、マッチ済みを追跡
    const availableInvoices = invoices.map(inv => ({ ...inv, _used: false }))

    console.group('[reconcile] 突合開始')
    console.log(`MF取引: ${transactions.length}件, インボイス: ${invoices.length}件, 許容日数: ${dateTolerance}日`)
    console.log('インボイス一覧:', invoices.map(inv => ({ date: inv.transactionDate, amount: inv.amount, counterparty: inv.counterparty })))

    function markMatched(tx: MFTransaction, match: typeof availableInvoices[number]): ReconcileResult {
      match._used = true
      const { _used, ...invoice } = match
      return {
        transaction: tx,
        status: 'matched' as const,
        matchedInvoice: invoice as Invoice,
      }
    }

    /** 候補から日付が最も近いものを選択 */
    function findClosest(candidates: typeof availableInvoices, txDate: string) {
      if (candidates.length === 0) return undefined
      return candidates.reduce((closest, inv) =>
        dateDiff(inv.transactionDate, txDate) < dateDiff(closest.transactionDate, txDate) ? inv : closest
      )
    }

    const results = transactions.map((tx) => {
      if (!tx.needsDocument) {
        return { transaction: tx, status: 'not_applicable' as const }
      }

      // 各インボイスとの比較詳細をログ出力
      const debugInvoices = availableInvoices
        .filter(inv => !inv._used)
        .map(inv => ({
          counterparty: inv.counterparty,
          date: inv.transactionDate,
          amount: inv.amount,
          dateDiff: Math.round(dateDiff(inv.transactionDate, tx.date) * 10) / 10,
          dateInRange: isDateInRange(inv.transactionDate, tx.date, dateTolerance),
          amountMatch: inv.amount === tx.amount,
          fuzzyMatch: fuzzyMatchCounterparty(inv.counterparty, tx.description),
          keywords: extractKeywords(tx.description),
        }))

      // 1. 日付範囲内 + 金額一致（日付が近いものを優先）
      const amountMatches = availableInvoices.filter(
        inv => !inv._used && isDateInRange(inv.transactionDate, tx.date, dateTolerance) && inv.amount === tx.amount
      )
      const exactMatch = findClosest(amountMatches, tx.date)
      if (exactMatch) {
        console.log(`%c[MATCH] No.${tx.transactionNo} ${tx.date} ¥${tx.amount} "${tx.description}" → 金額一致: ${exactMatch.counterparty}`, 'color: green')
        return markMatched(tx, exactMatch)
      }

      // 2. 日付範囲内 + 取引先名のあいまいマッチ（外貨取引など金額が異なるケース）
      const fuzzyMatches = availableInvoices.filter(
        inv => !inv._used && isDateInRange(inv.transactionDate, tx.date, dateTolerance) && fuzzyMatchCounterparty(inv.counterparty, tx.description)
      )
      const fuzzyMatch = findClosest(fuzzyMatches, tx.date)
      if (fuzzyMatch) {
        console.log(`%c[MATCH] No.${tx.transactionNo} ${tx.date} ¥${tx.amount} "${tx.description}" → 取引先一致: ${fuzzyMatch.counterparty}`, 'color: green')
        return markMatched(tx, fuzzyMatch)
      }

      console.log(`%c[UNMATCH] No.${tx.transactionNo} ${tx.date} ¥${tx.amount} "${tx.description}"`, 'color: red')
      console.table(debugInvoices)

      return { transaction: tx, status: 'unmatched' as const }
    })

    console.groupEnd()
    return results
  }

  return { parseCSV, reconcile }
}
