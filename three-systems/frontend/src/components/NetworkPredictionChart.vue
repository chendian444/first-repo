<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

export interface NetworkPredictionPoint {
  elapsedMillis: number
  actualRateKbps: number
  predictedRateKbps: number
  safeRateKbps?: number
  predictionErrorPercent?: number
  time?: string
}

const props = defineProps<{
  points: NetworkPredictionPoint[]
}>()

const canvas = ref<HTMLCanvasElement | null>(null)
const chartWrap = ref<HTMLDivElement | null>(null)
const windowMs = ref(0)
const drawnPointCount = ref(0)
const tooltipVisible = ref(false)
const tooltipLeft = ref(0)
const tooltipTop = ref(0)
const tooltipPoint = ref<NetworkPredictionPoint | null>(null)
let resizeObserver: ResizeObserver | undefined
let frame: { width: number; height: number; left: number; right: number; top: number; bottom: number; minX: number; maxX: number } | null = null

const cleanPoints = computed(() => (props.points || [])
  .filter((point) => Number.isFinite(point.elapsedMillis))
  .sort((a, b) => a.elapsedMillis - b.elapsedMillis))

const filteredPoints = computed(() => {
  const points = cleanPoints.value
  if (!points.length || windowMs.value <= 0) return points
  const latest = points[points.length - 1].elapsedMillis
  const start = Math.max(0, latest - windowMs.value)
  return points.filter((point) => point.elapsedMillis >= start)
})

const pointSummary = computed(() => {
  const count = filteredPoints.value.length
  if (!count) return '暂无数据'
  const mode = count > 20 ? '连续曲线（隐藏采样点）' : '曲线和采样点'
  const sampled = count > drawnPointCount.value ? ` · 绘图降采样至 ${drawnPointCount.value} 点` : ''
  return `当前范围 ${count} 点 · ${mode}${sampled}`
})

const tooltipStyle = computed(() => ({ left: `${tooltipLeft.value}px`, top: `${tooltipTop.value}px` }))

function lttb(data: NetworkPredictionPoint[], threshold: number): NetworkPredictionPoint[] {
  if (data.length <= threshold || threshold < 3) return data.slice()
  const sampled = [data[0]]
  const every = (data.length - 2) / (threshold - 2)
  let anchorIndex = 0
  for (let index = 0; index < threshold - 2; index += 1) {
    const averageStart = Math.floor((index + 1) * every) + 1
    const averageEnd = Math.min(Math.floor((index + 2) * every) + 1, data.length)
    let averageX = 0
    let averageY = 0
    let averageCount = 0
    for (let cursor = averageStart; cursor < averageEnd; cursor += 1) {
      averageX += data[cursor].elapsedMillis
      averageY += data[cursor].actualRateKbps
      averageCount += 1
    }
    if (!averageCount) {
      averageX = data[data.length - 1].elapsedMillis
      averageY = data[data.length - 1].actualRateKbps
      averageCount = 1
    }
    averageX /= averageCount
    averageY /= averageCount

    const rangeStart = Math.floor(index * every) + 1
    const rangeEnd = Math.min(Math.floor((index + 1) * every) + 1, data.length - 1)
    const anchor = data[anchorIndex]
    let maximumArea = -1
    let nextAnchor = rangeStart
    for (let cursor = rangeStart; cursor < rangeEnd; cursor += 1) {
      const candidate = data[cursor]
      const area = Math.abs(
        (anchor.elapsedMillis - averageX) * (candidate.actualRateKbps - anchor.actualRateKbps)
        - (anchor.elapsedMillis - candidate.elapsedMillis) * (averageY - anchor.actualRateKbps)
      )
      if (area > maximumArea) {
        maximumArea = area
        nextAnchor = cursor
      }
    }
    sampled.push(data[nextAnchor])
    anchorIndex = nextAnchor
  }
  sampled.push(data[data.length - 1])
  return sampled
}

function formatRate(value: number) {
  return Number.isFinite(value) ? `${value.toFixed(2)} KB/s` : '—'
}

function formatElapsed(milliseconds: number) {
  const total = Math.max(0, Math.round(milliseconds / 1000))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
    : `${minutes}:${String(seconds).padStart(2, '0')}`
}

function tickLabel(value: number) {
  if (Math.abs(value) >= 1000) return value.toFixed(0)
  if (Math.abs(value) >= 100) return value.toFixed(1)
  return value.toFixed(2)
}

function draw() {
  const target = canvas.value
  const parent = chartWrap.value
  if (!target || !parent) return

  const rect = parent.getBoundingClientRect()
  const width = Math.max(320, Math.round(rect.width))
  const height = Math.max(250, Math.round(rect.height || 300))
  const ratio = window.devicePixelRatio || 1
  target.width = Math.round(width * ratio)
  target.height = Math.round(height * ratio)
  target.style.width = `${width}px`
  target.style.height = `${height}px`
  const context = target.getContext('2d')
  if (!context) return
  context.setTransform(ratio, 0, 0, ratio, 0, 0)
  context.clearRect(0, 0, width, height)

  const raw = filteredPoints.value
  if (!raw.length) {
    frame = null
    drawnPointCount.value = 0
    context.fillStyle = '#7b89a7'
    context.font = '16px "Microsoft YaHei", Arial'
    context.textAlign = 'center'
    context.fillText('暂无预测数据', width / 2, height / 2)
    return
  }

  const maximumPoints = Math.max(120, Math.min(800, Math.floor(width / 2)))
  const points = lttb(raw, maximumPoints)
  drawnPointCount.value = points.length
  const allY = points.flatMap((point) => [point.actualRateKbps, point.predictedRateKbps]).filter(Number.isFinite)
  let minX = points[0].elapsedMillis
  let maxX = points[points.length - 1].elapsedMillis
  let minY = Math.min(...allY)
  let maxY = Math.max(...allY)
  if (maxX === minX) { minX -= 500; maxX += 500 }
  if (maxY === minY) {
    const padding = Math.max(1, Math.abs(maxY) * 0.05)
    minY = Math.max(0, minY - padding)
    maxY += padding
  } else {
    const padding = Math.max(1, (maxY - minY) * 0.12)
    minY = Math.max(0, minY - padding)
    maxY += padding
  }

  const margin = { left: 82, right: 24, top: 30, bottom: 58 }
  const chartWidth = width - margin.left - margin.right
  const chartHeight = height - margin.top - margin.bottom
  const x = (value: number) => margin.left + ((value - minX) / (maxX - minX)) * chartWidth
  const y = (value: number) => margin.top + (1 - (value - minY) / Math.max(1e-9, maxY - minY)) * chartHeight
  frame = { width, height, left: margin.left, right: width - margin.right, top: margin.top, bottom: height - margin.bottom, minX, maxX }

  context.font = '13px "Microsoft YaHei", Arial'
  context.strokeStyle = '#e3eaf6'
  context.fillStyle = '#71809f'
  context.lineWidth = 1
  for (let index = 0; index < 6; index += 1) {
    const value = minY + ((maxY - minY) * index) / 5
    const position = y(value)
    context.beginPath()
    context.moveTo(margin.left, position)
    context.lineTo(width - margin.right, position)
    context.stroke()
    context.textAlign = 'right'
    context.fillText(tickLabel(value), margin.left - 9, position + 4)
  }
  for (let index = 0; index < 6; index += 1) {
    const value = minX + ((maxX - minX) * index) / 5
    const position = x(value)
    context.beginPath()
    context.moveTo(position, margin.top)
    context.lineTo(position, height - margin.bottom)
    context.stroke()
    context.textAlign = 'center'
    context.fillText(formatElapsed(value), position, height - margin.bottom + 21)
  }
  context.textAlign = 'left'
  context.fillText('速率（KB/s）', 8, 16)
  context.textAlign = 'center'
  context.fillText('运行时间', width / 2, height - 8)

  const series = [
    { key: 'actualRateKbps' as const, color: '#3478f6' },
    { key: 'predictedRateKbps' as const, color: '#18a7a0' }
  ]
  const showPointMarkers = raw.length <= 20
  series.forEach((item) => {
    context.strokeStyle = item.color
    context.lineWidth = 2
    context.lineJoin = 'round'
    context.lineCap = 'round'
    context.beginPath()
    points.forEach((point, index) => {
      const xx = x(point.elapsedMillis)
      const yy = y(point[item.key])
      if (index === 0) context.moveTo(xx, yy)
      else context.lineTo(xx, yy)
    })
    context.stroke()
    if (showPointMarkers) {
      context.fillStyle = item.color
      points.forEach((point) => {
        context.beginPath()
        context.arc(x(point.elapsedMillis), y(point[item.key]), 3, 0, Math.PI * 2)
        context.fill()
      })
    }
  })
}

function nearestPoint(target: number) {
  const points = filteredPoints.value
  if (!points.length) return null
  let low = 0
  let high = points.length - 1
  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    if (points[middle].elapsedMillis < target) low = middle + 1
    else high = middle
  }
  const right = points[low]
  const left = low > 0 ? points[low - 1] : right
  return Math.abs(left.elapsedMillis - target) <= Math.abs(right.elapsedMillis - target) ? left : right
}

function onMouseMove(event: MouseEvent) {
  const target = canvas.value
  if (!target || !frame) return
  const rect = target.getBoundingClientRect()
  const mouseX = event.clientX - rect.left
  if (mouseX < frame.left || mouseX > frame.right) {
    tooltipVisible.value = false
    return
  }
  const targetElapsed = frame.minX + ((mouseX - frame.left) / (frame.right - frame.left)) * (frame.maxX - frame.minX)
  const point = nearestPoint(targetElapsed)
  if (!point) return
  tooltipPoint.value = point
  tooltipLeft.value = Math.min(rect.width - 250, Math.max(6, mouseX + 14))
  tooltipTop.value = Math.max(6, event.clientY - rect.top - 64)
  tooltipVisible.value = true
}

function onMouseLeave() {
  tooltipVisible.value = false
}

watch(filteredPoints, async () => {
  await nextTick()
  draw()
}, { deep: true })

onMounted(() => {
  resizeObserver = new ResizeObserver(draw)
  if (chartWrap.value) resizeObserver.observe(chartWrap.value)
  nextTick(draw)
})

onBeforeUnmount(() => resizeObserver?.disconnect())
</script>

<template>
  <div class="network-prediction-module">
    <div class="network-chart-toolbar">
      <label>
        <span>显示范围</span>
        <select v-model.number="windowMs">
          <option :value="0">全部</option>
          <option :value="300000">最近 5 分钟</option>
          <option :value="900000">最近 15 分钟</option>
          <option :value="1800000">最近 30 分钟</option>
          <option :value="3600000">最近 1 小时</option>
        </select>
      </label>
      <span>{{ pointSummary }}</span>
    </div>
    <div ref="chartWrap" class="network-chart-wrap">
      <canvas ref="canvas" @mousemove="onMouseMove" @mouseleave="onMouseLeave"></canvas>
      <div v-if="tooltipVisible && tooltipPoint" class="network-chart-tooltip" :style="tooltipStyle">
        <strong>运行时间 {{ formatElapsed(tooltipPoint.elapsedMillis) }}</strong>
        <span><em>实际速率</em><b>{{ formatRate(tooltipPoint.actualRateKbps) }}</b></span>
        <span><em>预测速率</em><b>{{ formatRate(tooltipPoint.predictedRateKbps) }}</b></span>
      </div>
    </div>
    <div class="network-chart-legend">
      <span><i class="actual"></i>实际速率</span>
      <span><i class="prediction"></i>预测速率</span>
    </div>
  </div>
</template>
