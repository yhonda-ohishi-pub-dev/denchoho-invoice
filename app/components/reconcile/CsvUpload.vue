<script setup lang="ts">
import type { MFTransaction } from '~/types/reconcile'

const emit = defineEmits<{
  parsed: [transactions: MFTransaction[]]
}>()

const { parseCSV } = useReconcile()

const loading = ref(false)
const error = ref('')
const fileName = ref('')

async function handleFileChange(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return

  loading.value = true
  error.value = ''
  fileName.value = file.name

  try {
    const transactions = await parseCSV(file)
    emit('parsed', transactions)
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
</script>

<template>
  <UCard>
    <div
      class="border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg p-8 text-center cursor-pointer hover:border-primary transition-colors"
      @drop="handleDrop"
      @dragover.prevent
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

  <div v-if="loading" class="text-center py-8">
    <UIcon name="i-lucide-loader-2" class="animate-spin text-2xl" />
    <p class="mt-2">CSVを解析中...</p>
  </div>

  <UAlert v-if="error" color="error" :title="error" icon="i-lucide-alert-circle" />
</template>
