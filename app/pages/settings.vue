<script setup lang="ts">
useHead({ title: '設定' })

const { hasApiKey, getApiKey, setApiKey, removeApiKey } = useGemini()
const { isLoggedIn, login, logout } = useGoogleAuth()
const { senderAddresses, addSenderAddress, removeSenderAddress } = useSettings()

const geminiKey = ref(getApiKey() || '')
const geminiSaved = ref(hasApiKey())
const newAddress = ref('')

function saveGeminiKey() {
  if (geminiKey.value.trim()) {
    setApiKey(geminiKey.value.trim())
    geminiSaved.value = true
  }
}

function clearGeminiKey() {
  removeApiKey()
  geminiKey.value = ''
  geminiSaved.value = false
}

function handleAddAddress() {
  if (newAddress.value.trim()) {
    addSenderAddress(newAddress.value)
    newAddress.value = ''
  }
}
</script>

<template>
  <div class="space-y-8">
    <h2 class="text-2xl font-bold">設定</h2>

    <!-- Google アカウント連携 -->
    <UCard>
      <template #header>
        <div class="flex items-center gap-2">
          <UIcon name="i-lucide-mail" />
          <span class="font-semibold">Google アカウント連携</span>
        </div>
      </template>

      <div class="space-y-4">
        <p class="text-sm text-muted">Gmail からメールを取り込むために Google アカウントとの連携が必要です。</p>

        <div v-if="isLoggedIn" class="flex items-center gap-3">
          <UBadge color="success" variant="subtle">接続済み</UBadge>
          <UButton variant="outline" color="error" size="sm" @click="logout">
            連携解除
          </UButton>
        </div>
        <UButton v-else icon="i-lucide-log-in" @click="login">
          Google アカウントでログイン
        </UButton>
      </div>
    </UCard>

    <!-- 検索対象メールアドレス -->
    <UCard>
      <template #header>
        <div class="flex items-center gap-2">
          <UIcon name="i-lucide-at-sign" />
          <span class="font-semibold">検索対象メールアドレス</span>
        </div>
      </template>

      <div class="space-y-4">
        <p class="text-sm text-muted">請求書を送信してくる取引先のメールアドレスを登録すると、Gmail 検索時に自動でフィルタされます。</p>

        <form class="flex gap-2" @submit.prevent="handleAddAddress">
          <UInput
            v-model="newAddress"
            type="email"
            placeholder="example@company.com"
            class="flex-1"
          />
          <UButton type="submit" :disabled="!newAddress.trim()">
            追加
          </UButton>
        </form>

        <div v-if="senderAddresses.length" class="space-y-2">
          <div
            v-for="addr in senderAddresses"
            :key="addr"
            class="flex items-center justify-between rounded-md bg-muted px-3 py-2"
          >
            <span class="text-sm">{{ addr }}</span>
            <UButton
              icon="i-lucide-x"
              variant="ghost"
              color="error"
              size="xs"
              @click="removeSenderAddress(addr)"
            />
          </div>
        </div>
        <p v-else class="text-sm text-dimmed">まだ登録されていません</p>
      </div>
    </UCard>

    <!-- Gemini API キー -->
    <UCard>
      <template #header>
        <div class="flex items-center gap-2">
          <UIcon name="i-lucide-sparkles" />
          <span class="font-semibold">Gemini API キー</span>
        </div>
      </template>

      <div class="space-y-4">
        <p class="text-sm text-muted">請求書の自動解析に使用します。Google AI Studio で取得できます。</p>

        <div v-if="geminiSaved" class="flex items-center gap-3">
          <UBadge color="success" variant="subtle">設定済み</UBadge>
          <UButton variant="outline" color="error" size="sm" @click="clearGeminiKey">
            削除
          </UButton>
        </div>
        <form v-else class="flex gap-2" @submit.prevent="saveGeminiKey">
          <UInput
            v-model="geminiKey"
            type="password"
            placeholder="AIza..."
            class="flex-1"
          />
          <UButton type="submit" :disabled="!geminiKey.trim()">
            保存
          </UButton>
        </form>
      </div>
    </UCard>
  </div>
</template>
