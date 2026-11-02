<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import LineChart from '@/components/LineChart.vue'

interface Config { mode: 'AUTO' | 'RAW'; periodMs: number }
interface Sample {
  sequence: number; deviceMillis: number; receivedAt: string; codec: string
  mode: string; periodMs: number; values: (number | null)[]
}
interface Status {
  compressionLocation: 'HOST' | 'DEVICE' | 'UNKNOWN'; transportSavingPercent: number
  online: boolean; inputMode: string; configApplied: boolean; config: Config; latest: Sample | null
  channels: string[]; acceptedFrames: number; compressedFrames: number
  wireBytes: number; rawPayloadBytes: number; payloadSavingPercent: number
  framedSavingPercent: number; sequenceGaps: number; duplicateFrames: number
  deviceResets: number; rejectedBatches: number
}
const status = ref<Status | null>(null)
const samples = ref<Sample[]>([])
const hostCompression = computed(() => status.value?.compressionLocation !== 'DEVICE')
const mode = ref<Config['mode']>('AUTO')
const period = ref(10)
const error = ref('')
const message = ref('')
const saving = ref(false)
let stopped = false
let timer: ReturnType<typeof setTimeout> | undefined
let initialized = false
async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(5000) })
  if (!response.ok) {
    const text = await response.text()
    let detail = text
    try { detail = JSON.parse(text).message || text } catch { /* use HTTP text */ }
    throw new Error(`HTTP ${response.status}: ${detail}`)
  }
  return response.json()
}
async function refresh() {
  try {
    const [current, history] = await Promise.all([
      request<Status>('/api/wheel/status'), request<Sample[]>('/api/wheel/history?limit=200')
    ])
    if (stopped) return
    status.value = current; samples.value = history; error.value = ''
    if (!initialized) {
      mode.value = current.config.mode; period.value = current.config.periodMs; initialized = true
    }
  } catch (e) { if (!stopped) error.value = String(e) }
  finally { if (!stopped) timer = setTimeout(refresh, 1000) }
}
async function save() {
  if (!Number.isInteger(period.value) || period.value < 10 || period.value > 1000) {
    error.value = '遥测周期应为 10~1000 毫秒的整数'; return
  }
  saving.value = true; message.value = ''
  try {
    await request<Config>('/api/wheel/config', { method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: mode.value, periodMs: period.value }) })
    message.value = '配置已保存，等待采集程序应用并上传确认；回放不确认配置。'
  } catch (e) { error.value = String(e) }
  finally { saving.value = false }
}
const labels = computed(() => samples.value.map(s => `${(s.deviceMillis / 1000).toFixed(2)}s`))
const series = computed(() => ['X', 'Y', 'Z'].map((name, i) => ({
  name: `陀螺 ${name}`, color: ['#1769ff', '#19a78c', '#ed8c36'][i]!,
  data: samples.value.map(s => s.values[i] ?? NaN)
})))
function number(value: number | null | undefined) {
  return value == null || !Number.isFinite(value) ? '—' : value.toFixed(4)
}
onMounted(refresh)
onBeforeUnmount(() => { stopped = true; if (timer) clearTimeout(timer) })
</script>

<template>
  <section class="wheel-panel">
    <header class="wheel-heading">
      <div><h1>动量轮遥测</h1><p>{{ hostCompression ? '旧固件 → 原始串口遥测 → 电脑压缩 → 接收端解压' : 'AT32F403A → 串口压缩传输 → 上位机解压' }}</p></div>
      <strong :class="['wheel-state', { online: status?.online && !error }]">
        {{ error ? '连接异常' : status?.online ? status.inputMode === 'REPLAY' ? '历史回放' : '正在接收' : '等待设备' }}
      </strong>
    </header>
    <p v-if="error" class="wheel-error" role="alert">{{ error }}</p>
    <div class="wheel-metrics">
      <article><span>累计有效遥测帧</span><b>{{ status?.acceptedFrames ?? 0 }}</b></article>
      <article><span>载荷节省</span><b>{{ (status?.payloadSavingPercent ?? 0).toFixed(1) }}%</b></article>
      <article><span>同协议整帧节省</span><b>{{ (status?.framedSavingPercent ?? 0).toFixed(1) }}%</b></article>
      <article><span>{{ hostCompression ? '电脑编号缺口' : '序号缺口' }}</span><b>{{ status?.sequenceGaps ?? 0 }}</b></article>
    </div>
    <p class="wheel-muted" v-if="hostCompression">压缩在采集电脑执行；串口仍传原始数据。旧协议无设备序号/时间，不能据电脑编号计算串口丢帧率。旧协议求和校验的检错能力弱于 CRC。</p>
    <p class="wheel-muted">网络帧体相对输入帧节省 {{ (status?.transportSavingPercent ?? 0).toFixed(1) }}%（电脑旧协议输入按每帧66字节；不含 HTTP/TCP 开销，负值表示增加）。上方同协议节省以86字节DCW1 RAW为基准。</p>
    <div class="wheel-card">
      <h2>压缩与传输配置</h2>
      <form class="wheel-form" @submit.prevent="save">
        <label>压缩方式<select v-model="mode"><option value="AUTO">自动无损压缩</option><option value="RAW">原始数据直传</option></select></label>
        <label>{{ hostCompression ? '上传组批周期（毫秒）' : '遥测周期（毫秒）' }}<input v-model.number="period" type="number" min="10" max="1000" step="1" required /></label>
        <button :disabled="saving" type="submit">{{ saving ? '保存中…' : '应用配置' }}</button>
        <span>{{ status?.configApplied ? hostCompression ? '采集电脑已确认配置' : '设备已确认当前配置' : '等待实时采集确认配置' }}</span>
      </form>
      <p v-if="message" role="status">{{ message }}</p>
      <p class="wheel-muted">{{ hostCompression ? 'AUTO 在电脑端无损压缩，无收益时直传。周期是上传组批等待上限目标，满20帧可提前上传；不丢弃有效样本，不改变板端采样。' : '配置通过采集程序下发设备；AUTO 无收益时直传，仅控制遥测方式和频率。' }}</p>
    </div>
    <div class="wheel-card">
      <h2>角速度（°/s）</h2>
      <LineChart v-if="samples.length" :labels="labels" :series="series" y-min="dataMin" :height="280" />
      <p v-else class="wheel-empty">尚无遥测数据。请启动串口采集程序，或回放交付包中的演示文件。</p>
    </div>
    <div class="wheel-card">
      <div class="wheel-heading"><h2>最新通道数据</h2><a href="/api/wheel/export.csv">导出最近 4000 帧 CSV</a></div>
      <p class="wheel-muted">数据来源：{{ status?.acceptedFrames ? status.inputMode === 'REPLAY' ? '历史回放' : '串口采集' : '尚未接入' }} · {{ hostCompression ? '电脑接收经过时间' : '设备时间' }} {{ status?.latest?.deviceMillis ?? '—' }} ms · 实际编码 {{ status?.latest?.codec ?? '—' }} · {{ hostCompression ? '组批周期' : '实际周期' }} {{ status?.latest?.periodMs ?? '—' }} ms</p>
      <div class="wheel-values">
        <article v-for="(channel, i) in status?.channels ?? []" :key="channel">
          <span>{{ channel }}</span><b>{{ hostCompression && i >= 3 && i <= 13 ? '未提供（预留）' : number(status?.latest?.values[i]) }}</b>
        </article>
      </div>
      <p class="wheel-muted">压缩帧 {{ status?.compressedFrames ?? 0 }} · 重复/乱序帧 {{ status?.duplicateFrames ?? 0 }} · 设备重启判定 {{ status?.deviceResets ?? 0 }} · 拒绝批次 {{ status?.rejectedBatches ?? 0 }}</p>
      <p class="wheel-muted">{{ hostCompression ? '电脑编号缺口只反映有效帧编号后的传输缺口；设备重启无法由旧协议可靠判定。回放时间是重新处理时间，预留通道不代表实际测量。' : '序号缺口包含设备忙时跳过的遥测。' }} 完整串口记录保存在采集电脑，服务端只保留当前会话最近4000帧。节省比例为服务启动以来累计值，不是网络实测带宽。</p>
    </div>
  </section>
</template>

<style scoped>
.wheel-panel{max-width:1500px;margin:auto;padding:24px;color:#183066}.wheel-heading{display:flex;justify-content:space-between;align-items:center;gap:20px}.wheel-heading h1{margin:0;font-size:28px}.wheel-heading p,.wheel-muted{color:#627393;font-size:14px;line-height:1.7}.wheel-state{border-radius:20px;background:#eef1f6;color:#637088;padding:9px 18px;white-space:nowrap}.wheel-state.online{background:#e4f6ee;color:#14734e}.wheel-metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin:22px 0}.wheel-card,.wheel-metrics article{background:white;border:1px solid #e0e7f2;border-radius:12px;padding:22px;margin-bottom:18px}.wheel-metrics article{margin:0}.wheel-metrics span,.wheel-values span{display:block;color:#627393;font-size:14px}.wheel-metrics b{display:block;font-size:30px;margin-top:10px}.wheel-card h2{font-size:18px;margin:0 0 18px}.wheel-form{display:flex;align-items:end;gap:18px;flex-wrap:wrap}.wheel-form label{font-size:14px;display:grid;gap:9px}.wheel-form input,.wheel-form select{padding:10px;border:1px solid #c8d5e9;border-radius:6px;background:white;color:#183066}.wheel-form button{padding:11px 20px;background:#1769ff;color:white;border:0;border-radius:6px;cursor:pointer}.wheel-form button:disabled{opacity:.5}.wheel-form>span{font-size:14px;padding-bottom:10px}.wheel-error{padding:15px;background:#fff1ef;color:#af3025;overflow-wrap:anywhere}.wheel-empty{padding:55px 20px;text-align:center;color:#627393}.wheel-values{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}.wheel-values article{background:#f6f8fc;padding:16px;border-radius:8px}.wheel-values b{display:block;margin-top:9px;font-variant-numeric:tabular-nums}a{color:#1769ff}@media(max-width:900px){.wheel-metrics,.wheel-values{grid-template-columns:repeat(2,1fr)}.wheel-panel{padding:12px}.wheel-heading{align-items:start}}
</style>
