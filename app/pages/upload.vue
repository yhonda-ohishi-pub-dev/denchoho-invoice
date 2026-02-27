<script setup lang="ts">
import type { GmailMessage } from '~/types/gmail'
import type { ParsedInvoice } from '~/composables/useGemini'

useHead({ title: 'メール取り込み' })

const { isLoggedIn, logout } = useGoogleAuth()
const { searchEmails, getAttachment } = useGmail()
const { parseInvoice, hasApiKey } = useGemini()
const { addInvoice, isGmailMessageImported } = useDatabase()
const { uploadFile } = useGoogleDrive()
const { senderAddresses } = useSettings()

// 検索フォーム
const searchQuery = ref('')
const dateFrom = ref('')
const dateTo = ref('')
const searching = ref(false)
const searchError = ref('')
const hasSearched = ref(false)

// 検索結果
const emails = ref<GmailMessage[]>([])
const nextPageToken = ref<string>()
const selectedIds = ref<Set<string>>(new Set())

// 取り込み状態
interface ImportItem {
  email: GmailMessage
  status: 'pending' | 'processing' | 'done' | 'error'
  result?: ParsedInvoice
  error?: string
  attachmentIndex: number
  driveStatus?: 'uploading' | 'done' | 'failed'
}
const importItems = ref<ImportItem[]>([])
const importing = ref(false)

const allSelected = computed({
  get: () => emails.value.length > 0 && selectedIds.value.size === emails.value.filter((e) => e.hasAttachment).length,
  set: (val: boolean) => {
    if (val) {
      emails.value.filter((e) => e.hasAttachment).forEach((e) => selectedIds.value.add(e.id))
    } else {
      selectedIds.value.clear()
    }
  },
})

async function handleSearch(pageToken?: string) {
  searching.value = true
  searchError.value = ''
  try {
    const result = await searchEmails({
      query: searchQuery.value || undefined,
      fromAddresses: senderAddresses.value.length ? [...senderAddresses.value] : undefined,
      dateFrom: dateFrom.value || undefined,
      dateTo: dateTo.value || undefined,
      hasAttachment: true,
      maxResults: 20,
      pageToken,
    })

    // Check which messages are already imported
    const messagesWithStatus = await Promise.all(
      result.messages.map(async (msg) => ({
        ...msg,
        _imported: await isGmailMessageImported(msg.id),
      })),
    )

    if (pageToken) {
      emails.value = [...emails.value, ...messagesWithStatus]
    } else {
      emails.value = messagesWithStatus
      selectedIds.value.clear()
    }
    nextPageToken.value = result.nextPageToken
    hasSearched.value = true
  } catch (e: any) {
    console.error('Search error:', e)
    if (e.message?.includes('401')) {
      logout()
      searchError.value = 'アクセストークンが無効です。再度ログインしてください。'
    } else {
      searchError.value = e.message || '検索中にエラーが発生しました'
    }
  } finally {
    searching.value = false
  }
}

function toggleSelect(id: string) {
  if (selectedIds.value.has(id)) {
    selectedIds.value.delete(id)
  } else {
    selectedIds.value.add(id)
  }
}

async function handleImport() {
  if (!hasApiKey()) {
    alert('Gemini API キーが設定されていません。設定画面で入力してください。')
    return
  }

  importing.value = true
  const selected = emails.value.filter((e) => selectedIds.value.has(e.id))

  // Build import items (one per attachment)
  const items: ImportItem[] = []
  for (const email of selected) {
    for (let i = 0; i < email.attachments.length; i++) {
      items.push({ email, status: 'pending', attachmentIndex: i })
    }
  }
  importItems.value = items

  // Process sequentially to avoid rate limits
  for (const item of importItems.value) {
    item.status = 'processing'
    try {
      const att = item.email.attachments[item.attachmentIndex]
      const fileData = await getAttachment(item.email.id, att.attachmentId)
      const parsed = await parseInvoice(fileData, att.mimeType)
      item.result = parsed

      // Upload to Google Drive
      let driveFileId: string | undefined
      let driveFileName: string | undefined
      item.driveStatus = 'uploading'
      try {
        const safeName = buildDriveFileName(parsed, att.filename)
        const driveFile = await uploadFile(fileData, safeName, att.mimeType)
        driveFileId = driveFile.id
        driveFileName = safeName
        item.driveStatus = 'done'
      } catch (driveError: any) {
        console.warn('Drive upload failed:', driveError.message)
        item.driveStatus = 'failed'
      }

      item.status = 'done'

      // Save to database
      await addInvoice({
        transactionDate: parsed.transactionDate,
        amount: parsed.amount,
        counterparty: parsed.counterparty,
        documentType: parsed.documentType,
        gmailMessageId: item.email.id,
        sourceType: 'gmail',
        driveFileId,
        driveFileName: driveFileName || att.filename,
        extractedData: JSON.stringify(parsed),
        memo: parsed.memo || '',
      })
    } catch (e: any) {
      item.status = 'error'
      item.error = e.message
    }
  }

  importing.value = false
}

function buildDriveFileName(parsed: ParsedInvoice, originalFilename: string): string {
  const ext = originalFilename.includes('.')
    ? originalFilename.substring(originalFilename.lastIndexOf('.'))
    : ''
  const safeName = parsed.counterparty.replace(/[/\\:*?"<>|]/g, '_').substring(0, 30)
  return `${parsed.transactionDate}_${safeName}${ext}`
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
    <h2 class="text-2xl font-bold">メール取り込み</h2>

    <!-- 未ログイン時 -->
    <UCard v-if="!isLoggedIn">
      <div class="text-center py-8 space-y-4">
        <UIcon name="i-lucide-mail" class="text-4xl text-muted" />
        <p>Gmail からメールを取り込むには Google アカウントとの連携が必要です。</p>
        <UButton to="/settings">設定画面へ</UButton>
      </div>
    </UCard>

    <!-- ログイン済み -->
    <template v-else>
      <!-- 検索フォーム -->
      <UCard>
        <form class="space-y-4" @submit.prevent="handleSearch()">
          <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
            <UInput
              v-model="searchQuery"
              placeholder="キーワード（件名、本文など）"
              icon="i-lucide-search"
            />
            <UInput v-model="dateFrom" type="date" />
            <UInput v-model="dateTo" type="date" />
          </div>

          <div v-if="senderAddresses.length" class="flex flex-wrap gap-1">
            <span class="text-sm text-muted mr-1">送信元フィルタ:</span>
            <UBadge v-for="addr in senderAddresses" :key="addr" variant="subtle" size="sm">
              {{ addr }}
            </UBadge>
          </div>

          <div class="flex gap-2">
            <UButton type="submit" :loading="searching" icon="i-lucide-search">
              Gmail を検索
            </UButton>
            <UButton
              v-if="selectedIds.size > 0"
              color="success"
              :loading="importing"
              icon="i-lucide-download"
              @click="handleImport"
            >
              選択した {{ selectedIds.size }} 件を取り込み
            </UButton>
          </div>
        </form>
      </UCard>

      <!-- エラー表示 -->
      <UAlert v-if="searchError" color="error" icon="i-lucide-alert-triangle" :title="searchError" :close-button="{ onClick: () => searchError = '' }" />

      <!-- 検索結果なし -->
      <UCard v-if="hasSearched && !emails.length && !searchError">
        <div class="text-center py-6 text-muted">
          <UIcon name="i-lucide-search-x" class="text-3xl mb-2" />
          <p>検索結果がありません</p>
        </div>
      </UCard>

      <!-- 検索結果 -->
      <UCard v-if="emails.length">
        <template #header>
          <div class="flex items-center justify-between">
            <span class="font-semibold">検索結果</span>
            <label class="flex items-center gap-2 text-sm">
              <input
                v-model="allSelected"
                type="checkbox"
                class="rounded"
              />
              すべて選択
            </label>
          </div>
        </template>

        <div class="divide-y divide-default">
          <div
            v-for="email in emails"
            :key="email.id"
            class="flex items-start gap-3 py-3"
            :class="{ 'opacity-50': (email as any)._imported }"
          >
            <input
              v-if="email.hasAttachment && !(email as any)._imported"
              type="checkbox"
              class="mt-1 rounded"
              :checked="selectedIds.has(email.id)"
              @change="toggleSelect(email.id)"
            />
            <div v-else class="w-4" />

            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-2">
                <span class="font-medium truncate">{{ email.subject || '(件名なし)' }}</span>
                <UBadge v-if="(email as any)._imported" variant="subtle" size="xs">取込済</UBadge>
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

        <template v-if="nextPageToken" #footer>
          <UButton variant="outline" :loading="searching" block @click="handleSearch(nextPageToken)">
            さらに読み込む
          </UButton>
        </template>
      </UCard>

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
                {{ item.email.attachments[item.attachmentIndex].filename }}
              </div>
              <div class="text-xs text-muted">{{ formatFrom(item.email.from) }}</div>
              <div v-if="item.result" class="text-xs mt-1">
                {{ item.result.counterparty }} / ¥{{ item.result.amount.toLocaleString() }} / {{ item.result.transactionDate }}
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
