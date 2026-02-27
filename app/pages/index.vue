<script setup lang="ts">
import type { MFTransaction, ReconcileResult, ReconcileStatus } from '~/types/reconcile'

useHead({ title: '突合' })

const { reconcile } = useReconcile()
const { searchInvoices, updateInvoice, isGmailMessageImported, buildSQLiteData } = useDatabase()
const { moveFileBetweenFolders, uploadFile } = useGoogleDrive()
const { reconcileDateTolerance, senderAddresses } = useSettings()
const { isLoggedIn } = useGoogleAuth()
const { searchEmails } = useGmail()
const { importEmails, importing } = useImport()

const results = ref<ReconcileResult[]>([])
const storedTransactions = useSessionStorage<MFTransaction[]>('reconcile-transactions', [])
const parsedTransactions = ref<MFTransaction[]>(storedTransactions.value)

const activeImportTab = ref('gmail')
const resultFilter = ref<ReconcileStatus | 'all'>('all')

// Drive 整理中フラグ
const organizing = ref(false)

const summary = computed(() => {
  const total = results.value.length
  const matched = results.value.filter(r => r.status === 'matched').length
  const unmatched = results.value.filter(r => r.status === 'unmatched').length
  const notApplicable = results.value.filter(r => r.status === 'not_applicable').length
  return { total, matched, unmatched, notApplicable }
})

const unmatchedTransactions = computed(() =>
  results.value
    .filter(r => r.status === 'unmatched')
    .map(r => r.transaction),
)

/** 全インボイスを検索して突合実行（日付の近さはマッチングアルゴリズムが制御） */
async function runReconcile() {
  if (parsedTransactions.value.length === 0) return

  const tolerance = reconcileDateTolerance.value
  const invoices = await searchInvoices({})
  results.value = reconcile(parsedTransactions.value, invoices, tolerance)
}

function handleCsvParsed(transactions: MFTransaction[]) {
  parsedTransactions.value = transactions
  storedTransactions.value = transactions
  runReconcile()
}

// ページ読み込み時に保存済みデータがあれば突合を再実行
onMounted(() => {
  if (parsedTransactions.value.length > 0) {
    runReconcile()
  }
})

async function handleImported() {
  await runReconcile()
  await organizeByReconcileStatus()
  const { base64, filename } = await buildSQLiteData()
  await uploadFile(base64, filename, 'application/x-sqlite3')
}

/** 未マッチ取引の日付範囲で Gmail を一括検索し、未取込メールを自動取り込み */
const reimporting = ref(false)
async function handleBulkReimport() {
  const allDates = unmatchedTransactions.value.map(t => t.date).filter(Boolean)
  if (allDates.length === 0) return

  reimporting.value = true
  try {
    const minDate = allDates.reduce((a, b) => (a < b ? a : b))
    const maxDate = allDates.reduce((a, b) => (a > b ? a : b))
    const from = new Date(minDate)
    from.setDate(from.getDate() - 7)
    const to = new Date(maxDate)
    to.setDate(to.getDate() + 7)

    const result = await searchEmails({
      fromAddresses: senderAddresses.value.length ? [...senderAddresses.value] : undefined,
      dateFrom: from.toISOString().slice(0, 10),
      dateTo: to.toISOString().slice(0, 10),
      hasAttachment: true,
      maxResults: 50,
    })

    // 未取込のメールだけフィルタ
    const newEmails = []
    for (const msg of result.messages) {
      if (!(await isGmailMessageImported(msg.id))) {
        newEmails.push(msg)
      }
    }

    if (newEmails.length === 0) {
      alert('新しいメールは見つかりませんでした')
      return
    }

    await importEmails(newEmails)
    await handleImported()
  } catch (e: any) {
    console.error('Bulk reimport error:', e)
    alert(e.message || 'メール取り込み中にエラーが発生しました')
  } finally {
    reimporting.value = false
  }
}

/** 突合結果に基づいて Drive ファイルを年フォルダに整理 */
async function organizeByReconcileStatus() {
  organizing.value = true
  try {
    console.group('[Drive整理] 開始')

    // マッチ済みインボイス → 仕訳帳の取引年フォルダに移動（tmp, main, 別の年フォルダから）
    for (const r of results.value) {
      if (r.status !== 'matched' || !r.matchedInvoice?.driveFileId) continue
      const year = r.transaction.date.slice(0, 4)
      const currentFolder = r.matchedInvoice.driveFolder || 'main'
      if (currentFolder === year) {
        console.log(`[Drive整理] スキップ（既に ${year}）: ${r.matchedInvoice.counterparty} ¥${r.matchedInvoice.amount}`)
        continue
      }
      try {
        console.log(`%c[Drive整理] マッチ → 年フォルダ: ${r.matchedInvoice.counterparty} ¥${r.matchedInvoice.amount} [${currentFolder} → ${year}]`, 'color: green')
        await moveFileBetweenFolders(r.matchedInvoice.driveFileId, currentFolder, year)
        if (r.matchedInvoice.id) {
          await updateInvoice(r.matchedInvoice.id, { driveFolder: year })
        }
      } catch (e: any) {
        console.warn(`[Drive整理] 移動失敗（年フォルダ）: ${r.matchedInvoice.counterparty}`, e.message)
      }
    }

    // 未マッチインボイス（CSVの日付範囲内のもののみ）を tmp に移動
    const matchedInvoiceIds = new Set(
      results.value
        .filter(r => r.status === 'matched' && r.matchedInvoice?.id)
        .map(r => r.matchedInvoice!.id),
    )

    const dates = parsedTransactions.value.map(t => t.date).filter(Boolean)
    if (dates.length > 0) {
      const minDate = dates.reduce((a, b) => (a < b ? a : b))
      const maxDate = dates.reduce((a, b) => (a > b ? a : b))
      const tolerance = reconcileDateTolerance.value
      // CSV日付範囲 ± 許容日数 をカバー
      const rangeStart = new Date(minDate)
      rangeStart.setDate(rangeStart.getDate() - tolerance)
      const rangeEnd = new Date(maxDate)
      rangeEnd.setDate(rangeEnd.getDate() + tolerance)
      const rangeStartStr = rangeStart.toISOString().slice(0, 10)
      const rangeEndStr = rangeEnd.toISOString().slice(0, 10)

      console.log(`[Drive整理] 未マッチ→tmp 対象範囲: ${rangeStartStr} 〜 ${rangeEndStr}（許容${tolerance}日）`)

      const allInvoices = await searchInvoices({})

      for (const inv of allInvoices) {
        // CSV日付範囲外のインボイスはスキップ（他の年度のデータを保護）
        if (inv.transactionDate < rangeStartStr || inv.transactionDate > rangeEndStr) {
          if (inv.driveFileId) {
            console.log(`[Drive整理] 範囲外スキップ: ${inv.counterparty} ${inv.transactionDate} [${inv.driveFolder || 'main'}]`)
          }
          continue
        }
        if (!matchedInvoiceIds.has(inv.id) && inv.driveFileId && inv.driveFolder !== 'tmp') {
          const currentFolder = inv.driveFolder || 'main'
          try {
            console.log(`%c[Drive整理] 未マッチ → tmp: ${inv.counterparty} ${inv.transactionDate} ¥${inv.amount} [${currentFolder} → tmp]`, 'color: orange')
            await moveFileBetweenFolders(inv.driveFileId, currentFolder, 'tmp')
            if (inv.id) {
              await updateInvoice(inv.id, { driveFolder: 'tmp' })
            }
          } catch (e: any) {
            console.warn(`[Drive整理] 移動失敗（tmp）: ${inv.counterparty}`, e.message)
          }
        }
      }
    }

    console.groupEnd()
  } finally {
    organizing.value = false
    await runReconcile()
  }
}

</script>

<template>
  <div class="space-y-6">
    <h2 class="text-2xl font-bold">突合</h2>

    <!-- Step 1: CSV アップロード -->
    <ReconcileCsvUpload @parsed="handleCsvParsed" />

    <!-- Step 2: サマリー -->
    <ReconcileSummary v-if="results.length > 0" :summary="summary" :active-filter="resultFilter" @filter="resultFilter = $event" />

    <!-- Drive 整理 -->
    <div v-if="summary.matched > 0" class="flex items-center gap-3">
      <UButton
        icon="i-lucide-folder-sync"
        :loading="organizing"
        :disabled="organizing"
        @click="organizeByReconcileStatus"
      >
        Drive 年フォルダ整理
      </UButton>
      <span v-if="organizing" class="text-sm text-dimmed">ファイルを整理中...</span>
    </div>

    <!-- Step 3: 未マッチ取引の書類取込 -->
    <UCard v-if="summary.unmatched > 0" id="import-tools">
      <template #header>
        <div class="flex items-center justify-between">
          <span class="font-semibold">
            未マッチ取引の書類取込（{{ summary.unmatched }} 件）
          </span>
          <UButton
            v-if="isLoggedIn"
            icon="i-lucide-mail"
            :loading="reimporting || importing"
            :disabled="reimporting || importing"
            size="sm"
            @click="handleBulkReimport"
          >
            メール一括取込
          </UButton>
        </div>
      </template>

      <UTabs
        v-model="activeImportTab"
        :items="[
          { label: 'Gmail検索', icon: 'i-lucide-mail', value: 'gmail', slot: 'gmail' },
          { label: 'PDF/画像一括登録', icon: 'i-lucide-file-up', value: 'upload', slot: 'upload' },
        ]"
      >
        <template #gmail>
          <ReconcileGmailSearch
            :unmatched-transactions="unmatchedTransactions"
            @imported="handleImported"
          />
        </template>
        <template #upload>
          <ReconcileBulkUpload @imported="handleImported" />
        </template>
      </UTabs>
    </UCard>

    <!-- Step 4: 突合結果テーブル -->
    <ReconcileResultTable
      v-if="results.length > 0"
      v-model="resultFilter"
      :results="results"
    />
  </div>
</template>
