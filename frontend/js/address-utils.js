/**
 * address-utils.js — 地址工具库
 * 提供：智能地址解析（smartParseAddress）+ 联级省市区下拉（initCascadeSelects）+ 表单填充（fillAddressForm）
 * 无任何第三方依赖，纯原生 JS
 */

// ─── 全局缓存地区数据 ───────────────────────────────────────────────
let _regionsData = null

/**
 * 加载并缓存 regions.json
 * @returns {Promise<Object>}
 */
export async function loadRegions() {
  if (_regionsData) return _regionsData
  const base = location.pathname.includes('/pages/') ? '../assets/regions.json' : './assets/regions.json'
  const res = await fetch(base)
  _regionsData = await res.json()
  return _regionsData
}

// ─── 智能地址解析 ─────────────────────────────────────────────────────

/**
 * 智能解析地址字符串，自动提取姓名、手机、省市区、详细地址
 * @param {string} text  - 用户粘贴的原始文本
 * @param {Object} [regions] - regions.json 数据（可选，传入以提高省市区识别率）
 * @returns {{ name, phone, province, city, district, detail, confidence }}
 *   confidence: 'high' | 'medium' | 'low'
 */
export function smartParseAddress(text, regions) {
  if (!text || !text.trim()) {
    return { name: '', phone: '', province: '', city: '', district: '', detail: '', confidence: 'low' }
  }

  let remaining = text.trim()

  // ── 1. 提取手机号 ──────────────────────────────────────────────────
  const phoneMatch = remaining.match(/1[3-9]\d{9}/)
  const phone = phoneMatch ? phoneMatch[0] : ''
  if (phone) remaining = remaining.replace(phone, ' ')

  // ── 2. 提取姓名 ────────────────────────────────────────────────────
  // 策略：找手机号前后2-5个连续中文/字母字符（中文姓名常见形式）
  let name = ''
  const namePatterns = [
    // 开头的2-5个中文字符（后接空格/逗号/手机号）
    /^[\s,，、\-]*([^\d\s,，、\-]{2,5})[\s,，、\-]+/,
    // 手机号紧前的2-5个中文字符
    new RegExp(`([^\\d\\s,，、]{2,5})[\\s,，、]*${phone || '1[3-9]\\d{9}'}`),
  ]
  for (const p of namePatterns) {
    if (!p.source || !p.source.trim()) continue
    const m = text.match(p)
    if (m && m[1] && /[\u4e00-\u9fa5]/.test(m[1])) {
      name = m[1].trim()
      break
    }
  }
  if (name) remaining = remaining.replace(name, ' ')

  // ── 3. 提取省市区 ──────────────────────────────────────────────────
  let province = '', city = '', district = ''

  if (regions && regions.provinces) {
    const provinces = regions.provinces

    // 省级匹配（支持简称：广东→广东省，北京→北京市）
    for (const prov of provinces) {
      const provName = prov.name
      const provShort = provName.replace(/省$|市$|自治区$|特别行政区$/, '')
      const provPattern = new RegExp(provName + '|' + provShort)
      if (provPattern.test(remaining)) {
        province = provName

        // 市级匹配
        for (const c of prov.cities) {
          const cityName = c.name
          const cityShort = cityName.replace(/市$|地区$|自治州$|盟$/, '')
          const cityPattern = new RegExp(cityName + '|' + cityShort)
          if (cityPattern.test(remaining)) {
            city = cityName

            // 区/县匹配
            for (const d of c.districts) {
              const distShort = d.replace(/区$|县$|市$/, '')
              const distPattern = new RegExp(d + '|' + distShort + '(?=区|县|市)')
              if (distPattern.test(remaining)) {
                district = d
                break
              }
            }
            break
          }
        }

        // 若只匹配到省，没匹配到市，尝试直辖市（省=市）
        if (!city && prov.cities.length === 1) {
          city = prov.cities[0].name
          // 继续找区
          for (const d of prov.cities[0].districts) {
            if (remaining.includes(d)) {
              district = d
              break
            }
          }
        }
        break
      }
    }
  }

  // 从 remaining 中移除省市区文本，剩余为详细地址
  let detail = remaining
  if (province) detail = detail.replace(new RegExp(province.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), ' ')
  if (city) detail = detail.replace(new RegExp(city.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), ' ')
  if (district) detail = detail.replace(new RegExp(district.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), ' ')

  // 清理 detail：去掉多余空白、标点
  detail = detail.replace(/[\s,，、\-]+/g, ' ').trim()
  // 如果 detail 里包含已提取的姓名，再次去除
  if (name) detail = detail.replace(new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), '').trim()
  detail = detail.replace(/^\s*[\s,，、\-]+/, '').replace(/[\s,，、\-]+\s*$/, '').trim()

  // ── 4. 计算置信度 ──────────────────────────────────────────────────
  const fieldsFound = [name, phone, province, city, district, detail].filter(Boolean).length
  const confidence = fieldsFound >= 5 ? 'high' : fieldsFound >= 3 ? 'medium' : 'low'

  return { name, phone, province, city, district, detail, confidence }
}

// ─── 联级省市区下拉 ──────────────────────────────────────────────────

/**
 * 初始化省市区三级联动下拉
 * @param {Object} opts
 * @param {HTMLSelectElement} opts.provinceEl  - 省下拉 DOM
 * @param {HTMLSelectElement} opts.cityEl      - 市下拉 DOM
 * @param {HTMLSelectElement} opts.districtEl  - 区/县下拉 DOM
 * @param {Object} opts.regions               - regions.json 数据
 * @param {Function} [opts.onChange]          - 变更回调 ({ province, city, district })
 * @param {Object} [opts.defaultVal]          - 默认选中值 { province, city, district }
 */
export function initCascadeSelects({ provinceEl, cityEl, districtEl, regions, onChange, defaultVal }) {
  const provinces = regions.provinces

  // 填充省份
  provinceEl.innerHTML = '<option value="">请选择省/直辖市</option>'
  for (const p of provinces) {
    const opt = document.createElement('option')
    opt.value = p.name
    opt.textContent = p.name
    provinceEl.appendChild(opt)
  }

  const fillCities = (provinceName, defaultCity) => {
    cityEl.innerHTML = '<option value="">请选择市/州</option>'
    districtEl.innerHTML = '<option value="">请选择区/县</option>'
    cityEl.disabled = true
    districtEl.disabled = true
    if (!provinceName) return
    const prov = provinces.find(p => p.name === provinceName)
    if (!prov) return
    cityEl.disabled = false
    for (const c of prov.cities) {
      const opt = document.createElement('option')
      opt.value = c.name
      opt.textContent = c.name
      cityEl.appendChild(opt)
    }
    if (defaultCity) cityEl.value = defaultCity
    if (cityEl.value) fillDistricts(provinceName, cityEl.value)
  }

  const fillDistricts = (provinceName, cityName, defaultDistrict) => {
    districtEl.innerHTML = '<option value="">请选择区/县</option>'
    districtEl.disabled = true
    if (!provinceName || !cityName) return
    const prov = provinces.find(p => p.name === provinceName)
    if (!prov) return
    const c = prov.cities.find(c => c.name === cityName)
    if (!c) return
    districtEl.disabled = false
    for (const d of c.districts) {
      const opt = document.createElement('option')
      opt.value = d
      opt.textContent = d
      districtEl.appendChild(opt)
    }
    if (defaultDistrict) districtEl.value = defaultDistrict
  }

  // 事件绑定
  provinceEl.addEventListener('change', () => {
    fillCities(provinceEl.value)
    onChange && onChange({ province: provinceEl.value, city: '', district: '' })
  })

  cityEl.addEventListener('change', () => {
    fillDistricts(provinceEl.value, cityEl.value)
    onChange && onChange({ province: provinceEl.value, city: cityEl.value, district: '' })
  })

  districtEl.addEventListener('change', () => {
    onChange && onChange({ province: provinceEl.value, city: cityEl.value, district: districtEl.value })
  })

  // 初始化禁用状态
  cityEl.disabled = true
  districtEl.disabled = true

  // 如果有默认值，按顺序填充
  if (defaultVal && defaultVal.province) {
    provinceEl.value = defaultVal.province
    fillCities(defaultVal.province, defaultVal.city)
    if (defaultVal.city) {
      fillDistricts(defaultVal.province, defaultVal.city, defaultVal.district)
    }
  }
}

/**
 * 将解析结果填入地址表单（联级下拉需已通过 initCascadeSelects 初始化）
 * @param {Object} formContext - 包含各输入框 DOM 的对象
 * @param {Object} parsed     - smartParseAddress 的返回值
 */
export function fillAddressForm(formContext, parsed) {
  const { nameEl, phoneEl, provinceEl, cityEl, districtEl, detailEl } = formContext
  if (nameEl && parsed.name) nameEl.value = parsed.name
  if (phoneEl && parsed.phone) phoneEl.value = parsed.phone
  if (detailEl && parsed.detail) detailEl.value = parsed.detail

  // 省市区联级填充（需触发 change 事件驱动联级更新）
  if (provinceEl && parsed.province) {
    provinceEl.value = parsed.province
    provinceEl.dispatchEvent(new Event('change'))

    // 等下一个事件循环再设置市（等省级 change 事件完成 DOM 填充）
    setTimeout(() => {
      if (cityEl && parsed.city) {
        cityEl.value = parsed.city
        cityEl.dispatchEvent(new Event('change'))

        setTimeout(() => {
          if (districtEl && parsed.district) {
            districtEl.value = parsed.district
            districtEl.dispatchEvent(new Event('change'))
          }
        }, 0)
      }
    }, 0)
  }
}
