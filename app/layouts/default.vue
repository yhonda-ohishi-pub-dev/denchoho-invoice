<script setup lang="ts">
const navItems = [
  { label: '検索', icon: 'i-lucide-search', to: '/search' },
  { label: '設定', icon: 'i-lucide-settings', to: '/settings' },
]
</script>

<template>
  <div class="min-h-screen">
    <header class="border-b border-gray-200 dark:border-gray-800">
      <div class="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
        <NuxtLink to="/" class="text-lg font-bold hover:opacity-80">電帳法インボイス</NuxtLink>
        <nav class="flex gap-2">
          <UButton
            v-for="item in navItems"
            :key="item.to"
            :to="item.to"
            :icon="item.icon"
            :label="item.label"
            variant="ghost"
            size="sm"
          />
        </nav>
      </div>
    </header>
    <main class="max-w-7xl mx-auto px-4 py-6">
      <slot />
    </main>
  </div>
</template>
