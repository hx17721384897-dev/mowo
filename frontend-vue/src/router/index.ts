import { createRouter, createWebHistory } from 'vue-router'
import AccountLayout from '@/layouts/AccountLayout.vue'
import AdminLayout from '@/layouts/AdminLayout.vue'
import ProductionLayout from '@/layouts/ProductionLayout.vue'
import PublicLayout from '@/layouts/PublicLayout.vue'
import AreaPlaceholderView from '@/views/AreaPlaceholderView.vue'
import AboutView from '@/views/AboutView.vue'
import FaqView from '@/views/FaqView.vue'
import ForbiddenView from '@/views/ForbiddenView.vue'
import HomeView from '@/views/HomeView.vue'
import LegalView from '@/views/LegalView.vue'
import NotFoundView from '@/views/NotFoundView.vue'
import ProductIntroView from '@/views/ProductIntroView.vue'
import CollabListView from '@/views/CollabListView.vue'
import CollabDetailView from '@/views/CollabDetailView.vue'
import ContactView from '@/views/ContactView.vue'
import { useSessionStore } from '@/stores/session'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      component: PublicLayout,
      children: [
        {
          path: '',
          name: 'home',
          component: HomeView,
          meta: { title: '哞屋造物 MOWOBOX · 转动手柄，让创意动起来', pageOwnFooter: true }
        },
        {
          path: 'about',
          name: 'about',
          component: AboutView,
          meta: { title: '关于我们 · 哞屋 MOWO', pageOwnFooter: true }
        },
        {
          path: 'products',
          name: 'products',
          component: ProductIntroView,
          meta: { title: '产品介绍 · 哞屋 MOWO', pageOwnFooter: true }
        },
        {
          path: 'faq',
          name: 'faq',
          component: FaqView,
          meta: { title: '常见问题 · 哞屋 MOWO', pageOwnFooter: true }
        },
        {
          path: 'contact',
          name: 'contact',
          component: ContactView,
          meta: { title: '联络我们 · 哞屋 MOWO', pageOwnFooter: true }
        },
        {
          path: 'showcase',
          name: 'collab-list',
          component: CollabListView,
          meta: { title: '联名作品 — 哞屋 MOWO', pageOwnFooter: true }
        },
        {
          path: 'customize',
          name: 'customize-start',
          component: () => import('@/views/CustomizeStartView.vue'),
          meta: { title: '选择款式 — 哞屋 MOWO' }
        },
        {
          path: 'customize/editor',
          name: 'customize-editor',
          component: () => import('@/views/CustomizeEditorView.vue'),
          meta: { title: '上传 & 筛帧 — 哞屋 MOWO', pageOwnFooter: true }
        },
        {
          path: 'customize/confirm',
          name: 'customize-confirm',
          component: () => import('@/views/CustomizeConfirmView.vue'),
          meta: {
            title: '选择款式 — 哞屋 MOWO',
            pageOwnFooter: true,
            requiresAuth: true
          }
        },
        {
          path: 'cart',
          name: 'cart',
          component: () => import('@/views/CartView.vue'),
          meta: { title: '购物车 — 哞屋 MOWO', requiresAuth: true }
        },
        {
          path: 'checkout',
          name: 'checkout',
          component: () => import('@/views/CheckoutView.vue'),
          meta: { title: '确认订单 — 哞屋 MOWO', requiresAuth: true }
        },
        {
          path: 'orders',
          name: 'orders',
          component: () => import('@/views/OrdersView.vue'),
          meta: { title: '我的订单 — 哞屋 MOWO', requiresAuth: true }
        },
        {
          path: 'orders/:id',
          name: 'order-detail',
          component: () => import('@/views/OrderDetailView.vue'),
          meta: { title: '订单详情 — 哞屋 MOWO', requiresAuth: true }
        },
        {
          path: 'showcase-detail',
          redirect: (to) => {
            const workId = typeof to.query.workId === 'string' ? to.query.workId : ''
            return workId
              ? { name: 'collab-detail', params: { workId }, query: { sku: to.query.sku } }
              : { name: 'collab-list' }
          }
        },
        {
          path: 'showcase/:workId',
          name: 'collab-detail',
          component: CollabDetailView,
          meta: { title: '联名商品详情 - 哞屋 MOWO', pageOwnFooter: true }
        },
        {
          path: 'legal/terms',
          name: 'terms',
          component: LegalView,
          props: { document: 'terms' },
          meta: {
            title: '用户协议（测试草案）· 哞屋 MOWO',
            pageOwnHeader: true,
            pageOwnFooter: true
          }
        },
        {
          path: 'legal/privacy',
          name: 'privacy',
          component: LegalView,
          props: { document: 'privacy' },
          meta: {
            title: '隐私政策（测试草案）· 哞屋 MOWO',
            pageOwnHeader: true,
            pageOwnFooter: true
          }
        }
      ]
    },
    {
      path: '/account',
      component: AccountLayout,
      meta: { requiresAuth: true },
      children: [
        {
          path: '',
          redirect: { name: 'account-settings' }
        },
        {
          path: 'settings',
          name: 'account-settings',
          component: () => import('@/views/SettingsView.vue'),
          meta: { title: '账号设置 — 哞屋 MOWO' }
        },
        {
          path: 'customizations',
          name: 'my-customizations',
          component: () => import('@/views/MyCustomizationsView.vue'),
          meta: { title: '我的定制 — 哞屋 MOWO' }
        },
        {
          path: 'animations',
          name: 'my-animations',
          component: () => import('@/views/MyAnimationsView.vue'),
          meta: { title: '我的动画 — 哞屋 MOWO' }
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
    {
      path: '/:pathMatch(.*)*',
      component: PublicLayout,
      children: [
        {
          path: '',
          name: 'not-found',
          component: NotFoundView,
          meta: { title: '页面不存在 · 哞屋 MOWO' }
        }
      ]
    }
  ],
  scrollBehavior: () => ({ top: 0 })
})

router.beforeEach(async (to) => {
  if (!to.matched.some((record) => record.meta.requiresAuth === true)) return true

  const session = useSessionStore()
  await session.bootstrap()
  if (session.isAuthenticated) return true

  return {
    name: 'home',
    query: {
      auth: '1',
      redirect: to.fullPath,
      ...(session.status === 'unavailable' ? { session: 'unavailable' } : {})
    }
  }
})

router.afterEach((to) => {
  document.title = typeof to.meta.title === 'string' ? to.meta.title : '哞屋 MOWO'
})

export default router
