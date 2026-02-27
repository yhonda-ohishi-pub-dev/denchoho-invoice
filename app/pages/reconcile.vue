<script setup lang="ts">
import type { MFTransaction, ReconcileResult } from '~/types/reconcile'

useHead({ title: '突合' })

const { reconcile } = useReconcile()
const { searchInvoices, updateInvoice } = useDatabase()
const { moveFileToMain, moveFileToTmp } = useGoogleDrive()

const results = ref<ReconcileResult[]>([])
const parsedTransactions = ref<MFTransaction[]>([])

const activeImportTab = ref('gmail')

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

/** CSV の日付範囲でインボイスを検索して突合実行 */
async function runReconcile() {
  const dates = parsedTransactions.value.map(t => t.date).filter(Boolean)
  if (dates.length === 0) return

  const dateFrom = dates.reduce((a, b) => (a < b ? a : b), dates[0]!)
  const dateTo = dates.reduce((a, b) => (a > b ? a : b), dates[0]!)

  const invoices = await searchInvoices({ dateFrom, dateTo })
  results.value = reconcile(parsedTransactions.value, invoices)
}

function handleCsvParsed(transactions: MFTransaction[]) {
  parsedTransactions.value = transactions
  runReconcile()
}

async function handleImported() {
  await runReconcile()
  await organizeByReconcileStatus()
}

/** 突合結果に基づいて Drive ファイルを整理 */
async function organizeByReconcileStatus() {
  organizing.value = true
  try {
    // マッチ済みインボイスで tmp にあるもの → メインに移動
    for (const r of results.value) {
      if (r.status === 'matched' && r.matchedInvoice?.driveFileId && r.matchedInvoice.driveFolder === 'tmp') {
        try {
          await moveFileToMain(r.matchedInvoice.driveFileId)
          if (r.matchedInvoice.id) {
            await updateInvoice(r.matchedInvoice.id, { driveFolder: 'main' })
          }
        } catch (e: any) {
          console.warn('Failed to move file to main:', e.message)
        }
      }
    }

    // 未マッチインボイス（日付範囲内でどのMF取引にもマッチしなかったもの）を tmp に移動
    const matchedInvoiceIds = new Set(
      results.value
        .filter(r => r.status === 'matched' && r.matchedInvoice?.id)
        .map(r => r.matchedInvoice!.id),
    )

    const dates = parsedTransactions.value.map(t => t.date).filter(Boolean)
    if (dates.length > 0) {
      const dateFrom = dates.reduce((a, b) => (a < b ? a : b))
      const dateTo = dates.reduce((a, b) => (a > b ? a : b))
      const allInvoices = await searchInvoices({ dateFrom, dateTo })

      for (const inv of allInvoices) {
        if (!matchedInvoiceIds.has(inv.id) && inv.driveFileId && inv.driveFolder !== 'tmp') {
          try {
            await moveFileToTmp(inv.driveFileId)
            if (inv.id) {
              await updateInvoice(inv.id, { driveFolder: 'tmp' })
            }
          } catch (e: any) {
            console.warn('Failed to move file to tmp:', e.message)
          }
        }
      }
    }
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
    <ReconcileSummary v-if="results.length > 0" :summary="summary" />

    <!-- Drive 整理中 -->
    <UAlert
      v-if="organizing"
      color="info"
      icon="i-lucide-folder-sync"
      title="Drive ファイルを整理中..."
    />

    <!-- Step 3: 未マッチ取引の書類取込 -->
    <UCard v-if="summary.unmatched > 0" id="import-tools">
      <template #header>
        <span class="font-semibold">
          未マッチ取引の書類取込（{{ summary.unmatched }} 件）
        </span>
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
      :results="results"
    />
  </div>
</template>
