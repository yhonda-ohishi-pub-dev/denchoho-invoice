<script setup lang="ts">
import type { MFTransaction, ReconcileResult } from '~/types/reconcile'

useHead({ title: '突合' })

const { reconcile } = useReconcile()
const { searchInvoices, addInvoice, updateInvoice } = useDatabase()
const { uploadFile, moveFileToMain, moveFileToTmp } = useGoogleDrive()
const { parseInvoice, hasApiKey } = useGemini()

const results = ref<ReconcileResult[]>([])
const parsedTransactions = ref<MFTransaction[]>([])

// 行単位 PDF アップロード用
const pdfInput = ref<HTMLInputElement>()
const uploadingIdx = ref<number | null>(null)
const uploadError = ref('')

// Gmail 検索用
const gmailTargetTransaction = ref<MFTransaction>()
const showImportTools = ref(false)
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
  showImportTools.value = false
  runReconcile()
}

function handleGmailSearchForRow(transaction: MFTransaction) {
  gmailTargetTransaction.value = { ...transaction }
  showImportTools.value = true
  activeImportTab.value = 'gmail'
  nextTick(() => {
    document.getElementById('import-tools')?.scrollIntoView({ behavior: 'smooth' })
  })
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

/** 行単位 PDF アップロード */
function startPdfUpload(resultIdx: number) {
  uploadingIdx.value = resultIdx
  uploadError.value = ''
  pdfInput.value?.click()
}

async function handlePdfChange(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file || uploadingIdx.value === null) return

  const idx = uploadingIdx.value
  const r = results.value[idx]
  if (!r) return

  uploadError.value = ''

  try {
    if (!hasApiKey()) {
      throw new Error('Gemini API キーが設定されていません。設定画面で入力してください。')
    }

    const base64 = await fileToBase64(file)
    const mimeType = file.type || 'application/pdf'

    const parsed = await parseInvoice(base64, mimeType)

    let driveFileId: string | undefined
    let driveFileName: string | undefined
    try {
      const ext = file.name.includes('.') ? file.name.substring(file.name.lastIndexOf('.')) : ''
      const safeName = parsed.counterparty.replace(/[/\\:*?"<>|]/g, '_').substring(0, 30)
      const uploadName = `${parsed.transactionDate}_${safeName}${ext}`
      const driveFile = await uploadFile(base64, uploadName, mimeType)
      driveFileId = driveFile.id
      driveFileName = uploadName
    } catch (driveErr: any) {
      console.warn('Drive upload failed:', driveErr.message)
    }

    await addInvoice({
      transactionDate: parsed.transactionDate,
      amount: parsed.amount,
      currency: parsed.currency || 'JPY',
      counterparty: parsed.counterparty,
      documentType: parsed.documentType,
      sourceType: 'manual',
      driveFileId,
      driveFileName: driveFileName || file.name,
      extractedData: JSON.stringify(parsed),
      memo: parsed.memo || '',
    })

    await handleImported()
  } catch (e: any) {
    uploadError.value = e.message || 'アップロードに失敗しました'
  } finally {
    uploadingIdx.value = null
    if (input) input.value = ''
  }
}
</script>

<template>
  <div class="space-y-6">
    <h2 class="text-2xl font-bold">突合</h2>

    <!-- Step 1: CSV アップロード -->
    <ReconcileCsvUpload @parsed="handleCsvParsed" />

    <!-- 行単位 PDF 用 hidden input -->
    <input
      ref="pdfInput"
      type="file"
      accept=".pdf,image/*"
      class="hidden"
      @change="handlePdfChange"
    >

    <!-- エラー -->
    <UAlert
      v-if="uploadError"
      color="error"
      :title="uploadError"
      icon="i-lucide-alert-circle"
      closable
      @close="uploadError = ''"
    />

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
        <div class="flex items-center justify-between">
          <span class="font-semibold">
            未マッチ取引の書類取込（{{ summary.unmatched }} 件）
          </span>
          <UButton
            :icon="showImportTools ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"
            variant="ghost"
            size="xs"
            @click="showImportTools = !showImportTools"
          />
        </div>
      </template>

      <div v-if="showImportTools">
        <UTabs
          v-model="activeImportTab"
          :items="[
            { label: 'Gmail検索', icon: 'i-lucide-mail', value: 'gmail', slot: 'gmail' },
            { label: 'PDF/画像一括登録', icon: 'i-lucide-file-up', value: 'upload', slot: 'upload' },
          ]"
        >
          <template #gmail>
            <ReconcileGmailSearch
              :target-transaction="gmailTargetTransaction"
              :unmatched-transactions="unmatchedTransactions"
              @imported="handleImported"
            />
          </template>
          <template #upload>
            <ReconcileBulkUpload @imported="handleImported" />
          </template>
        </UTabs>
      </div>
    </UCard>

    <!-- Step 4: 突合結果テーブル -->
    <ReconcileResultTable
      v-if="results.length > 0"
      :results="results"
      :uploading-idx="uploadingIdx"
      @start-pdf-upload="startPdfUpload"
      @start-gmail-search="handleGmailSearchForRow"
    />
  </div>
</template>
