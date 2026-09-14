import { createRouter, createWebHistory } from 'vue-router'
import AccountLayout from '@/layouts/AccountLayout.vue'
import AdminLayout from '@/layouts/AdminLayout.vue'
import ProductionLayout from '@/layouts/ProductionLayout.vue'
import PublicLayout from '@/layouts/PublicLayout.vue'
import AreaPlaceholderView from '@/views/AreaPlaceholderView.vue'
import ForbiddenView from '@/views/ForbiddenView.vue'
import FoundationView from '@/views/FoundationView.vue'
import NotFoundView from '@/views/NotFoundView.vue'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      component: PublicLayout,
      children: [{ path: '', name: 'foundation', component: FoundationView }]
    },
    {
      path: '/account',
      component: AccountLayout,
      children: [
        {
          path: '',
          name: 'account-shell',
          component: AreaPlaceholderView,
          props: { label: '账户区域占位' }
        }
      ]
    },
    {
      path: '/admin',
      component: AdminLayout,
      children: [
        {
          path: '',
          name: 'admin-shell',
          component: AreaPlaceholderView,
          props: { label: '管理区域占位' }
        }
      ]
    },
    {
      path: '/production',
      component: ProductionLayout,
      children: [
        {
          path: '',
          name: 'production-shell',
          component: AreaPlaceholderView,
          props: { label: '生产区域占位' }
        }
      ]
    },
    { path: '/forbidden', name: 'forbidden', component: ForbiddenView },
    { path: '/:pathMatch(.*)*', name: 'not-found', component: NotFoundView }
  ],
  scrollBehavior: () => ({ top: 0 })
})

export default router
