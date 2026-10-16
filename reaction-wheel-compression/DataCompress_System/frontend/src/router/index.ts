import { createRouter, createWebHistory } from 'vue-router'
import AppShell from '@/layouts/AppShell.vue'
import TransmissionMonitorView from '@/views/TransmissionMonitorView.vue'
import StrategyAnalysisView from '@/views/StrategyAnalysisView.vue'
import EffectDisplayView from '@/views/EffectDisplayView.vue'
import ReceiverDisplayView from '@/views/ReceiverDisplayView.vue'
import WheelTelemetryView from '@/views/WheelTelemetryView.vue'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/',
      component: AppShell,
      redirect: '/transmission',
      children: [
        { path: 'transmission', name: 'transmission', component: TransmissionMonitorView },
        { path: 'strategy', name: 'strategy', component: StrategyAnalysisView },
        { path: 'effect', name: 'effect', component: EffectDisplayView },
        { path: 'wheel', name: 'wheel', component: WheelTelemetryView }
      ]
    },
    {
      path: '/receiver',
      name: 'receiver',
      component: ReceiverDisplayView
    }
  ]
})

export default router
