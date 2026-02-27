<script setup lang="ts">
import type { Invoice, DocumentType } from '~/types/invoice'

useHead({ title: '検索' })

const { searchInvoices, deleteInvoice } = useDatabase()
const { getViewUrl } = useGoogleDrive()

const dateFrom = ref('')
const dateTo = ref('')
const amountMin = ref<number>()
const amountMax = ref<number>()
const counterparty = ref('')
const documentType = ref('')
const results = ref<Invoice[]>([])
const searched = ref(false)

const docTypeOptions = [
  { label: 'すべて', value: '' },
  { label: '請求書', value: 'invoice' },
  { label: '領収書', value: 'receipt' },
  { label: '見積書', value: 'quotation' },
  { label: '納品書', value: 'delivery_slip' },
  { label: '契約書', value: 'contract' },
  { label: 'その他', value: 'other' },
]

const docTypeLabels: Record<DocumentType, string> = {
  invoice: '請求書',
  receipt: '領収書',
  quotation: '見積書',
  delivery_slip: '納品書',
  contract: '契約書',
  other: 'その他',
}

async function handleSearch() {
  results.value = await searchInvoices({
    dateFrom: dateFrom.value || undefined,
    dateTo: dateTo.value || undefined,
    amountMin: amountMin.value || undefined,
    amountMax: amountMax.value || undefined,
    counterparty: counterparty.value || undefined,
    documentType: documentType.value || undefined,
  })
  searched.value = true
}

async function handleDelete(id: number) {
  if (!confirm('このデータを削除しますか？')) return
  await deleteInvoice(id)
  await handleSearch()
}
</script>

<template>
  <div class="space-y-6">
    <h2 class="text-2xl font-bold">検索</h2>

    <!-- 検索フォーム -->
    <UCard>
      <form class="space-y-4" @submit.prevent="handleSearch">
        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <div>
            <label class="block text-sm font-medium mb-1">取引年月日（開始）</label>
            <UInput v-model="dateFrom" type="date" />
          </div>
          <div>
            <label class="block text-sm font-medium mb-1">取引年月日（終了）</label>
            <UInput v-model="dateTo" type="date" />
          </div>
          <div>
            <label class="block text-sm font-medium mb-1">取引先</label>
            <UInput v-model="counterparty" placeholder="取引先名" icon="i-lucide-building" />
          </div>
          <div>
            <label class="block text-sm font-medium mb-1">金額（下限）</label>
            <UInput v-model.number="amountMin" type="number" placeholder="0" />
          </div>
          <div>
            <label class="block text-sm font-medium mb-1">金額（上限）</label>
            <UInput v-model.number="amountMax" type="number" placeholder="999999999" />
          </div>
          <div>
            <label class="block text-sm font-medium mb-1">書類種別</label>
            <USelect v-model="documentType" :items="docTypeOptions" />
          </div>
        </div>

        <UButton type="submit" icon="i-lucide-search">検索</UButton>
      </form>
    </UCard>

    <!-- 検索結果 -->
    <UCard v-if="searched">
      <template #header>
        <span class="font-semibold">検索結果（{{ results.length }} 件）</span>
      </template>

      <div v-if="results.length === 0" class="text-center py-8 text-muted">
        条件に一致するデータがありません
      </div>

      <div v-else class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead>
            <tr class="border-b border-default text-left">
              <th class="pb-2 pr-4">取引年月日</th>
              <th class="pb-2 pr-4">取引先</th>
              <th class="pb-2 pr-4 text-right">金額</th>
              <th class="pb-2 pr-4">種別</th>
              <th class="pb-2 pr-4">取込元</th>
              <th class="pb-2 pr-4">書類</th>
              <th class="pb-2" />
            </tr>
          </thead>
          <tbody>
            <tr v-for="inv in results" :key="inv.id" class="border-b border-muted">
              <td class="py-2 pr-4">{{ inv.transactionDate }}</td>
              <td class="py-2 pr-4">{{ inv.counterparty }}</td>
              <td class="py-2 pr-4 text-right">¥{{ inv.amount.toLocaleString() }}</td>
              <td class="py-2 pr-4">
                <UBadge variant="subtle" size="xs">{{ docTypeLabels[inv.documentType] }}</UBadge>
              </td>
              <td class="py-2 pr-4">
                <UBadge v-if="inv.sourceType === 'gmail'" variant="outline" size="xs">Gmail</UBadge>
                <UBadge v-else variant="outline" size="xs">手動</UBadge>
              </td>
              <td class="py-2 pr-4">
                <UButton
                  v-if="inv.driveFileId"
                  icon="i-lucide-external-link"
                  variant="ghost"
                  size="xs"
                  :to="getViewUrl(inv.driveFileId)"
                  target="_blank"
                  label="表示"
                />
                <span v-else class="text-xs text-dimmed">--</span>
              </td>
              <td class="py-2">
                <UButton
                  icon="i-lucide-trash-2"
                  variant="ghost"
                  color="error"
                  size="xs"
                  @click="handleDelete(inv.id!)"
                />
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </UCard>
  </div>
</template>
