import { createRouter, createWebHistory } from 'vue-router'
import AppShell from '@/layouts/AppShell.vue'
import TransmissionMonitorView from '@/views/TransmissionMonitorView.vue'
const analysisComponent = import.meta.env.VITE_SOFTWARE === 'prediction'
  ? () => import('@/views/PredictionSoftwareView.vue')
  : () => import('@/views/AdaptiveSoftwareView.vue')
import EffectDisplayView from '@/views/EffectDisplayView.vue'
import ReceiverDisplayView from '@/views/ReceiverDisplayView.vue'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/',
      component: AppShell,
      redirect: '/analysis',
      children: [
        { path: 'transmission', name: 'transmission', component: TransmissionMonitorView },
        { path: 'analysis', name: 'analysis', component: analysisComponent },
        { path: 'strategy', redirect: '/analysis' },
        { path: 'effect', name: 'effect', component: EffectDisplayView }
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
