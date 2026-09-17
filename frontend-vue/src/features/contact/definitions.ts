import type {
  ContactDefinition,
  ContactField,
  ContactFilePurpose,
  ContactPayload,
  ContactType,
  ContactValues
} from './types'

const text = (
  name: string,
  label: string,
  placeholder: string,
  required = false,
  kind: ContactField['kind'] = 'text'
): ContactField => ({ name, label, placeholder, required, kind })

const select = (
  name: string,
  label: string,
  options: string[],
  required = false
): ContactField => ({ name, label, kind: 'select', options, required })

const textarea = (
  name: string,
  label: string,
  placeholder: string,
  required = false,
  minHeight?: number
): ContactField => ({ name, label, kind: 'textarea', placeholder, required, minHeight })

export const contactDefinitions: ContactDefinition[] = [
  {
    type: 'artist',
    icon: '🎨',
    cardTitle: '画师 / IP 联名',
    cardSubtitle: '让原创角色成为可以转动和收藏的实体作品',
    cardAction: '提交合作意向',
    modalTitle: '画师 / IP 联名合作',
    modalSubtitle: '告诉我们你的创作方向和合作想法，工作人员会人工评估并与你联络。',
    description:
      '如果你拥有原创 IP 或有权代表相关作品，欢迎提交创作方向、授权情况和合作想法。具体设计、推广与合作条件以双方后续确认的书面约定为准。',
    rows: [
      [
        text('name', '你的名字 / 工作室名', '例：小墨工作室', true),
        text('contact', '联系邮箱', 'your@email.com', true, 'email')
      ],
      [
        text('platform', '主要创作平台', '例：微博、B站、小红书'),
        text('fanbase', '受众情况', '可选：主要平台及受众规模')
      ],
      [textarea('message', 'IP / 作品介绍', '介绍作品、权利归属和合作想法……', true)],
      [text('portfolioUrl', '作品集链接', 'https://...', false, 'url')],
      [
        {
          name: 'files',
          label: '上传作品文件（可选）',
          kind: 'file',
          accept: '.jpg,.jpeg,.png,.pdf',
          multiple: true,
          hint: '支持 JPG / PNG / PDF，单个最大 20MB，最多 6 个'
        }
      ]
    ],
    submitLabel: '提交合作申请 →',
    formNote: '请勿上传身份证、合同或其他与本次合作评估无关的敏感资料',
    successIcon: '🎉',
    successTitle: '收到了！',
    successBody: '你的合作意向已经提交。工作人员会在完成评估后通过你留下的方式联络。',
    successClose: '好的'
  },
  {
    type: 'media',
    icon: '📣',
    cardTitle: '媒体 / 博主合作',
    cardSubtitle: '报道、测评或内容共创，都欢迎来聊',
    cardAction: '发起合作',
    modalTitle: '媒体 / 博主合作',
    modalSubtitle: '告诉我们你的频道与合作方向，一起探索合适的内容形式。',
    description:
      '如果你是博主、媒体或内容创作者，有兴趣报道、测评或共同创作内容，欢迎提交合作方向。',
    rows: [
      [
        text('name', '你的名字 / 媒体名', '例：XX测评', true),
        text('contact', '联系邮箱', 'your@email.com', true, 'email')
      ],
      [
        select(
          'platform',
          '主要平台',
          ['B站', '小红书', '微博', '抖音', '微信公众号', '媒体/杂志', '其他'],
          true
        ),
        text('fanbase', '受众 / 阅读情况', '可选填写')
      ],
      [textarea('message', '合作方向', '你希望以什么形式合作？请告诉我们你的想法。', true)],
      [text('profileUrl', '主页链接', 'https://...', false, 'url')]
    ],
    submitLabel: '发起合作 →',
    formNote: '工作人员会根据内容方向和当前安排人工评估',
    successIcon: '📣',
    successTitle: '合作意向已收到！',
    successBody: '我们会认真阅读你提交的信息，并在适合进一步沟通时通过你留下的方式联络。',
    successClose: '好的！'
  },
  {
    type: 'feedback',
    icon: '💡',
    cardTitle: '反馈 & 创意共建',
    cardSubtitle: '问题、建议和新点子，我们都愿意听',
    cardAction: '告诉我们',
    modalTitle: '反馈 & 创意共建',
    modalSubtitle: '你的反馈会帮助我们了解问题和改进方向。',
    description: '收到产品后遇到问题，或对现有流程和产品有建议，都可以在这里告诉我们。',
    rows: [
      [
        select(
          'feedbackType',
          '类型',
          [
            '我遇到了问题',
            '我有一个改进建议',
            '我有一个新点子 💡',
            '创作中心反馈',
            '物流 / 售后',
            '其他'
          ],
          true
        )
      ],
      [text('contact', '联系邮箱（可选）', '填写后工作人员可以回复你', false, 'email')],
      [textarea('message', '你的想法', '请尽量详细描述问题、建议或想法……', true, 160)],
      [
        {
          name: 'wantBeta',
          label: '我愿意被邀请参加哞屋内部测试，并就体验主动提供反馈',
          kind: 'checkbox'
        }
      ]
    ],
    submitLabel: '提交 →',
    formNote: '是否参与内部测试完全自愿，不影响本次反馈处理',
    successIcon: '🧡',
    successTitle: '谢谢你告诉我们！',
    successBody: '你的反馈已经收到。如果留下了联系方式，工作人员可能就具体问题与你进一步确认。',
    successClose: '好的'
  },
  {
    type: 'channel',
    icon: '🏪',
    cardTitle: '线下渠道合作',
    cardSubtitle: '探索门店陈列、销售和线下活动合作',
    cardAction: '了解合作',
    modalTitle: '线下渠道合作',
    modalSubtitle: '告诉我们你的门店情况和合作设想，工作人员会评估可行性。',
    description: '潮玩店、精品店、文创店或其他线下渠道，可以提交门店情况和希望讨论的合作方式。',
    rows: [
      [
        text('name', '联系人姓名', '你的姓名', true),
        text('contact', '联系邮箱', 'your@email.com', true, 'email')
      ],
      [
        text('company', '公司 / 门店名称', '例：XX潮玩集合店', true),
        text('city', '所在城市', '例：北京、上海', true)
      ],
      [
        select('storeType', '门店类型', [
          '潮玩集合店',
          '独立精品店',
          '商场买手店',
          '书店 / 文创店',
          '其他'
        ])
      ],
      [textarea('message', '合作想法', '介绍门店情况，以及希望讨论的合作形式……', true)]
    ],
    submitLabel: '提交合作意向 →',
    formNote: '具体销售、代理或活动条件以双方后续书面确认结果为准',
    successIcon: '🏪',
    successTitle: '意向已收到！',
    successBody: '工作人员会评估你提交的渠道信息，并在适合进一步沟通时与你联络。',
    successClose: '好的'
  },
  {
    type: 'factory',
    icon: '🏭',
    cardTitle: '厂家合作',
    cardSubtitle: '寻找可靠、可追溯的生产合作伙伴',
    cardAction: '洽谈合作',
    modalTitle: '厂家合作',
    modalSubtitle: '告诉我们你的生产能力，工作人员会认真评估合作可行性。',
    description:
      '如果你具备相关工艺或生产能力，欢迎提交企业、产能和案例信息。实际合作以资质核验和书面约定为准。',
    rows: [
      [
        text('name', '联系人姓名', '你的姓名', true),
        text('contact', '联系方式', '手机号或邮箱', true)
      ],
      [
        text('company', '公司 / 工厂名称', '例：XX制品有限公司', true),
        text('city', '所在城市', '例：广州、义乌', true)
      ],
      [text('category', '主要生产品类', '例：木制工艺品、亚克力制品、精密五金', true)],
      [text('capacity', '产能情况', '请填写可核实的产能范围', true)],
      [text('brands', '已合作品牌 / 案例（可选）', '例：曾为 XX 品牌代工')],
      [text('certUrl', '官网或资质信息链接（可选）', 'https://...', false, 'url')],
      [
        textarea(
          'message',
          '补充说明（可选）',
          '例如：特殊工艺、设备、最小起订量和希望讨论的合作方式……'
        )
      ]
    ],
    submitLabel: '提交合作意向 →',
    formNote: '请勿在公开表单中上传合同、证照原件或其他敏感文件',
    successIcon: '🤝',
    successTitle: '意向已收到！',
    successBody: '工作人员会评估你提交的生产信息，并在适合进一步沟通时与你联络。',
    successClose: '好的'
  },
  {
    type: 'join',
    icon: '💼',
    cardTitle: '加入哞屋',
    cardSubtitle: '如果你也想做有意思的事，欢迎介绍自己',
    cardAction: '投递简历',
    modalTitle: '加入哞屋',
    modalSubtitle: '告诉我们你的方向并提交简历，招聘安排以工作人员后续联络为准。',
    description:
      '如果你热爱动画、产品或制造，可以提交个人方向与经历。请只上传用于本次申请的必要资料。',
    rows: [
      [
        text('name', '你的名字', '姓名', true),
        text('contact', '联系邮箱', 'your@email.com', true, 'email')
      ],
      [
        select(
          'direction',
          '应聘方向',
          [
            '产品设计',
            '前端开发',
            '后端开发',
            '品牌营销',
            '内容创作',
            '供应链 / 运营',
            '其他 / 自荐'
          ],
          true
        ),
        select('experience', '工作年限', ['应届生', '1 – 3 年', '3 – 5 年', '5 年以上'])
      ],
      [textarea('message', '自我介绍', '简单介绍你的经历和希望参与的方向……')],
      [
        {
          name: 'files',
          label: '上传简历',
          kind: 'file',
          accept: '.pdf',
          required: true,
          hint: '仅支持 PDF，最大 10MB'
        }
      ],
      [text('portfolioUrl', '作品集 / 个人链接', 'https://...', false, 'url')]
    ],
    submitLabel: '投递简历 →',
    formNote: '请勿上传身份证、银行卡、薪资证明等非必要敏感资料',
    successIcon: '🌟',
    successTitle: '简历已收到！',
    successBody: '工作人员会认真阅读你提交的资料，并在适合进一步沟通时通过邮箱联络。',
    successClose: '好的'
  }
]

export function initialContactValues(definition: ContactDefinition): ContactValues {
  const values: ContactValues = {}
  for (const field of definition.rows.flat()) {
    values[field.name] = field.kind === 'checkbox' ? false : field.kind === 'file' ? [] : ''
  }
  return values
}

function stringValue(values: ContactValues, key: string): string {
  const value = values[key]
  return typeof value === 'string' ? value.trim() : ''
}

function optionalExtra(
  entries: Array<[string, string | boolean]>
): Record<string, string | boolean> | undefined {
  const extra = Object.fromEntries(entries.filter(([, value]) => value !== '' && value !== false))
  return Object.keys(extra).length ? extra : undefined
}

function requireHttpUrl(value: string, label: string): string {
  if (!value) return ''
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    throw new Error(`${label}格式无效`)
  }
  if (!['http:', 'https:'].includes(parsed.protocol))
    throw new Error(`${label}只允许 HTTP 或 HTTPS`)
  return parsed.toString()
}

export function contactFilePolicy(type: ContactType): {
  purpose: ContactFilePurpose
  maxBytes: number
  maxFiles: number
  mimeTypes: string[]
  extensions: string[]
} | null {
  if (type === 'artist') {
    return {
      purpose: 'CONTACT_PORTFOLIO',
      maxBytes: 20 * 1024 * 1024,
      maxFiles: 6,
      mimeTypes: ['image/jpeg', 'image/png', 'application/pdf'],
      extensions: ['jpg', 'jpeg', 'png', 'pdf']
    }
  }
  if (type === 'join') {
    return {
      purpose: 'CONTACT_RESUME',
      maxBytes: 10 * 1024 * 1024,
      maxFiles: 1,
      mimeTypes: ['application/pdf'],
      extensions: ['pdf']
    }
  }
  return null
}

export function validateContactFiles(type: ContactType, files: File[]): void {
  const policy = contactFilePolicy(type)
  if (!policy && files.length) throw new Error('该联络类型不支持附件')
  if (!policy) return
  if (files.length > policy.maxFiles) throw new Error(`最多选择 ${policy.maxFiles} 个文件`)
  if (type === 'join' && files.length !== 1) throw new Error('请上传一份 PDF 简历')
  for (const file of files) {
    const extension = file.name.includes('.') ? file.name.split('.').pop()!.toLowerCase() : ''
    if (!policy.mimeTypes.includes(file.type) || !policy.extensions.includes(extension)) {
      throw new Error(`${file.name} 的文件类型不符合要求`)
    }
    if (file.size <= 0 || file.size > policy.maxBytes) {
      throw new Error(`${file.name} 超过允许大小或内容为空`)
    }
  }
}

export function buildContactPayload(
  type: ContactType,
  values: ContactValues,
  attachments: string[]
): ContactPayload {
  const name = stringValue(values, 'name')
  const contact = stringValue(values, 'contact')
  const message = stringValue(values, 'message')
  const portfolioUrl = requireHttpUrl(stringValue(values, 'portfolioUrl'), '作品集链接')
  const profileUrl = requireHttpUrl(stringValue(values, 'profileUrl'), '主页链接')
  const certUrl = requireHttpUrl(stringValue(values, 'certUrl'), '资质信息链接')

  switch (type) {
    case 'artist':
      return {
        type,
        name,
        contact,
        message,
        extra: optionalExtra([
          ['platform', stringValue(values, 'platform')],
          ['fanbase', stringValue(values, 'fanbase')],
          ['portfolioUrl', portfolioUrl]
        ]),
        attachments
      }
    case 'channel':
      return {
        type,
        name,
        contact,
        message,
        extra: optionalExtra([
          ['company', stringValue(values, 'company')],
          ['city', stringValue(values, 'city')],
          ['storeType', stringValue(values, 'storeType')]
        ])
      }
    case 'media':
      return {
        type,
        name,
        contact,
        message,
        extra: optionalExtra([
          ['platform', stringValue(values, 'platform')],
          ['fanbase', stringValue(values, 'fanbase')],
          ['profileUrl', profileUrl]
        ])
      }
    case 'join':
      return {
        type,
        name,
        contact,
        message: message || '（无自我介绍）',
        extra: optionalExtra([
          ['direction', stringValue(values, 'direction')],
          ['experience', stringValue(values, 'experience')],
          ['portfolioUrl', portfolioUrl]
        ]),
        attachments
      }
    case 'feedback':
      return {
        type,
        name: contact || '匿名用户',
        contact: contact || '未留联系方式',
        message,
        extra: optionalExtra([
          ['feedbackType', stringValue(values, 'feedbackType')],
          ['wantBeta', values.wantBeta === true]
        ])
      }
    case 'factory':
      return {
        type,
        name,
        contact,
        message: message || '（无补充说明）',
        extra: optionalExtra([
          ['company', stringValue(values, 'company')],
          ['city', stringValue(values, 'city')],
          ['category', stringValue(values, 'category')],
          ['capacity', stringValue(values, 'capacity')],
          ['brands', stringValue(values, 'brands')],
          ['certUrl', certUrl]
        ])
      }
  }
}
