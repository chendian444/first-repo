import { createApp } from 'vue'
import App from './App.vue'
import router from './router'
import './style.css'
import './sender-font-size.css'
import './split-layout.css'
import { softwareTitle } from './software'
document.title = softwareTitle

createApp(App).use(router).mount('#app')
