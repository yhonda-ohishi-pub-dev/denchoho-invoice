<script setup lang="ts">
import type { Invoice } from '~/types/invoice'
import type { MFTransaction, ReconcileResult, ReconcileStatus } from '~/types/reconcile'

useHead({ title: '突合' })

const { parseCSV, reconcile } = useReconcile()
const { searchInvoices, addInvoice } = useDatabase()
const { getViewUrl, uploadFile } = useGoogleDrive()
const { parseInvoice, hasApiKey } = useGemini()

const results = ref<ReconcileResult[]>([])
const parsedTransactions = ref<MFTransaction[]>([])
const loading = ref(false)
const error = ref('')
const fileName = ref('')
const filter = ref<'all' | 'unmatched' | 'matched' | 'not_applicable'>('all')

// PDF アップロード用
const pdfInput = ref<HTMLInputElement>()
const uploadingIdx = ref<number | null>(null)
const uploadError = ref('')

const filteredResults = computed(() => {
  if (filter.value === 'all') return results.value
  return results.value.filter(r => r.status === filter.value)
})

const summary = computed(() => {
  const total = results.value.length
  const matched = results.value.filter(r => r.status === 'matched').length
  const unmatched = results.value.filter(r => r.status === 'unmatched').length
  const notApplicable = results.value.filter(r => r.status === 'not_applicable').length
  return { total, matched, unmatched, notApplicable }
})

const statusLabel: Record<ReconcileStatus, string> = {
  matched: 'マッチ',
  unmatched: '未マッチ',
  not_applicable: '対象外',
}

const statusColor = {
  matched: 'success',
  unmatched: 'error',
  not_applicable: 'neutral',
} as const

/** CSVアップロード後の突合を再実行 */
async function runReconcile() {
  const dates = parsedTransactions.value.map(t => t.date).filter(Boolean)
  if (dates.length === 0) return

  const dateFrom = dates.reduce((a, b) => (a < b ? a : b), dates[0]!)
  const dateTo = dates.reduce((a, b) => (a > b ? a : b), dates[0]!)

  const invoices = await searchInvoices({ dateFrom, dateTo })
  results.value = reconcile(parsedTransactions.value, invoices)
}

async function handleFileChange(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return

  loading.value = true
  error.value = ''
  fileName.value = file.name

  try {
    parsedTransactions.value = await parseCSV(file)
    await runReconcile()
  } catch (e: any) {
    error.value = e.message || 'CSVの読み込みに失敗しました'
  } finally {
    loading.value = false
  }
}

function handleDrop(event: DragEvent) {
  event.preventDefault()
  const file = event.dataTransfer?.files[0]
  if (!file) return

  const fakeEvent = { target: { files: [file] } } as unknown as Event
  handleFileChange(fakeEvent)
}

function handleDragOver(event: DragEvent) {
  event.preventDefault()
}

/** 未マッチ行にPDF/画像をアップロードして登録 */
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

    // ファイルをbase64に変換
    const base64 = await fileToBase64(file)
    const mimeType = file.type || 'application/pdf'

    // Gemini で解析
    const parsed = await parseInvoice(base64, mimeType)

    // Google Drive にアップロード
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

    // IndexedDB に保存
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

    // 突合を再実行
    await runReconcile()
  } catch (e: any) {
    uploadError.value = e.message || 'アップロードに失敗しました'
  } finally {
    uploadingIdx.value = null
    // ファイル入力をリセット
    if (input) input.value = ''
  }
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = reader.result as string
      // data:mime;base64,XXXX → XXXX 部分を取得
      const base64 = dataUrl.split(',')[1]
      if (base64) resolve(base64)
      else reject(new Error('ファイルの読み込みに失敗しました'))
    }
    reader.onerror = () => reject(new Error('ファイルの読み込みに失敗しました'))
    reader.readAsDataURL(file)
  })
}
</script>

<template>
  <div class="space-y-6">
    <h2 class="text-2xl font-bold">突合</h2>

    <!-- CSV アップロード -->
    <UCard>
      <div
        class="border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg p-8 text-center cursor-pointer hover:border-primary transition-colors"
        @drop="handleDrop"
        @dragover="handleDragOver"
        @click="($refs.fileInput as HTMLInputElement)?.click()"
      >
        <div class="text-4xl mb-2">📄</div>
        <p class="text-lg font-medium mb-1">Money Forward 仕訳帳CSVをアップロード</p>
        <p class="text-sm text-dimmed">クリックまたはドラッグ&ドロップ</p>
        <p v-if="fileName" class="mt-2 text-sm text-primary">{{ fileName }}</p>
        <input
          ref="fileInput"
          type="file"
          accept=".csv"
          class="hidden"
          @change="handleFileChange"
        >
      </div>
    </UCard>

    <!-- ローディング -->
    <div v-if="loading" class="text-center py-8">
      <UIcon name="i-lucide-loader-2" class="animate-spin text-2xl" />
      <p class="mt-2">CSVを解析中...</p>
    </div>

    <!-- PDF アップロード用 hidden input -->
    <input
      ref="pdfInput"
      type="file"
      accept=".pdf,image/*"
      class="hidden"
      @change="handlePdfChange"
    >

    <!-- エラー -->
    <UAlert v-if="error" color="error" :title="error" icon="i-lucide-alert-circle" />
    <UAlert v-if="uploadError" color="error" :title="uploadError" icon="i-lucide-alert-circle" closable @close="uploadError = ''" />

    <!-- サマリー -->
    <div v-if="results.length > 0" class="grid grid-cols-2 md:grid-cols-4 gap-4">
      <UCard>
        <div class="text-center">
          <div class="text-2xl font-bold">{{ summary.total }}</div>
          <div class="text-sm text-dimmed">全取引</div>
        </div>
      </UCard>
      <UCard>
        <div class="text-center">
          <div class="text-2xl font-bold text-green-600">{{ summary.matched }}</div>
          <div class="text-sm text-dimmed">マッチ済み</div>
        </div>
      </UCard>
      <UCard>
        <div class="text-center">
          <div class="text-2xl font-bold text-red-600">{{ summary.unmatched }}</div>
          <div class="text-sm text-dimmed">未マッチ（要対応）</div>
        </div>
      </UCard>
      <UCard>
        <div class="text-center">
          <div class="text-2xl font-bold text-gray-400">{{ summary.notApplicable }}</div>
          <div class="text-sm text-dimmed">対象外</div>
        </div>
      </UCard>
    </div>

    <!-- フィルター & 結果テーブル -->
    <UCard v-if="results.length > 0">
      <template #header>
        <div class="flex items-center justify-between">
          <span class="font-semibold">突合結果（{{ filteredResults.length }} 件）</span>
          <div class="flex gap-2">
            <UButton
              size="xs"
              :variant="filter === 'all' ? 'solid' : 'ghost'"
              @click="filter = 'all'"
            >
              全件
            </UButton>
            <UButton
              size="xs"
              color="error"
              :variant="filter === 'unmatched' ? 'solid' : 'ghost'"
              @click="filter = 'unmatched'"
            >
              未マッチ
            </UButton>
            <UButton
              size="xs"
              color="success"
              :variant="filter === 'matched' ? 'solid' : 'ghost'"
              @click="filter = 'matched'"
            >
              マッチ済み
            </UButton>
            <UButton
              size="xs"
              color="neutral"
              :variant="filter === 'not_applicable' ? 'solid' : 'ghost'"
              @click="filter = 'not_applicable'"
            >
              対象外
            </UButton>
          </div>
        </div>
      </template>

      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead>
            <tr class="border-b border-default text-left">
              <th class="pb-2 pr-4">取引日</th>
              <th class="pb-2 pr-4">勘定科目</th>
              <th class="pb-2 pr-4 text-right">金額</th>
              <th class="pb-2 pr-4">摘要</th>
              <th class="pb-2 pr-4">税区分</th>
              <th class="pb-2 pr-4">突合</th>
              <th class="pb-2 pr-4">対応書類</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="(r, idx) in filteredResults"
              :key="idx"
              class="border-b border-muted"
              :class="{
                'bg-green-50 dark:bg-green-950/20': r.status === 'matched',
                'bg-red-50 dark:bg-red-950/20': r.status === 'unmatched',
                'opacity-50': r.status === 'not_applicable',
              }"
            >
              <td class="py-2 pr-4 whitespace-nowrap">{{ r.transaction.date }}</td>
              <td class="py-2 pr-4">{{ r.transaction.primaryAccount }}</td>
              <td class="py-2 pr-4 text-right whitespace-nowrap">{{ formatAmount(r.transaction.amount) }}</td>
              <td class="py-2 pr-4 max-w-xs truncate" :title="r.transaction.description">
                {{ r.transaction.description }}
              </td>
              <td class="py-2 pr-4 whitespace-nowrap">
                <span v-if="r.transaction.taxCategory" class="text-xs">{{ r.transaction.taxCategory }}</span>
                <span v-else class="text-xs text-dimmed">--</span>
              </td>
              <td class="py-2 pr-4">
                <UBadge :color="statusColor[r.status]" variant="subtle" size="xs">
                  {{ statusLabel[r.status] }}
                </UBadge>
              </td>
              <td class="py-2 pr-4">
                <template v-if="r.matchedInvoice">
                  <div class="text-xs">{{ r.matchedInvoice.counterparty }}</div>
                  <UButton
                    v-if="r.matchedInvoice.driveFileId"
                    icon="i-lucide-external-link"
                    variant="ghost"
                    size="xs"
                    :to="getViewUrl(r.matchedInvoice.driveFileId)"
                    target="_blank"
                    label="書類"
                  />
                </template>
                <template v-else-if="r.status === 'unmatched'">
                  <UButton
                    v-if="uploadingIdx !== idx"
                    icon="i-lucide-upload"
                    variant="soft"
                    color="error"
                    size="xs"
                    label="PDF登録"
                    @click="startPdfUpload(idx)"
                  />
                  <span v-else class="text-xs flex items-center gap-1">
                    <UIcon name="i-lucide-loader-2" class="animate-spin" /> 処理中...
                  </span>
                </template>
                <span v-else class="text-xs text-dimmed">--</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </UCard>
  </div>
</template>
