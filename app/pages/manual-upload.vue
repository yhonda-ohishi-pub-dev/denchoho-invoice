<script setup lang="ts">
import type { ParsedInvoice } from '~/composables/useGemini'

useHead({ title: '書類取込' })

const { parseInvoice, hasApiKey } = useGemini()
const { addInvoice } = useDatabase()
const { uploadFile } = useGoogleDrive()
const { getViewUrl } = useGoogleDrive()

interface UploadItem {
  file: File
  status: 'pending' | 'processing' | 'done' | 'error'
  result?: ParsedInvoice
  error?: string
  driveFileId?: string
  driveStatus?: 'uploading' | 'done' | 'failed'
}

const items = ref<UploadItem[]>([])
const processing = ref(false)
const dragOver = ref(false)

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = reader.result as string
      const base64 = dataUrl.split(',')[1]
      if (base64) resolve(base64)
      else reject(new Error('ファイルの読み込みに失敗しました'))
    }
    reader.onerror = () => reject(new Error('ファイルの読み込みに失敗しました'))
    reader.readAsDataURL(file)
  })
}

function addFiles(files: FileList | File[]) {
  const newItems: UploadItem[] = Array.from(files)
    .filter(f => f.type === 'application/pdf' || f.type.startsWith('image/'))
    .map(f => ({ file: f, status: 'pending' as const }))
  items.value = [...items.value, ...newItems]
}

function handleFileSelect(event: Event) {
  const input = event.target as HTMLInputElement
  if (input.files?.length) {
    addFiles(input.files)
    input.value = ''
  }
}

function handleDrop(event: DragEvent) {
  event.preventDefault()
  dragOver.value = false
  if (event.dataTransfer?.files.length) {
    addFiles(event.dataTransfer.files)
  }
}

function removeItem(idx: number) {
  items.value.splice(idx, 1)
}

function buildDriveFileName(parsed: ParsedInvoice, originalFilename: string): string {
  const ext = originalFilename.includes('.')
    ? originalFilename.substring(originalFilename.lastIndexOf('.'))
    : ''
  const safeName = parsed.counterparty.replace(/[/\\:*?"<>|]/g, '_').substring(0, 30)
  return `${parsed.transactionDate}_${safeName}${ext}`
}

async function processAll() {
  if (!hasApiKey()) {
    alert('Gemini API キーが設定されていません。設定画面で入力してください。')
    return
  }

  processing.value = true

  for (const item of items.value) {
    if (item.status !== 'pending') continue
    item.status = 'processing'

    try {
      const base64 = await fileToBase64(item.file)
      const mimeType = item.file.type || 'application/pdf'

      // Gemini 解析
      const parsed = await parseInvoice(base64, mimeType)
      item.result = parsed

      // Drive アップロード
      let driveFileId: string | undefined
      let driveFileName: string | undefined
      item.driveStatus = 'uploading'
      try {
        const safeName = buildDriveFileName(parsed, item.file.name)
        const driveFile = await uploadFile(base64, safeName, mimeType)
        driveFileId = driveFile.id
        driveFileName = safeName
        item.driveFileId = driveFileId
        item.driveStatus = 'done'
      } catch (driveErr: any) {
        console.warn('Drive upload failed:', driveErr.message)
        item.driveStatus = 'failed'
      }

      // IndexedDB 保存
      await addInvoice({
        transactionDate: parsed.transactionDate,
        amount: parsed.amount,
        currency: parsed.currency || 'JPY',
        counterparty: parsed.counterparty,
        documentType: parsed.documentType,
        sourceType: 'manual',
        driveFileId,
        driveFileName: driveFileName || item.file.name,
        extractedData: JSON.stringify(parsed),
        memo: parsed.memo || '',
      })

      item.status = 'done'
    } catch (e: any) {
      item.status = 'error'
      item.error = e.message
    }
  }

  processing.value = false
}

const pendingCount = computed(() => items.value.filter(i => i.status === 'pending').length)
const doneCount = computed(() => items.value.filter(i => i.status === 'done').length)
</script>

<template>
  <div class="space-y-6">
    <h2 class="text-2xl font-bold">書類取込</h2>

    <!-- ファイル選択エリア -->
    <UCard>
      <div
        class="border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors"
        :class="dragOver
          ? 'border-primary bg-primary/5'
          : 'border-gray-300 dark:border-gray-600 hover:border-primary'"
        @click="($refs.fileInput as HTMLInputElement)?.click()"
        @drop="handleDrop"
        @dragover.prevent="dragOver = true"
        @dragleave="dragOver = false"
      >
        <UIcon name="i-lucide-file-up" class="text-4xl mb-2 text-muted" />
        <p class="text-lg font-medium mb-1">PDF / 画像ファイルをアップロード</p>
        <p class="text-sm text-dimmed">クリックまたはドラッグ&ドロップ（複数選択可）</p>
        <input
          ref="fileInput"
          type="file"
          accept=".pdf,image/*"
          multiple
          class="hidden"
          @change="handleFileSelect"
        >
      </div>
    </UCard>

    <!-- ファイルリスト -->
    <UCard v-if="items.length">
      <template #header>
        <div class="flex items-center justify-between">
          <span class="font-semibold">
            ファイル一覧（{{ doneCount }} / {{ items.length }} 件完了）
          </span>
          <UButton
            v-if="pendingCount > 0"
            icon="i-lucide-play"
            :loading="processing"
            color="success"
            @click="processAll"
          >
            {{ pendingCount }} 件を取り込み
          </UButton>
        </div>
      </template>

      <div class="space-y-3">
        <div
          v-for="(item, idx) in items"
          :key="idx"
          class="flex items-center gap-3 rounded-md bg-muted/50 p-3"
        >
          <!-- ステータスアイコン -->
          <UIcon
            v-if="item.status === 'done'"
            name="i-lucide-check-circle"
            class="text-green-600 shrink-0"
          />
          <UIcon
            v-else-if="item.status === 'error'"
            name="i-lucide-alert-circle"
            class="text-red-600 shrink-0"
          />
          <UIcon
            v-else-if="item.status === 'processing'"
            name="i-lucide-loader-2"
            class="animate-spin text-primary shrink-0"
          />
          <UIcon v-else name="i-lucide-file" class="text-muted shrink-0" />

          <!-- ファイル情報 -->
          <div class="flex-1 min-w-0">
            <div class="text-sm font-medium truncate">{{ item.file.name }}</div>
            <div class="text-xs text-dimmed">
              {{ (item.file.size / 1024).toFixed(0) }} KB
            </div>

            <!-- 解析結果 -->
            <div v-if="item.result" class="text-xs mt-1 flex flex-wrap gap-2">
              <span>{{ item.result.counterparty }}</span>
              <span>{{ formatAmount(item.result.amount, item.result.currency) }}</span>
              <span>{{ item.result.transactionDate }}</span>
            </div>

            <!-- Drive ステータス -->
            <div v-if="item.driveStatus === 'done' && item.driveFileId" class="flex items-center gap-1 mt-1">
              <UBadge variant="subtle" size="xs" color="success">Drive保存済</UBadge>
              <UButton
                icon="i-lucide-external-link"
                variant="ghost"
                size="xs"
                :to="getViewUrl(item.driveFileId)"
                target="_blank"
              />
            </div>
            <div v-else-if="item.driveStatus === 'failed'">
              <UBadge variant="subtle" size="xs" color="warning">Drive保存失敗</UBadge>
            </div>

            <!-- エラー -->
            <div v-if="item.error" class="text-xs text-red-500 mt-1">{{ item.error }}</div>
          </div>

          <!-- 削除ボタン（pending のみ） -->
          <UButton
            v-if="item.status === 'pending'"
            icon="i-lucide-x"
            variant="ghost"
            size="xs"
            @click="removeItem(idx)"
          />
        </div>
      </div>
    </UCard>
  </div>
</template>
