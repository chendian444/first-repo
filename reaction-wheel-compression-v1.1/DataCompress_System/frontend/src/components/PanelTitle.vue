<script setup lang="ts">
defineProps<{ title: string; icon?: string; rightText?: string; tone?: 'blue' | 'green' }>()
</script>

<template>
  <div class="panel-title">
    <div class="panel-title-main">
      <span v-if="icon" class="panel-title-icon" :class="tone || 'blue'">{{ icon }}</span>
      <h2>{{ title }}</h2>
    </div>
    <span v-if="rightText" class="panel-title-right">{{ rightText }}</span>
  </div>
</template>
