<script setup lang="ts">
import type { Invoice, DocumentType } from '~/types/invoice'

useHead({ title: 'ダッシュボード' })

const { getInvoices, getInvoiceCount, getMonthlyTotal } = useDatabase()

const recentInvoices = ref<Invoice[]>([])
const totalCount = ref(0)
const monthlyTotal = ref(0)
const loading = ref(true)

const currentMonth = computed(() => {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
})

const docTypeLabels: Record<DocumentType, string> = {
  invoice: '請求書',
  receipt: '領収書',
  quotation: '見積書',
  delivery_slip: '納品書',
  contract: '契約書',
  other: 'その他',
}

onMounted(async () => {
  try {
    recentInvoices.value = await getInvoices(10)
    totalCount.value = await getInvoiceCount()
    monthlyTotal.value = await getMonthlyTotal(currentMonth.value)
  } finally {
    loading.value = false
  }
})
</script>

<template>
  <div class="space-y-6">
    <h2 class="text-2xl font-bold">ダッシュボード</h2>

    <!-- 統計カード -->
    <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
      <UCard>
        <div class="text-center">
          <div class="text-sm text-muted">総登録件数</div>
          <div class="text-3xl font-bold mt-1">{{ totalCount }}</div>
        </div>
      </UCard>
      <UCard>
        <div class="text-center">
          <div class="text-sm text-muted">今月の取引額</div>
          <div class="text-3xl font-bold mt-1">¥{{ monthlyTotal.toLocaleString() }}</div>
        </div>
      </UCard>
      <UCard>
        <div class="text-center">
          <div class="text-sm text-muted">今月</div>
          <div class="text-3xl font-bold mt-1">{{ currentMonth }}</div>
        </div>
      </UCard>
    </div>

    <!-- 最近の取り込み -->
    <UCard>
      <template #header>
        <div class="flex items-center justify-between">
          <span class="font-semibold">最近の取り込み</span>
          <UButton to="/upload" variant="outline" size="sm" icon="i-lucide-mail">
            メール取り込み
          </UButton>
        </div>
      </template>

      <div v-if="loading" class="text-center py-8">
        <UIcon name="i-lucide-loader-circle" class="animate-spin text-2xl" />
      </div>

      <div v-else-if="recentInvoices.length === 0" class="text-center py-8 space-y-3">
        <UIcon name="i-lucide-inbox" class="text-4xl text-muted" />
        <p class="text-muted">まだデータがありません</p>
        <div class="flex justify-center gap-2">
          <UButton to="/upload" icon="i-lucide-mail">メールから取り込む</UButton>
          <UButton to="/settings" variant="outline" icon="i-lucide-settings">設定</UButton>
        </div>
      </div>

      <div v-else class="divide-y divide-default">
        <div v-for="inv in recentInvoices" :key="inv.id" class="flex items-center gap-4 py-3">
          <div class="flex-1 min-w-0">
            <div class="font-medium">{{ inv.counterparty }}</div>
            <div class="text-sm text-muted">{{ inv.transactionDate }}</div>
          </div>
          <UBadge variant="subtle" size="xs">{{ docTypeLabels[inv.documentType] }}</UBadge>
          <div class="font-semibold whitespace-nowrap">¥{{ inv.amount.toLocaleString() }}</div>
        </div>
      </div>

      <template v-if="recentInvoices.length > 0" #footer>
        <UButton to="/search" variant="outline" block>すべて表示</UButton>
      </template>
    </UCard>
  </div>
</template>
