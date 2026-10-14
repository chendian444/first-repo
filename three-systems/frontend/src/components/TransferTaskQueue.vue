<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import PanelTitle from '@/components/PanelTitle.vue'
import { dashboardApi } from '@/api/dashboard'
import { software } from '@/software'
import type { TransferTaskItem } from '@/types/dashboard'
const router = useRouter()
const tasks = ref<TransferTaskItem[]>([])
const message = ref('')
let timer: number | undefined
function priorityText(task: TransferTaskItem) {
  return ({ CRITICAL: '高', IMPORTANT: '中', NORMAL: '低' } as Record<string, string>)[task.priority?.priority || ''] || task.priority?.priority || '—'
}

function algorithmText(task: TransferTaskItem) {
  return String(task.currentDecision?.algorithm || 'AUTO').toUpperCase()
}

async function openTask(taskId: string) {
  try {
    await dashboardApi.selectTask(taskId)
    await router.push({ name: software === 'monitor' ? 'analysis' : 'transmission', query: { task: taskId } })
  } catch (error) {
    message.value = error instanceof Error ? error.message : '无法切换到任务进程'
  }
}

async function load() {
  try { tasks.value = await dashboardApi.transferTasks(); message.value = '' }
  catch (error) { message.value = error instanceof Error ? error.message : '无法获取传输任务队列' }
}
onMounted(async () => { await load(); timer = window.setInterval(load, 1000) })
onBeforeUnmount(() => { if (timer) window.clearInterval(timer) })
</script>
<template>
      <section class="panel task-queue-panel">
        <div v-if="message" class="toast-message error" role="status">{{ message }}</div>
        <PanelTitle title="传输任务队列" icon="◷" right-text="点击任务名查看进程" tone="blue" />
        <div class="strategy-task-table-wrap">
          <table class="strategy-task-table">
            <thead>
              <tr>
                <th>任务</th>
                <th>调度优先级</th>
                <th>策略</th>
                <th>进度</th>
                <th>打开文件</th>
                <th>打开文件夹</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="task in tasks" :key="task.id">
                <td><button class="task-name-button" type="button" @click="openTask(task.id)">{{ task.fileName }}</button></td>
                <td>{{ priorityText(task) }}</td>
                <td><b class="algorithm-code">{{ algorithmText(task) }}</b></td>
                <td>
                  <div class="queue-progress"><i :style="{ width: `${Math.max(0, Math.min(100, task.progressPercent || 0))}%` }"></i></div>
                  <span>{{ Number(task.progressPercent || 0).toFixed(1) }}%</span>
                </td>
                <td>
                  <a v-if="task.packageKind !== 'FOLDER'" :href="`/api/tasks/${task.id}/content/file`" target="_blank" rel="noopener">打开文件</a>
                  <button v-else class="queue-action-disabled" type="button" disabled aria-disabled="true">打开文件</button>
                </td>
                <td>
                  <a :href="`/api/tasks/${task.id}/browse`" target="_blank" rel="noopener">打开文件夹</a>
                </td>
              </tr>
              <tr v-if="!tasks.length"><td colspan="6" class="queue-empty">暂无传输任务</td></tr>
            </tbody>
          </table>
        </div>
      </section>
</template>
