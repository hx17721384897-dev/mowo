<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import SourcePicker from '@/features/customize-editor/SourcePicker.vue'
import { submitHumanCustomization } from '@/features/customize-editor/api'
import { resolveEditorEntry } from '@/features/customize-editor/editor-core'
import { validateSourceFiles } from '@/features/customize-editor/source-validation'
import { uploadCustomizationFiles } from '@/features/customize-editor/upload-api'
import { getMachineModels } from '@/features/customize-start/api'
import type { MachineModel } from '@/features/customize-start/types'
import { useSessionStore } from '@/stores/session'
import '@/features/customize-editor/customize-editor.css'

const HUMAN_KEY = 'mowo_human_submission_key'
const HUMAN_OWNER = 'mowo_human_submission_owner'
const route = useRoute()
const router = useRouter()
const session = useSessionStore()
const model = ref<MachineModel | null>(null)
const loading = ref(true)
const error = ref('')
const selfFiles = ref<File[]>([])
const humanFiles = ref<File[]>([])
const humanNote = ref('')
const humanBusy = ref(false)
const humanProgress = ref('')
const pendingHumanSubmit = ref(false)
const uploadedHumanKeys = ref<string[]>([])
const entry = computed(() =>
  resolveEditorEntry(new URLSearchParams(route.query as Record<string, string>))
)

function assignFiles(target: 'self' | 'human', files: File[]): void {
  try {
    validateSourceFiles(files)
    if (target === 'self') selfFiles.value = files
    else {
      humanFiles.value = files
      uploadedHumanKeys.value = []
    }
    error.value = ''
  } catch (cause) {
    window.alert(cause instanceof Error ? cause.message : '素材格式不正确')
  }
}

function clearHuman(): void {
  humanFiles.value = []
  uploadedHumanKeys.value = []
  humanNote.value = ''
  sessionStorage.removeItem(HUMAN_KEY)
  sessionStorage.removeItem(HUMAN_OWNER)
}

function requestLogin(): void {
  pendingHumanSubmit.value = true
  void router.replace({
    query: {
      ...route.query,
      auth: '1',
      redirect: route.fullPath.replace(/([?&])auth=1(&|$)/, '$1')
    }
  })
}

function requestKey(ownerId: string): string {
  const storedOwner = sessionStorage.getItem(HUMAN_OWNER)
  let key = sessionStorage.getItem(HUMAN_KEY)
  if (!key || storedOwner !== ownerId) {
    key = crypto.randomUUID()
    sessionStorage.setItem(HUMAN_KEY, key)
    sessionStorage.setItem(HUMAN_OWNER, ownerId)
  }
  return key
}

async function submitHuman(): Promise<void> {
  if (!humanFiles.value.length || humanBusy.value || !model.value) return
  await session.bootstrap()
  if (!session.isAuthenticated || !session.user?.id) {
    requestLogin()
    return
  }
  if (
    !window.confirm(
      '提交后会进入人工筛选和制作可行性审核，不会立即生成可支付订单。工作人员处理后，结果会显示在“我的定制”。确认提交吗？'
    )
  ) {
    return
  }

  humanBusy.value = true
  try {
    if (!uploadedHumanKeys.value.length) {
      uploadedHumanKeys.value = await uploadCustomizationFiles(
        humanFiles.value,
        'CUSTOMIZATION_SOURCE',
        (completed, total) => {
          humanProgress.value = `上传素材 ${completed}/${total}`
        }
      )
    }
    humanProgress.value = '正在提交'
    const totalBytes = humanFiles.value.reduce((sum, file) => sum + file.size, 0)
    const result = await submitHumanCustomization({
      machineModelId: model.value.id,
      sourceKeys: uploadedHumanKeys.value,
      clientRequestKey: requestKey(session.user.id),
      screeningData: {
        sourceCount: humanFiles.value.length,
        totalBytes,
        formats: [...new Set(humanFiles.value.map((file) => file.type))]
      },
      userNote: humanNote.value
    })
    localStorage.removeItem('mowo_customize_request_draft_id')
    sessionStorage.removeItem(HUMAN_KEY)
    sessionStorage.removeItem(HUMAN_OWNER)
    await router.push({ name: 'my-customizations', query: { submitted: result.requestNo } })
  } catch (cause) {
    window.alert(`提交失败：${cause instanceof Error ? cause.message : '请稍后重试'}`)
  } finally {
    humanBusy.value = false
    humanProgress.value = ''
  }
}

async function startSelfScreening(): Promise<void> {
  if (!selfFiles.value.length) return
  window.alert('自己筛选编辑区仍在迁移校验中，当前正式入口尚未切换，请暂时返回上一步。')
}

async function load(): Promise<void> {
  loading.value = true
  try {
    if (entry.value.mode !== 'new-customization') throw new Error('该编辑模式尚未迁移')
    if (!entry.value.modelId) throw new Error('没有找到已选款式，请返回上一步重新选择')
    const models = await getMachineModels()
    model.value = models.find((item) => item.id === entry.value.modelId) ?? null
    if (!model.value) throw new Error('所选款式不存在或暂不可用，请返回上一步重新选择')
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '编辑器加载失败'
  } finally {
    loading.value = false
  }
}

watch(
  () => session.isAuthenticated,
  (authenticated) => {
    if (authenticated && pendingHumanSubmit.value) {
      pendingHumanSubmit.value = false
      void submitHuman()
    }
  }
)

onMounted(() => void load())
onBeforeUnmount(() => {
  pendingHumanSubmit.value = false
})
</script>

<template>
  <div class="customize-editor-page">
    <div class="progress-steps">
      <RouterLink class="progress-back" to="/customize" aria-label="返回选型号">
        <span class="progress-back-arrow" aria-hidden="true">←</span>
        <span class="progress-back-label">返回选型号</span>
      </RouterLink>
      <div class="step-item done">
        <div class="step-num">1</div>
        <span class="step-label">选型号</span>
      </div>
      <div class="step-divider"></div>
      <div class="step-item active">
        <div class="step-num">2</div>
        <span class="step-label">上传 &amp; 筛帧</span>
      </div>
      <div class="step-divider"></div>
      <div class="step-item">
        <div class="step-num">3</div>
        <span class="step-label">选款式</span>
      </div>
      <div class="step-divider"></div>
      <div class="step-item">
        <div class="step-num">4</div>
        <span class="step-label">确认 &amp; 购买</span>
      </div>
    </div>

    <main id="stateUpload">
      <p v-if="loading" class="editor-status">正在确认所选款式…</p>
      <div v-else-if="error" class="editor-status editor-error">
        <p>{{ error }}</p>
        <RouterLink class="btn btn-secondary btn-sm" to="/customize">返回选择款式</RouterLink>
      </div>
      <template v-else>
        <div class="upload-header">
          <p class="upload-eyebrow">第二步 · 共四步</p>
          <h1 class="upload-title">选择素材<em>处理方式</em></h1>
          <p class="upload-sub">你可以自己完成筛帧，也可以把原素材交给工作人员处理。</p>
        </div>
        <div class="upload-method-grid">
          <section class="upload-method self">
            <div class="method-head">
              <div>
                <p class="method-kicker">较快完成</p>
                <h2 class="method-title">我自己筛选</h2>
                <p class="method-desc">
                  进入现有编辑器，自行裁剪、抽帧并预览，完成后选择款式并提交订单。
                </p>
              </div>
              <div class="method-icon">✂</div>
            </div>
            <SourcePicker
              :files="selfFiles"
              title="上传并自己筛选"
              subtitle="拖拽文件，或点击选择"
              icon="🎞"
              accessible-label="选择自己筛选的素材"
              @select="assignFiles('self', $event)"
              @clear="selfFiles = []"
            />
            <div class="method-actions">
              <button
                class="btn btn-yellow"
                type="button"
                :disabled="!selfFiles.length"
                @click="startSelfScreening"
              >
                开始筛选 →
              </button>
            </div>
          </section>

          <section class="upload-method human">
            <div class="method-head">
              <div>
                <p class="method-kicker">人工协助</p>
                <h2 class="method-title">请工作人员帮我筛选</h2>
                <p class="method-desc">
                  提交原始素材和期望，工作人员处理后会在“我的定制”返回结果。
                </p>
              </div>
              <div class="method-icon">☷</div>
            </div>
            <SourcePicker
              :files="humanFiles"
              title="上传原始素材"
              subtitle="视频或一组图片"
              icon="＋"
              accessible-label="选择提交给工作人员的素材"
              @select="assignFiles('human', $event)"
              @clear="clearHuman"
            />
            <div v-if="humanFiles.length" class="human-form visible">
              <textarea
                v-model="humanNote"
                class="human-note"
                maxlength="1000"
                placeholder="希望保留的片段、画面重点或其他说明（选填)"
              ></textarea>
              <div class="method-delay">
                <span>◷</span><span>人工筛选不会立即完成，提交后可凭定制编号查看处理进度。</span>
              </div>
              <div class="method-actions">
                <button
                  class="btn btn-primary"
                  type="button"
                  :disabled="humanBusy"
                  @click="submitHuman"
                >
                  {{ humanProgress || '提交人工处理' }}
                </button>
              </div>
            </div>
          </section>
        </div>
      </template>
    </main>
  </div>
</template>
