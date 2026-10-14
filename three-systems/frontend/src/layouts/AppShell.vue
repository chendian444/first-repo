<script setup lang="ts">
import { useRoute } from 'vue-router'
import { softwareTitle } from '@/software'
const route = useRoute()
</script>
<template>
  <div class="app-shell standalone-shell">
    <header class="topbar">
      <div class="brand">
        <span class="brand-cube"><i></i><i></i><i></i></span>
        <span>{{ softwareTitle }}</span>
      </div>
      <div class="top-actions">
        <RouterLink v-if="route.path !== '/analysis'" to="/analysis" class="return-home">返回软件首页</RouterLink>
        <span class="top-status"><b class="status-dot"></b>系统在线</span>
      </div>
    </header>
    <main class="content-area"><RouterView /></main>
  </div>
</template>
