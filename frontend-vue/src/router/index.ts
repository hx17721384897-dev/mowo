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

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      component: PublicLayout,
      children: [
        { path: '', name: 'home', component: HomeView, meta: { title: '哞屋造物 MOWO' } },
        {
          path: 'about',
          name: 'about',
          component: AboutView,
          meta: { title: '关于我们 · 哞屋 MOWO' }
        },
        {
          path: 'products',
          name: 'products',
          component: ProductIntroView,
          meta: { title: '产品介绍 · 哞屋 MOWO' }
        },
        { path: 'faq', name: 'faq', component: FaqView, meta: { title: '常见问题 · 哞屋 MOWO' } },
        {
          path: 'showcase',
          name: 'collab-list',
          component: CollabListView,
          meta: { title: '联名商品 · 哞屋 MOWO' }
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
          meta: { title: '联名商品详情 · 哞屋 MOWO' }
        },
        {
          path: 'legal/terms',
          name: 'terms',
          component: LegalView,
          props: { document: 'terms' },
          meta: { title: '用户协议（测试草案）· 哞屋 MOWO' }
        },
        {
          path: 'legal/privacy',
          name: 'privacy',
          component: LegalView,
          props: { document: 'privacy' },
          meta: { title: '隐私政策（测试草案）· 哞屋 MOWO' }
        }
      ]
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

router.afterEach((to) => {
  document.title = typeof to.meta.title === 'string' ? to.meta.title : '哞屋 MOWO'
})

export default router
