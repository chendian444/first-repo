<script setup lang="ts">
import * as echarts from 'echarts'
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { DelayItem } from '@/types/dashboard'

const props = defineProps<{ data: DelayItem[]; centerText?: string; height?: number }>()
const el = ref<HTMLDivElement>()
let chart: echarts.ECharts | undefined
let observer: ResizeObserver | undefined

function render() {
  if (!el.value) return
  const fontSizeOffset = el.value.closest('.app-shell') ? 4 : 0
  chart ||= echarts.init(el.value)
  chart.setOption({
    animationDuration: 450,
    tooltip: { trigger: 'item', formatter: '{b}<br/>{d}%', textStyle: { fontSize: 14 + fontSizeOffset } },
    title: {
      text: props.centerText || '时延占比',
      left: 'center',
      top: '42%',
      textStyle: { color: '#142a66', fontSize: 17 + fontSizeOffset, fontWeight: 700 }
    },
    series: [{
      type: 'pie',
      radius: ['56%', '79%'],
      center: ['50%', '52%'],
      startAngle: 90,
      itemStyle: { borderColor: '#fff', borderWidth: 2 },
      label: { show: false },
      data: props.data.map((item) => ({ value: item.value, name: item.name, itemStyle: { color: item.color } }))
    }]
  }, true)
}

onMounted(() => {
  render()
  observer = new ResizeObserver(() => chart?.resize())
  if (el.value) observer.observe(el.value)
})
watch(() => props.data, render, { deep: true })
onBeforeUnmount(() => { observer?.disconnect(); chart?.dispose() })
</script>

<template>
  <div ref="el" class="donut-chart" :style="{ height: `${height || 220}px` }"></div>
</template>
