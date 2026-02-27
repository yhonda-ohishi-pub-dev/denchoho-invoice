<script setup lang="ts">
import type { Invoice } from '~/types/invoice'
import type { ReconcileResult, ReconcileStatus } from '~/types/reconcile'

useHead({ title: '突合' })

const { parseCSV, reconcile } = useReconcile()
const { searchInvoices } = useDatabase()
const { getViewUrl } = useGoogleDrive()

const results = ref<ReconcileResult[]>([])
const loading = ref(false)
const error = ref('')
const fileName = ref('')
const filter = ref<'all' | 'unmatched' | 'matched' | 'not_applicable'>('all')

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

async function handleFileChange(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return

  loading.value = true
  error.value = ''
  fileName.value = file.name

  try {
    const transactions = await parseCSV(file)

    // 日付範囲を取得してインボイスを検索
    const dates = transactions.map(t => t.date).filter(Boolean)
    const dateFrom = dates.reduce((a, b) => (a < b ? a : b), dates[0] || '')
    const dateTo = dates.reduce((a, b) => (a > b ? a : b), dates[0] || '')

    let invoices: Invoice[] = []
    if (dateFrom && dateTo) {
      invoices = await searchInvoices({ dateFrom, dateTo })
    }

    results.value = reconcile(transactions, invoices)
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

  // ファイル入力を模擬
  const fakeEvent = { target: { files: [file] } } as unknown as Event
  handleFileChange(fakeEvent)
}

function handleDragOver(event: DragEvent) {
  event.preventDefault()
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

    <!-- エラー -->
    <UAlert v-if="error" color="error" :title="error" icon="i-lucide-alert-circle" />

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
                <span v-else-if="r.status === 'unmatched'" class="text-xs text-red-500">証憑なし</span>
                <span v-else class="text-xs text-dimmed">--</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </UCard>
  </div>
</template>
