import { createPinia } from 'pinia'
import { createApp } from 'vue'
import { useSessionStore } from '@/stores/session'
import App from './App.vue'
import router from './router'
import './styles/tokens.css'
import './styles/base.css'
import './styles/public.css'
import './styles/legacy-fidelity.css'
import './styles/legacy-auth.css'

const app = createApp(App)
const pinia = createPinia()

app.use(pinia)
const session = useSessionStore(pinia)
session.startSynchronization()
void session.bootstrap()

app.use(router).mount('#app')
