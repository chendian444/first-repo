import { fileURLToPath, URL } from 'node:url'

import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'

const softwareTitles: Record<string, string> = {
  monitor: '工业网络传输状态实时感知与监测系统',
  adaptive: '运行监测数据自适应压缩传输控制决策与优化系统',
  prediction: '工业网络数据传输智能诊断与预测系统'
}

export default defineConfig(({ mode }) => ({
  plugins: [vue(), {
    name: 'software-html-title',
    transformIndexHtml(html) {
      return html.replace(/<title>.*?<\/title>/, `<title>${softwareTitles[mode] || softwareTitles.adaptive}</title>`)
    }
  }],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    }
  },
  server: {
    host: '0.0.0.0',
    port: 5173
  }
}))
