<script setup lang="ts">
import { useRoute } from 'vue-router'

const route = useRoute()

const navItems = [
  { label: '传输监控', path: '/transmission', icon: '▱' },
  { label: '策略分析', path: '/strategy', icon: '◔' },
  { label: '效果展示', path: '/effect', icon: '▥' },
  { label: '动量轮遥测', path: '/wheel', icon: '◉' }
]

</script>

<template>
  <div class="app-shell">
    <header class="topbar">
      <div class="brand">
        <span class="brand-cube"><i></i><i></i><i></i></span>
        <span>数据压缩控制传输系统</span>
      </div>
      <div class="top-actions">
        <span class="top-status"><b class="status-dot"></b>系统在线</span>
      </div>
    </header>

    <aside class="sidebar">
      <div class="collapse-mark">☰</div>
      <nav>
        <RouterLink v-for="item in navItems" :key="item.path" :to="item.path" class="nav-item" :class="{ active: route.path === item.path }">
          <span class="nav-icon">{{ item.icon }}</span>
          <span>{{ item.label }}</span>
        </RouterLink>
      </nav>

    </aside>

    <main class="content-area">
      <RouterView />
    </main>
  </div>
</template>
