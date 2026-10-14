<script setup lang="ts">
import * as echarts from 'echarts'
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'

interface ChartSeries {
  name: string
  data: number[]
  color: string
  dashed?: boolean
  area?: boolean
}

const props = withDefaults(defineProps<{
  labels: string[]
  series: ChartSeries[]
  yName?: string
  yMax?: number
  yInterval?: number
  height?: number
  markerIndexes?: { index: number; label: string }[]
}>(), {
  yName: '',
  yMax: undefined,
  yInterval: undefined,
  height: 260,
  markerIndexes: () => []
})

const chartEl = ref<HTMLDivElement>()
let chart: echarts.ECharts | undefined
let observer: ResizeObserver | undefined

function render() {
  if (!chartEl.value) return
  const fontSizeOffset = chartEl.value.closest('.app-shell') ? 4 : 0
  chart ||= echarts.init(chartEl.value)
  chart.setOption({
    animationDuration: 420,
    grid: { left: 12, right: 18, top: 46, bottom: 20, containLabel: true },
    tooltip: {
      trigger: 'axis',
      backgroundColor: 'rgba(7, 32, 91, .92)',
      borderWidth: 0,
      textStyle: { color: '#fff', fontSize: 14 + fontSizeOffset }
    },
    legend: props.series.length > 1 ? {
      top: 2,
      right: 2,
      itemWidth: 18,
      itemHeight: 3,
      textStyle: { color: '#536281', fontSize: 13 + fontSizeOffset }
    } : undefined,
    xAxis: {
      type: 'category',
      boundaryGap: false,
      data: props.labels,
      axisLine: { lineStyle: { color: '#dfe7f7' } },
      axisTick: { show: false },
      axisLabel: { color: '#4d5d84', fontSize: 13 + fontSizeOffset, margin: 12 }
    },
    yAxis: {
      type: 'value',
      min: 0,
      max: props.yMax,
      interval: props.yInterval,
      axisLabel: { color: '#4d5d84', fontSize: 13 + fontSizeOffset, margin: 10 },
      splitLine: { lineStyle: { color: '#e7eefb', type: 'dashed' } },
      axisLine: { show: false },
      axisTick: { show: false }
    },
    series: props.series.map((item, index) => ({
      name: item.name,
      type: 'line',
      smooth: true,
      data: item.data,
      symbol: index === 0 ? 'circle' : 'none',
      symbolSize: 6,
      lineStyle: { width: 2.2, color: item.color, type: item.dashed ? 'dashed' : 'solid' },
      itemStyle: { color: item.color },
      areaStyle: item.area ? { color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: `${item.color}42` }, { offset: 1, color: `${item.color}03` }]) } : undefined,
      markLine: index === 0 && props.markerIndexes.length ? {
        symbol: 'none',
        label: { show: true, color: '#1769ff', fontSize: 12 + fontSizeOffset, fontWeight: 700, backgroundColor: '#edf4ff', borderColor: '#8ab7ff', borderWidth: 1, borderRadius: 4, padding: [3, 5] },
        lineStyle: { color: '#8ab7ff', type: 'dashed', width: 1.3 },
        data: props.markerIndexes.map((m) => ({ xAxis: props.labels[m.index], label: { formatter: m.label } }))
      } : undefined
    }))
  }, true)
}

onMounted(() => {
  render()
  observer = new ResizeObserver(() => chart?.resize())
  if (chartEl.value) observer.observe(chartEl.value)
})

watch(() => [props.labels, props.series, props.yMax, props.yInterval], render, { deep: true })

onBeforeUnmount(() => {
  observer?.disconnect()
  chart?.dispose()
})
</script>

<template>
  <div class="chart line-chart-shell" :style="{ height: `${height}px` }">
    <span v-if="yName" class="chart-y-title">{{ yName }}</span>
    <div ref="chartEl" class="line-chart-canvas"></div>
  </div>
</template>
