<script setup lang="ts">
import type { GmailMessage } from '~/types/gmail'
import type { MonthlySearchSource, MonthlySearchResult } from '~/types/searchHistory'

useHead({ title: '月次登録' })

const { isLoggedIn } = useGoogleAuth()
const { searchEmails } = useGmail()
const { isGmailMessageImported } = useDatabase()
const { senderAddresses } = useSettings()
const { searchHistory } = useSearchHistory()
const { importEmails, importItems, importing, resetImportState } = useImport()

// 対象月（デフォルト: 当月）
const selectedMonth = ref(getCurrentYearMonth())

// 検索ソース: 送信元アドレス + 保存済み検索
const searchSources = computed<MonthlySearchSource[]>(() => {
  const sources: MonthlySearchSource[] = []

  for (const addr of senderAddresses.value) {
    sources.push({
      key: `sender:${addr}`,
      type: 'sender',
      label: addr,
      baseParams: {
        fromAddresses: [addr],
        hasAttachment: true,
      },
    })
  }

  for (const saved of searchHistory.value) {
    sources.push({
      key: `saved:${saved.id}`,
      type: 'saved',
      label: saved.label,
      description: buildSearchDescription(saved.params),
      baseParams: {
        query: saved.params.query,
        fromAddresses: saved.params.fromAddresses,
        hasAttachment: saved.params.hasAttachment ?? true,
      },
    })
  }

  return sources
})

// 検索結果
const results = ref<Map<string, MonthlySearchResult>>(new Map())
const isSearching = ref(false)
const searchProgress = ref({ current: 0, total: 0 })

// メール選択状態 (sourceKey -> Set<messageId>)
const selections = ref<Map<string, Set<string>>>(new Map())

// 対象月の日付範囲
const monthDateRange = computed(() => {
  const [year, month] = selectedMonth.value.split('-').map(Number)
  const dateFrom = `${year}/${String(month).padStart(2, '0')}/01`
  const nextMonth = month === 12 ? 1 : month + 1
  const nextYear = month === 12 ? year! + 1 : year
  const dateTo = `${nextYear}/${String(nextMonth).padStart(2, '0')}/01`
  return { dateFrom, dateTo }
})

// 全体サマリー
const overallSummary = computed(() => {
  let totalFound = 0
  let totalImported = 0
  let totalUnimported = 0
  for (const r of results.value.values()) {
    if (r.status === 'done') {
      totalFound += r.messages.length
      totalImported += r.importedCount
      totalUnimported += r.unimportedCount
    }
  }
  return { totalFound, totalImported, totalUnimported }
})

// 選択件数合計
const totalSelected = computed(() => {
  let count = 0
  for (const set of selections.value.values()) {
    count += set.size
  }
  return count
})

function getCurrentYearMonth(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

function buildSearchDescription(params: { query?: string; fromAddresses?: string[] }): string {
  const parts: string[] = []
  if (params.query) parts.push(`キーワード: ${params.query}`)
  if (params.fromAddresses?.length) parts.push(`送信元: ${params.fromAddresses.join(', ')}`)
  return parts.join(' / ')
}

async function runAllSearches() {
  isSearching.value = true
  results.value = new Map()
  selections.value = new Map()
  resetImportState()

  const sources = searchSources.value
  searchProgress.value = { current: 0, total: sources.length }

  // 全ソースを idle で初期化
  for (const source of sources) {
    results.value.set(source.key, {
      source,
      status: 'idle',
      messages: [],
      importedCount: 0,
      unimportedCount: 0,
      expanded: false,
    })
  }

  // 順次検索 (Gmail API レート制限対策)
  for (const source of sources) {
    const result = results.value.get(source.key)!
    result.status = 'searching'

    try {
      const { dateFrom, dateTo } = monthDateRange.value
      const searchResult = await searchEmails({
        ...source.baseParams,
        dateFrom,
        dateTo,
        maxResults: 50,
      })

      let importedCount = 0
      const messagesWithStatus = await Promise.all(
        searchResult.messages.map(async (msg) => {
          const imported = await isGmailMessageImported(msg.id)
          if (imported) importedCount++
          return { ...msg, _imported: imported }
        }),
      )

      result.messages = messagesWithStatus
      result.importedCount = importedCount
      result.unimportedCount = messagesWithStatus.length - importedCount
      result.status = 'done'
    } catch (e: any) {
      result.status = 'error'
      result.error = e.message
    }

    searchProgress.value.current++
  }

  isSearching.value = false
}

function toggleExpand(key: string) {
  const result = results.value.get(key)
  if (result) result.expanded = !result.expanded
}

function toggleSelect(sourceKey: string, messageId: string) {
  if (!selections.value.has(sourceKey)) {
    selections.value.set(sourceKey, new Set())
  }
  const set = selections.value.get(sourceKey)!
  if (set.has(messageId)) {
    set.delete(messageId)
  } else {
    set.add(messageId)
  }
}

function selectAllUnimported(sourceKey: string) {
  const result = results.value.get(sourceKey)
  if (!result) return
  const unimported = result.messages.filter((m) => !m._imported)
  selections.value.set(sourceKey, new Set(unimported.map((m) => m.id)))
}

function isSelected(sourceKey: string, messageId: string): boolean {
  return selections.value.get(sourceKey)?.has(messageId) ?? false
}

async function handleImportSelected() {
  const selectedEmails: GmailMessage[] = []
  for (const [sourceKey, selectedIds] of selections.value.entries()) {
    const result = results.value.get(sourceKey)
    if (!result) continue
    for (const msg of result.messages) {
      if (selectedIds.has(msg.id)) {
        selectedEmails.push(msg)
      }
    }
  }

  if (selectedEmails.length === 0) return

  try {
    await importEmails(selectedEmails)
    // 取り込み後、再検索して状態更新
    await runAllSearches()
  } catch (e: any) {
    alert(e.message)
  }
}

function formatDate(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleDateString('ja-JP')
  } catch {
    return dateStr
  }
}

function formatFrom(from: string): string {
  const match = from.match(/^(.+?)\s*</)
  return match ? match[1].replace(/"/g, '') : from
}
</script>

<template>
  <div class="space-y-6">
    <h2 class="text-2xl font-bold">月次登録</h2>

    <!-- 未ログイン時 -->
    <UCard v-if="!isLoggedIn">
      <div class="text-center py-8 space-y-4">
        <UIcon name="i-lucide-calendar" class="text-4xl text-muted" />
        <p>Gmail からメールを取り込むには Google アカウントとの連携が必要です。</p>
        <UButton to="/settings">設定画面へ</UButton>
      </div>
    </UCard>

    <!-- ログイン済み -->
    <template v-else>
      <!-- 月選択 + 検索ボタン -->
      <UCard>
        <div class="flex items-end gap-4">
          <div>
            <label class="block text-sm font-medium mb-1">対象月</label>
            <UInput v-model="selectedMonth" type="month" />
          </div>
          <UButton
            :loading="isSearching"
            icon="i-lucide-search"
            :disabled="searchSources.length === 0"
            @click="runAllSearches"
          >
            検索 ({{ searchSources.length }}件のソース)
          </UButton>
        </div>

        <!-- 検索進捗 -->
        <div v-if="isSearching" class="mt-4">
          <div class="text-sm text-muted mb-1">
            検索中... {{ searchProgress.current }} / {{ searchProgress.total }}
          </div>
          <UProgress :value="searchProgress.total > 0 ? (searchProgress.current / searchProgress.total) * 100 : 0" />
        </div>
      </UCard>

      <!-- ソースなし警告 -->
      <UAlert
        v-if="searchSources.length === 0"
        color="warning"
        icon="i-lucide-alert-triangle"
        title="検索ソースがありません"
        description="設定画面で送信元メールアドレスを登録するか、メール取込画面で検索を実行してください。"
      />

      <!-- 全体サマリー -->
      <UCard v-if="results.size > 0 && !isSearching">
        <div class="grid grid-cols-3 gap-4 text-center">
          <div>
            <div class="text-sm text-muted">検出メール</div>
            <div class="text-2xl font-bold">{{ overallSummary.totalFound }}</div>
          </div>
          <div>
            <div class="text-sm text-muted">取込済</div>
            <div class="text-2xl font-bold text-success">{{ overallSummary.totalImported }}</div>
          </div>
          <div>
            <div class="text-sm text-muted">未取込</div>
            <div class="text-2xl font-bold text-warning">{{ overallSummary.totalUnimported }}</div>
          </div>
        </div>
      </UCard>

      <!-- 一括取り込みボタン (sticky) -->
      <div
        v-if="totalSelected > 0"
        class="sticky top-0 z-10 bg-white/90 dark:bg-gray-900/90 backdrop-blur py-3 -mx-4 px-4"
      >
        <UButton
          color="success"
          :loading="importing"
          icon="i-lucide-download"
          block
          @click="handleImportSelected"
        >
          選択した {{ totalSelected }} 件を一括取り込み
        </UButton>
      </div>

      <!-- ソース別カード -->
      <div class="space-y-4">
        <UCard
          v-for="[key, result] in results"
          :key="key"
        >
          <!-- カードヘッダー (クリックで展開) -->
          <template #header>
            <div
              class="flex items-center justify-between cursor-pointer select-none"
              @click="toggleExpand(key)"
            >
              <div class="flex items-center gap-3 min-w-0">
                <UIcon
                  :name="result.source.type === 'sender' ? 'i-lucide-at-sign' : 'i-lucide-bookmark'"
                  class="shrink-0"
                />
                <div class="min-w-0">
                  <div class="font-semibold truncate">{{ result.source.label }}</div>
                  <div v-if="result.source.description" class="text-xs text-muted truncate">
                    {{ result.source.description }}
                  </div>
                </div>
              </div>

              <div class="flex items-center gap-3 shrink-0">
                <UIcon
                  v-if="result.status === 'searching'"
                  name="i-lucide-loader-circle"
                  class="animate-spin text-primary"
                />
                <UBadge v-if="result.status === 'error'" color="error" variant="subtle">エラー</UBadge>

                <div v-if="result.status === 'done'" class="text-sm text-right whitespace-nowrap">
                  <span>{{ result.messages.length }}件</span>
                  <template v-if="result.unimportedCount > 0">
                    <span class="mx-1">/</span>
                    <span class="text-warning font-semibold">{{ result.unimportedCount }}件未取込</span>
                  </template>
                  <template v-else>
                    <span class="ml-1 text-success">全件取込済</span>
                  </template>
                </div>

                <UIcon
                  :name="result.expanded ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"
                  class="text-muted"
                />
              </div>
            </div>
          </template>

          <!-- 展開時: メール一覧 -->
          <template v-if="result.expanded && result.status === 'done'">
            <!-- 未取込をすべて選択 -->
            <div v-if="result.unimportedCount > 0" class="flex justify-end mb-3">
              <UButton
                variant="outline"
                size="xs"
                @click.stop="selectAllUnimported(key)"
              >
                未取込をすべて選択
              </UButton>
            </div>

            <!-- メール一覧 -->
            <div v-if="result.messages.length" class="divide-y divide-default">
              <div
                v-for="email in result.messages"
                :key="email.id"
                class="flex items-start gap-3 py-3"
                :class="{ 'opacity-50': email._imported }"
              >
                <input
                  v-if="email.hasAttachment && !email._imported"
                  type="checkbox"
                  class="mt-1 rounded"
                  :checked="isSelected(key, email.id)"
                  @change="toggleSelect(key, email.id)"
                />
                <div v-else class="w-4" />

                <div class="flex-1 min-w-0">
                  <div class="flex items-center gap-2">
                    <span class="font-medium truncate">{{ email.subject || '(件名なし)' }}</span>
                    <UBadge v-if="email._imported" variant="subtle" size="xs">取込済</UBadge>
                    <UButton
                      icon="i-lucide-external-link"
                      variant="ghost"
                      size="xs"
                      :to="`https://mail.google.com/mail/u/0/#inbox/${email.id}`"
                      target="_blank"
                      title="Gmailで開く"
                      class="shrink-0"
                    />
                  </div>
                  <div class="text-sm text-muted flex gap-3 mt-1">
                    <span>{{ formatFrom(email.from) }}</span>
                    <span>{{ formatDate(email.date) }}</span>
                  </div>
                  <div v-if="email.attachments.length" class="flex flex-wrap gap-1 mt-1">
                    <UBadge
                      v-for="att in email.attachments"
                      :key="att.attachmentId"
                      variant="outline"
                      size="xs"
                    >
                      {{ att.filename }}
                    </UBadge>
                  </div>
                </div>
              </div>
            </div>

            <!-- 全件取込済 -->
            <div v-if="result.messages.length > 0 && result.unimportedCount === 0" class="text-center py-4 text-success">
              <UIcon name="i-lucide-check-circle" class="text-2xl mb-1" />
              <p class="text-sm">すべて取込済みです</p>
            </div>

            <!-- 結果なし -->
            <div v-if="result.messages.length === 0" class="text-center py-4 text-muted">
              <p class="text-sm">この月のメールはありません</p>
            </div>
          </template>

          <!-- エラー表示 -->
          <template v-if="result.expanded && result.status === 'error'">
            <UAlert color="error" :title="result.error || '検索中にエラーが発生しました'" />
          </template>
        </UCard>
      </div>

      <!-- 取り込み進捗 -->
      <UCard v-if="importItems.length">
        <template #header>
          <span class="font-semibold">取り込み状況</span>
        </template>

        <div class="space-y-3">
          <div
            v-for="(item, idx) in importItems"
            :key="idx"
            class="flex items-center gap-3 rounded-md bg-muted p-3"
          >
            <UIcon
              v-if="item.status === 'done'"
              name="i-lucide-check-circle"
              class="text-success shrink-0"
            />
            <UIcon
              v-else-if="item.status === 'error'"
              name="i-lucide-alert-circle"
              class="text-error shrink-0"
            />
            <UIcon
              v-else-if="item.status === 'processing'"
              name="i-lucide-loader-circle"
              class="animate-spin text-primary shrink-0"
            />
            <UIcon v-else name="i-lucide-clock" class="text-muted shrink-0" />

            <div class="flex-1 min-w-0">
              <div class="text-sm font-medium truncate">
                {{ item.email.attachments[item.attachmentIndex]?.filename }}
              </div>
              <div class="text-xs text-muted">{{ formatFrom(item.email.from) }}</div>
              <div v-if="item.result" class="text-xs mt-1">
                {{ item.result.counterparty }} / {{ formatAmount(item.result.amount, item.result.currency) }} / {{ item.result.transactionDate }}
              </div>
              <div v-if="item.driveStatus === 'done'" class="flex items-center gap-1 mt-1">
                <UBadge variant="subtle" size="xs" color="success">Drive保存済</UBadge>
              </div>
              <div v-else-if="item.driveStatus === 'failed'" class="flex items-center gap-1 mt-1">
                <UBadge variant="subtle" size="xs" color="warning">Drive保存失敗</UBadge>
              </div>
              <div v-if="item.error" class="text-xs text-error mt-1">{{ item.error }}</div>
            </div>
          </div>
        </div>
      </UCard>
    </template>
  </div>
</template>
