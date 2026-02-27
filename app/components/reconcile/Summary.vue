<script setup lang="ts">
defineProps<{
  summary: {
    total: number
    matched: number
    unmatched: number
    notApplicable: number
  }
}>()
</script>

<template>
  <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
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
</template>
