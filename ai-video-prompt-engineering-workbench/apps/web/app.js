const state = { run: null, history: [], activeTab: 'overview', config: null, health: null, pollTimer: null }

const $ = (id) => document.getElementById(id)
const el = (tag, className, text) => {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}
const json = (value) => JSON.stringify(value ?? {}, null, 2)
const esc = (value) => String(value ?? '')

function toast(message) {
  const node = $('toast')
  node.textContent = message
  node.classList.remove('hidden')
  clearTimeout(toast.timer)
  toast.timer = setTimeout(() => node.classList.add('hidden'), 1800)
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(payload.detail || `请求失败：${response.status}`)
  return payload
}

async function loadHealth() {
  try {
    state.health = await api('/api/health')
    $('backendVersionText').textContent = `运行引擎 ${state.health.runtime || state.health.version} · 核心版本 ${frameworkLabel(state.health.framework || '1.3-frozen')}${state.health.build_id ? ` · 构建 ${state.health.build_id}` : ''}`
    $('frameworkVersionText').textContent = frameworkLabel(state.health.framework || '1.3-frozen')
    $('backendAddressText').textContent = window.location.host
  } catch (error) {
    $('backendVersionText').textContent = '后端版本不可用'
    $('backendAddressText').textContent = window.location.host
  }
}

async function loadConfig() {
  try {
    state.config = await api('/api/config')
    const box = $('modelStatus')
    box.classList.remove('loading', 'ok', 'error')
    box.classList.add(state.config.configured ? 'ok' : 'error')
    box.querySelector('strong').textContent = state.config.configured ? '已配置' : '未配置'
    box.querySelector('small').textContent = state.config.configured ? (state.config.model || '方舟模型') : '请在下方配置火山方舟模型'

    $('arkModelInput').value = state.config.model || ''
    $('arkBaseUrlInput').value = state.config.base_url || 'https://ark.cn-beijing.volces.com/api/v3'
    $('arkTimeoutInput').value = state.config.timeout_seconds || 300
    $('arkMaxTokensInput').value = state.config.max_completion_tokens || 32768
    $('arkApiKeyInput').value = ''
    $('arkApiKeyInput').placeholder = state.config.api_key_configured ? '已保存，留空则保持不变' : '输入火山方舟接口密钥'
    $('arkKeyHint').textContent = state.config.api_key_configured
      ? `已保存密钥：${state.config.api_key_hint || '••••'}。完整密钥不会返回浏览器。`
      : '密钥仅保存在本机环境配置文件，不会回显完整值。'
  } catch (error) {
    const box = $('modelStatus')
    box.classList.add('error')
    box.querySelector('strong').textContent = '接口不可用'
    box.querySelector('small').textContent = error.message
  }
}

async function saveModelConfig() {
  const button = $('saveModelConfigBtn')
  const apiKey = $('arkApiKeyInput').value.trim()
  const model = $('arkModelInput').value.trim()
  const baseUrl = $('arkBaseUrlInput').value.trim()
  const timeoutSeconds = Number($('arkTimeoutInput').value)
  const maxCompletionTokens = Number($('arkMaxTokensInput').value)
  if (!model) return toast('请填写模型 / 接口编号')
  if (!baseUrl) return toast('请填写接口地址')
  if (!Number.isFinite(timeoutSeconds) || timeoutSeconds < 30 || timeoutSeconds > 900) return toast('读取超时必须在 30–900 秒之间')
  if (!Number.isInteger(maxCompletionTokens) || maxCompletionTokens < 4096 || maxCompletionTokens > 131072) return toast('最大生成令牌数必须在 4096–131072 之间')

  button.disabled = true
  button.textContent = '保存中…'
  try {
    state.config = await api('/api/config', {
      method: 'PUT',
      body: JSON.stringify({ api_key: apiKey, model, base_url: baseUrl, timeout_seconds: Number($('arkTimeoutInput').value), max_completion_tokens: maxCompletionTokens }),
    })
    toast('模型配置已保存到本机')
    await loadConfig()
  } catch (error) {
    toast(error.message)
  } finally {
    button.disabled = false
    button.textContent = '保存配置'
  }
}

function toggleModelConfig() {
  $('modelConfigPanel').classList.toggle('hidden')
  $('toggleModelConfigBtn').textContent = $('modelConfigPanel').classList.contains('hidden') ? '配置模型' : '收起配置'
}

async function testModel() {
  const btn = $('testModelBtn')
  btn.disabled = true
  btn.textContent = '测试中…'
  try {
    await api('/api/model/test', { method: 'POST' })
    toast('模型连接正常')
    await loadConfig()
  } catch (error) {
    toast(error.message)
  } finally {
    btn.disabled = false
    btn.textContent = '测试模型连接'
  }
}

async function loadHistory() {
  try {
    state.history = await api('/api/runs')
    renderHistory()
  } catch (error) {
    $('historyList').innerHTML = `<div class="empty-mini">${esc(error.message)}</div>`
  }
}

function renderHistory() {
  const root = $('historyList')
  root.innerHTML = ''
  if (!state.history.length) {
    root.append(el('div', 'empty-mini', '暂无运行记录'))
    return
  }
  for (const item of state.history) {
    const btn = el('button', `history-item ${state.run?.run_id === item.run_id ? 'active' : ''}`)
    const unitHint = item.current_unit ? ` · ${unitLabel(item.current_unit)}` : ''
    btn.innerHTML = `<div class="history-title">${esc(item.title || '未命名小说')}</div><div class="history-meta"><span>${esc(statusLabel(item.status) + unitHint)}</span><span>${formatDate(item.created_at)}</span></div>`
    btn.addEventListener('click', () => openRun(item.run_id))
    root.append(btn)
  }
}


function stopPolling() {
  if (state.pollTimer) clearTimeout(state.pollTimer)
  state.pollTimer = null
}

function shouldPoll(run) {
  return run && ['pending', 'running'].includes(run.status)
}

async function pollRun(runId) {
  stopPolling()
  try {
    state.run = await api(`/api/runs/${encodeURIComponent(runId)}`)
    showResult()
    renderHistory()
    if (shouldPoll(state.run)) {
      state.pollTimer = setTimeout(() => pollRun(runId), 900)
    } else {
      await loadHistory()
    }
  } catch (error) {
    toast(error.message)
  }
}

async function resumeCurrentRun() {
  if (!state.run) return
  try {
    state.run = await api(`/api/runs/${encodeURIComponent(state.run.run_id)}/resume`, { method: 'POST' })
    showResult()
    pollRun(state.run.run_id)
  } catch (error) { toast(error.message) }
}

async function retryUnit(unitId) {
  if (!state.run || !unitId) return
  try {
    state.run = await api(`/api/runs/${encodeURIComponent(state.run.run_id)}/units/${encodeURIComponent(unitId)}/retry`, { method: 'POST' })
    showResult()
    pollRun(state.run.run_id)
  } catch (error) { toast(error.message) }
}

async function openRun(runId) {
  try {
    stopPolling()
    state.run = await api(`/api/runs/${encodeURIComponent(runId)}`)
    state.activeTab = 'overview'
    showResult()
    renderHistory()
    if (shouldPoll(state.run)) pollRun(runId)
  } catch (error) {
    toast(error.message)
  }
}

function newRun() {
  stopPolling()
  state.run = null
  $('composerPanel').classList.remove('hidden')
  $('runningPanel').classList.add('hidden')
  $('resultWorkspace').classList.add('hidden')
  $('copyRunIdBtn').classList.add('hidden')
  $('runError').classList.add('hidden')
  renderHistory()
  window.scrollTo({ top: 0, behavior: 'smooth' })
}

async function createRun() {
  const source = $('sourceInput').value.trim()
  const title = $('titleInput').value.trim()
  const errorBox = $('runError')
  if (!source) {
    errorBox.textContent = '请先粘贴小说原文。'
    errorBox.classList.remove('hidden')
    return
  }
  errorBox.classList.add('hidden')
  $('composerPanel').classList.add('hidden')
  $('resultWorkspace').classList.add('hidden')
  $('runningPanel').classList.remove('hidden')
  try {
    state.run = await api('/api/runs', {
      method: 'POST',
      body: JSON.stringify({ title: title || null, source_text: source }),
    })
    state.activeTab = 'progress'
    showResult()
    await loadHistory()
    if (shouldPoll(state.run)) pollRun(state.run.run_id)
  } catch (error) {
    $('runningPanel').classList.add('hidden')
    $('composerPanel').classList.remove('hidden')
    errorBox.textContent = error.message
    errorBox.classList.remove('hidden')
  }
}

function showResult() {
  const run = state.run
  if (!run) return
  $('composerPanel').classList.add('hidden')
  $('runningPanel').classList.add('hidden')
  $('resultWorkspace').classList.remove('hidden')
  $('copyRunIdBtn').classList.remove('hidden')
  $('resultTitle').textContent = run.title || '运行结果'
  $('resultMeta').textContent = `任务编号 ${run.run_id} · ${formatDateTime(run.created_at)} · 运行引擎 ${run.runtime_version || state.health?.runtime || '2.1'} · 核心版本 ${frameworkLabel(run.framework_version || state.health?.framework || '1.3-frozen')}${run.build_id ? ` · 构建 ${run.build_id}` : ''}${run.compiler_version ? ` · 编译器 ${run.compiler_version} · ${compileStatusLabel(run.compile_status)}` : ''}`
  const badge = $('runBadge')
  badge.textContent = statusLabel(run.status)
  badge.classList.toggle('failed', ['paused', 'failed'].includes(run.status))
  badge.classList.toggle('running', ['pending', 'running'].includes(run.status))
  document.querySelectorAll('.tab').forEach((tab) => tab.classList.toggle('active', tab.dataset.tab === state.activeTab))
  renderTab()
}

function renderTab() {
  const root = $('tabContent')
  root.innerHTML = ''
  if (!state.run) return
  const renderers = {
    overview: renderOverview,
    progress: renderProgress,
    script: renderScript,
    characters: renderCharacterPrompts,
    scenes: renderScenePrompts,
    shots: renderShotPrompts,
    production: renderProduction,
    director: renderDirectorState,
    validation: renderValidation,
  }
  ;(renderers[state.activeTab] || renderOverview)(root, state.run)
}


function derivedCounts(run) {
  const a = run.artifacts || {}
  const compiled = a.compiled_project || {}
  const assetPrompts = a.asset_prompts || {}
  return {
    characters: run.counts?.characters ?? (a.story_bible?.characters?.length || 0),
    physical_scenes: run.counts?.physical_scenes ?? (a.story_bible?.scenes?.length || 0),
    beats: run.counts?.beats ?? ((a.scene_plan?.scenes || []).reduce((n, s) => n + (s.beat_list?.length || 0), 0)),
    shots: run.counts?.shots ?? ((a.storyboard_base?.scenes || []).reduce((n, s) => n + (s.shots?.length || 0), 0)),
    character_prompts: run.counts?.character_prompts ?? (compiled.character_prompts?.length || assetPrompts.character_prompts?.length || 0),
    scene_prompts: run.counts?.scene_prompts ?? (compiled.scene_prompts?.length || assetPrompts.scene_prompts?.length || 0),
    shot_prompts: run.counts?.shot_prompts ?? (compiled.shot_prompts?.length || 0),
  }
}

function renderProgress(root, run) {
  const header = el('div', 'progress-summary')
  const current = run.current_unit ? unitLabel(run.current_unit) : (run.status === 'completed' ? '全部完成' : '等待开始')
  header.innerHTML = `<div><div class="eyebrow">运行引擎 2.1</div><h3>${esc(statusLabel(run.status))}</h3><div class="card-subtitle">当前单元：${esc(current)}</div></div>`
  const actions = el('div', 'progress-actions')
  if (run.status === 'paused') {
    const resume = el('button', 'primary-btn compact', '从失败处继续')
    resume.addEventListener('click', resumeCurrentRun)
    actions.append(resume)
    if (run.error?.unit_id) {
      const retry = el('button', 'secondary-btn compact', `重试 ${unitLabel(run.error.unit_id)}`)
      retry.addEventListener('click', () => retryUnit(run.error.unit_id))
      actions.append(retry)
    }
  }
  header.append(actions)
  root.append(header)

  const stages = el('div', 'progress-stage-list')
  ;(run.stages || []).forEach((stage) => {
    const total = stage.total_units || 0
    const done = stage.completed_units || 0
    const pct = total ? Math.round(done / total * 100) : 0
    const block = el('article', 'progress-stage')
    block.innerHTML = `<div class="progress-stage-head"><strong>${esc(stageLabel(stage.name))}</strong><span>${done} / ${total} · ${esc(statusLabel(stage.status))}</span></div><div class="progress-bar"><i style="width:${pct}%"></i></div>`
    const unitList = el('div', 'unit-list')
    Object.values(run.units || {}).filter(u => u.stage === stage.name).forEach((unit) => {
      const row = el('div', `unit-row ${unit.status || ''}`)
      row.innerHTML = `<span class="unit-dot"></span><span class="unit-id">${esc(unitLabel(unit.unit_id))}</span><span class="unit-status">${esc(statusLabel(unit.status))}</span>${unit.repair_count ? `<span class="unit-repair">模型修复 ${unit.repair_count} 次</span>` : ''}${unit.reused ? `<span class="unit-reused">已复用检查点</span>` : ''}`
      if (unit.status === 'failed_recoverable') {
        const retry = el('button', 'copy-btn', '重试')
        retry.addEventListener('click', () => retryUnit(unit.unit_id))
        row.append(retry)
      }
      unitList.append(row)
    })
    block.append(unitList)
    stages.append(block)
  })
  root.append(stages)

  if (run.error) {
    const err = el('div', 'inline-error')
    const failureMeta = [
      run.error.failure_kind ? `类型：${run.error.failure_kind}` : '',
      run.error.status_code ? `HTTP：${run.error.status_code}` : '',
      run.error.provider_code ? `Ark：${run.error.provider_code}` : '',
      run.error.transport_attempts ? `传输尝试：${run.error.transport_attempts}` : '',
      run.error.repair_count !== undefined ? `Repair：${run.error.repair_count}` : '',
      run.error.contract_id ? `契约：${run.error.contract_id}` : '',
      run.error.build_id ? `构建：${run.error.build_id}` : '',
      Number.isFinite(run.error.retry_after_seconds) ? `Retry-After：${run.error.retry_after_seconds}s` : '',
      run.error.request_id ? `Request ID：${run.error.request_id}` : '',
      run.error.retryable === false
        ? ((run.error.status_code || run.error.provider_code || run.error.request_id || String(run.error.failure_kind || '').includes('provider'))
          ? '恢复：需先修复配额/配置问题'
          : (String(run.error.failure_kind || '').startsWith('compile_')
            ? '恢复：需修复生产契约/源码后重新编译'
            : '恢复：需先修复当前确定性错误'))
        : '',
    ].filter(Boolean).join(' · ')
    const providerDetail = run.error.provider_message ? `<br><span>Ark 原因：${esc(run.error.provider_message)}</span>` : ''
    err.innerHTML = `<strong>暂停原因：</strong>${esc(run.error.message)}${run.error.unit_id ? `<br><span>单元：${esc(unitLabel(run.error.unit_id))}</span>` : ''}${failureMeta ? `<br><span>${esc(failureMeta)}</span>` : ''}${providerDetail}`
    root.append(err)
  }
}

function renderOverview(root, run) {
  const counts = derivedCounts(run)
  const usage = run.token_usage || {}
  const metrics = [
    ['人物', counts.characters || 0],
    ['物理场景', counts.physical_scenes || 0],
    ['剧情节拍', counts.beats || 0],
    ['分镜', counts.shots || 0],
    ['人物提示词', counts.character_prompts || 0],
    ['场景提示词', counts.scene_prompts || 0],
    ['分镜提示词', counts.shot_prompts || 0],
    ['静态错误', (run.artifacts?.static_evaluation?.summary?.error_count ?? 0)],
    ['阻断分镜', (run.artifacts?.compiled_project?.summary?.blocked ?? 0)],
    ['告警分镜', (run.artifacts?.compiled_project?.summary?.warning ?? 0)],
  ]
  if ((usage.total_tokens || 0) > 0) {
    metrics.push(['实际 Token', usage.total_tokens || 0], ['输入 Token', usage.prompt_tokens || 0], ['输出 Token', usage.completion_tokens || 0])
  } else if ((usage.input_chars || 0) > 0) {
    metrics.push(['模型输入字符', usage.input_chars || 0])
  }
  if ((usage.repair_requests || 0) > 0) metrics.push(['Repair 请求', usage.repair_requests])
  const grid = el('div', 'metric-grid')
  metrics.forEach(([label, value]) => {
    const card = el('div', 'metric-card')
    card.innerHTML = `<div class="metric-label">${label}</div><div class="metric-value">${value}</div>`
    grid.append(card)
  })
  root.append(grid)

  const stages = el('div', 'section-block')
  stages.innerHTML = `<div class="section-heading"><h3>执行阶段</h3><span class="card-subtitle">模型生成 + v1.3 确定性链路</span></div>`
  const list = el('div', 'stage-list')
  ;(run.stages || []).forEach((stage) => {
    const row = el('div', `stage-row ${['paused','failed'].includes(stage.status) ? 'failed' : ''}`)
    const normalizationText = stage.normalization_count ? `<div class="card-subtitle">确定性纠正 ${stage.normalization_count} 项</div>` : ''
    const repairText = stage.repair_count ? `<div class="card-subtitle">模型修复 ${stage.repair_count} 次后${stage.status === 'completed' ? '通过' : '仍未通过'}</div>` : ''
    row.innerHTML = `<div class="stage-left"><span class="stage-icon">${stage.status === 'completed' ? '✓' : '!'}</span><div><div class="stage-name">${stageLabel(stage.name)}${stage.total_units ? ` · ${stage.completed_units || 0}/${stage.total_units}` : ''}</div>${normalizationText}${repairText}${stage.error ? `<div class="card-subtitle">${esc(stage.error)}</div>` : ''}</div></div><span class="stage-time">${esc(statusLabel(stage.status))}</span>`
    list.append(row)
  })
  stages.append(list)
  root.append(stages)

  if (run.error) {
    const err = el('div', 'section-block')
    err.innerHTML = `<div class="inline-error"><strong>运行失败：</strong>${esc(run.error.message)}</div>`
    root.append(err)
  }
}

function renderScript(root, run) {
  const plan = run.artifacts?.scene_plan
  if (plan) {
    const planBlock = el('div', 'section-block')
    planBlock.innerHTML = `<div class="section-heading"><h3>场景规划</h3><span class="card-subtitle">场景 / 剧情节拍结构规划</span></div>`
    planBlock.append(details('查看场景规划原始结构', plan))
    root.append(planBlock)
  }
  const scenes = run.artifacts?.script?.scenes || []
  if (!scenes.length) return root.append(empty('暂无剧本输出'))
  scenes.forEach((scene) => {
    const card = el('article', 'script-scene')
    card.innerHTML = `<div class="script-heading"><div><div class="card-title">${esc(scene.scene_heading || scene.scene_id)}</div><div class="card-subtitle">${esc(scene.scene_id)} · ${esc(scene.location_ref || '')}</div></div></div>${scene.scene_description ? `<div class="script-description">${esc(scene.scene_description)}</div>` : ''}`
    ;(scene.beats || []).forEach((beat) => {
      const beatNode = el('div', 'beat')
      beatNode.innerHTML = `<div class="beat-id">${esc(beat.beat_id)}</div><div class="beat-description">${esc(beat.description)}</div>`
      ;(beat.dialogue || []).forEach((line) => {
        const d = el('div', 'dialogue')
        d.innerHTML = `<strong>${esc(line.character_name || line.character_id)}</strong>：${esc(line.line)}`
        beatNode.append(d)
      })
      card.append(beatNode)
    })
    root.append(card)
  })
}

function renderCharacterPrompts(root, run) {
  const items = run.artifacts?.compiled_project?.character_prompts || run.artifacts?.asset_prompts?.character_prompts || []
  renderPromptCards(root, items, (item) => item.canonical_name || item.character_id, (item) => item.character_id, (item) => item.prompt_gpt_image)
}

function renderScenePrompts(root, run) {
  const items = run.artifacts?.compiled_project?.scene_prompts || run.artifacts?.asset_prompts?.scene_prompts || []
  renderPromptCards(root, items, (item) => item.scene_name || item.scene_id, (item) => item.scene_id, (item) => item.prompt_gpt_image)
}

function renderPromptCards(root, items, titleFn, subFn, promptFn) {
  if (!items.length) return root.append(empty('暂无提示词输出'))
  const list = el('div', 'card-list')
  items.forEach((item) => {
    const prompt = promptFn(item) || ''
    const card = el('article', 'content-card')
    const head = el('div', 'card-head')
    head.innerHTML = `<div><div class="card-title">${esc(titleFn(item))}</div><div class="card-subtitle">${esc(subFn(item))}</div></div>`
    head.append(copyButton(prompt))
    const body = el('div', 'card-body')
    const pre = el('pre', 'prompt-text', prompt)
    body.append(pre)
    ;(item.warnings || []).forEach((issue) => {
      const node = el('div', 'compile-issue warning')
      node.textContent = `${issueCodeLabel(issue.code)}：${issue.detail || ''}`
      body.append(node)
    })
    card.append(head, body)
    list.append(card)
  })
  root.append(list)
}

function renderShotPrompts(root, run) {
  const specs = run.artifacts?.shot_specs || []
  const promptMap = new Map((run.artifacts?.compiled_project?.shot_prompts || []).map((p) => [p.shot_id, p]))
  if (!specs.length) return root.append(empty('暂无分镜提示词'))
  const list = el('div', 'card-list')
  specs.forEach((shot) => {
    const compiled = promptMap.get(shot.shot_id) || {}
    const prompt = compiled.prompt_seedance || ''
    const card = el('article', 'content-card')
    const head = el('div', 'card-head')
    const left = el('div')
    left.innerHTML = `<div class="card-title">${esc(shot.shot_id)} <span class="compile-status ${esc(compiled.compile_status || 'ok')}">${esc(compileStatusLabel(compiled.compile_status || 'ok'))}</span></div><div class="card-subtitle">${esc(shot.scene_id)} / ${esc(shot.beat_id)}</div>`
    const chips = el('div', 'shot-meta')
    ;[
      shotSizeLabel(shot.shot_size),
      cameraLabel(shot.camera),
      movementLabel(shot.movement),
      shot.duration ? `${shot.duration} 秒` : null,
    ].filter(Boolean).forEach((v) => chips.append(el('span', 'chip', v)))
    left.append(chips)
    head.append(left, copyButton(prompt, compiled.compile_status === 'blocked'))
    const body = el('div', 'card-body')
    const issues = el('div', 'compile-issues')
    ;(compiled.errors || []).forEach((issue) => {
      const node = el('div', 'compile-issue error')
      node.append(el('div', '', `${issueCodeLabel(issue.code)}：${issue.detail || ''}`))
      if (issue.source_layer) node.append(el('div', 'card-subtitle', `来源层：${issue.source_layer_label || '上游数据'}`))
      if (issue.suggested_fix) node.append(el('div', 'card-subtitle', `建议修复：${issue.suggested_fix}`))
      issues.append(node)
    })
    ;(compiled.warnings || []).forEach((issue) => {
      const node = el('div', 'compile-issue warning')
      node.textContent = `${issueCodeLabel(issue.code)}：${issue.detail || ''}`
      issues.append(node)
    })
    if (issues.childNodes.length) body.append(issues)
    if (compiled.compile_status === 'blocked') {
      body.append(el('div', 'inline-error', '编译已阻断：当前镜头存在上游语义错误，不生成 Seedance（视频生成模型）提示词。'))
    } else {
      body.append(el('pre', 'prompt-text', prompt))
    }
    const debug = el('details', 'details')
    const debugSummary = el('summary', '', '高级调试信息')
    debug.append(debugSummary)
    if (compiled.prompt_segments?.length) debug.append(details('提示词来源分段', compiled.prompt_segments))
    if (compiled.consumption_view) debug.append(details('本镜实际取用信息', compiled.consumption_view))
    if (compiled.resolved_refs) debug.append(details('已解析资产引用', compiled.resolved_refs))
    if (debug.childNodes.length > 1) body.append(debug)
    card.append(head, body)
    list.append(card)
  })
  root.append(list)
}

function renderProduction(root, run) {
  const a = run.artifacts || {}
  const grid = el('div', 'split-grid')
  grid.append(jsonCard('故事设定', a.story_bible), jsonCard('全局视觉风格 · 已锁定', a.style_guide), jsonCard('人物视觉资产 · 已锁定', a.pvb), jsonCard('场景视觉资产 · 已锁定', a.psb))
  root.append(grid)
  const candidates = el('div', 'section-block')
  candidates.innerHTML = `<div class="section-heading"><h3>候选生产设计</h3><span class="card-subtitle">用于审计候选 → 锁定过渡</span></div>`
  candidates.append(details('人物视觉资产候选', a.pvb_candidate), details('场景视觉资产候选', a.psb_candidate), details('全局视觉风格候选', a.style_guide_candidate))
  root.append(candidates)
}

function renderDirectorState(root, run) {
  const sceneContexts = run.artifacts?.director_scene_contexts || {}
  const contextEffect = run.artifacts?.director_context_effect_audit || { shots: {}, scenes: {} }
  if (Object.keys(sceneContexts).length) {
    const contextBlock = el('div', 'section-block')
    contextBlock.innerHTML = `<div class="section-heading"><h3>Scene Director Context</h3><span class="card-subtitle">v18 场景级导演策略 · Debug only</span></div>`
    const contextList = el('div', 'card-list')
    Object.entries(sceneContexts).forEach(([sceneId, record]) => {
      const card = el('article', 'content-card')
      const head = el('div', 'card-head')
      const status = record?.scene_context_status || 'unknown'
      const effect = contextEffect.scenes?.[sceneId] || {}
      const delta = effect.execution_delta || {}
      const effectSummary = effect.shot_count != null
        ? `Phase Count: ${effect.phase_count ?? 0} · Reaction Opportunity: ${effect.reaction_opportunity_count ?? 0} · Candidate Available: ${effect.reaction_candidate_available_count ?? 0} · Reaction Visualized: ${effect.reaction_visualized_count ?? 0}`
        : 'Context Effect: pending'
      head.innerHTML = `<div><div class="card-title">${esc(sceneId)}</div><div class="card-subtitle">Scene Context: ${esc(status)}</div><div class="card-subtitle">${esc(effectSummary)}</div></div>`
      const body = el('div', 'card-body')
      if (effect.shot_count != null) {
        const deltaSummary = {
          subject: delta.primary_subject_changed || 0,
          visual_target: delta.visual_target_changed || 0,
          framing: delta.framing_changed || 0,
          shot_size: delta.shot_size_changed || 0,
          camera: delta.camera_changed || 0,
          movement: delta.movement_changed || 0,
          context_usage_empty_shots: effect.context_usage_empty_shots || [],
        }
        body.append(details('Context Effect Audit · 只读', deltaSummary))
      }
      body.append(details('场景导演策略', record?.scene_director_context || {}))
      card.append(head, body)
      contextList.append(card)
    })
    contextBlock.append(contextList)
    root.append(contextBlock)
  }

  let specs = run.artifacts?.shot_specs || []
  if (!specs.length && run.artifacts?.storyboard_partial) {
    specs = (run.artifacts.storyboard_partial.scenes || []).flatMap(scene => (scene.shots || []).filter(shot => shot.director).map(shot => ({ ...shot, context_ref: scene.context_ref, location_ref: scene.location_ref, state_in: run.units?.[`director:${shot.shot_id}`]?.state_in || {} })))
  }
  if (!specs.length) return root.append(empty('暂无导演 / 状态数据'))
  const list = el('div', 'card-list')
  specs.forEach((shot) => {
    const card = el('article', 'content-card')
    const head = el('div', 'card-head')
    const scenePosition = shot.director?.scene_position || '—'
    const usage = (shot.director?.scene_context_usage || []).join(', ') || '未使用 / Legacy'
    head.innerHTML = `<div><div class="card-title">${esc(shot.shot_id)}</div><div class="card-subtitle">${esc(shot.scene_id)} / ${esc(shot.beat_id)} · ${esc(focusTypeLabel(shot.director?.visual_focus?.focus_type))} · Scene Position: ${esc(scenePosition)}</div><div class="card-subtitle">Scene Context Usage: ${esc(usage)}</div></div>`
    const body = el('div', 'card-body')
    const intent = el('div', 'script-description', shot.director?.dramatic_intent || '—')
    body.append(intent)
    const effect = contextEffect.shots?.[shot.shot_id]
    if (effect) body.append(details('Context Effect Audit · 只读', effect))
    body.append(details('导演执行', shot.director), details('镜头开始状态', shot.state_in), details('镜头结束状态', shot.director?.state_out), details('本镜状态变化', shot.director?.action_delta))
    card.append(head, body)
    list.append(card)
  })
  root.append(list)
}

function renderValidation(root, run) {
  const validations = run.validations || {}
  const list = el('div', 'card-list')
  Object.entries(validations).forEach(([name, result]) => {
    const passed = result?.passed !== false
    const card = el('article', 'content-card')
    const head = el('div', 'card-head')
    head.innerHTML = `<div><div class="card-title">${stageLabel(name)}</div><div class="card-subtitle ${passed ? 'validation-ok' : 'validation-fail'}">${passed ? '通过' : '未通过'} · ${(result?.errors || []).length} 个错误</div></div>`
    const body = el('div', 'card-body')
    body.append(details('完整校验结果', result))
    card.append(head, body)
    list.append(card)
  })
  root.append(list)

  const logs = el('div', 'section-block')
  logs.innerHTML = `<div class="section-heading"><h3>运行元数据</h3></div>`
  logs.append(
    details('运行构建与契约', { build_id: run.build_id || state.health?.build_id || null, contracts: run.contracts || state.health?.contracts || {} }),
    details('编译警告', run.artifacts?.compiled_project?.warnings || []),
    details('基础分镜质量告警', run.quality_warnings || []),
    details('编译失败', run.artifacts?.compiled_project?.compile_failures || []),
    details('执行阶段', run.stages),
    details('恢复摘要', run.recovery || {}),
    details('失败历史', run.failure_history || []),
    details('数量统计', run.counts),
    details('Token / 模型调用统计', run.token_usage || {}),
    details('运行错误', run.error)
  )
  root.append(logs)
}

function jsonCard(title, value) {
  const card = el('article', 'content-card')
  const head = el('div', 'card-head')
  head.innerHTML = `<div class="card-title">${esc(title)}</div>`
  const body = el('div', 'card-body')
  body.append(details('查看原始结构', value))
  card.append(head, body)
  return card
}

function details(title, value) {
  const d = el('details', 'details')
  const s = el('summary', '', title)
  const p = el('pre', 'json-block', json(value))
  d.append(s, p)
  return d
}

function copyButton(text, disabled = false) {
  const btn = el('button', 'copy-btn', '复制提示词')
  btn.disabled = disabled
  btn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(text || '')
      toast('已复制')
    } catch {
      toast('复制失败')
    }
  })
  return btn
}

function empty(text) { return el('div', 'empty-mini', text) }
function compileStatusLabel(value) {
  return ({ ok: '编译正常', warning: '编译完成，有告警', blocked: '编译已阻断', partial_blocked: '部分镜头已阻断' })[value] || value || '未编译'
}
function issueCodeLabel(value) {
  return ({
    E001_ENTITY_MISBIND: 'E001_ENTITY_MISBIND（实体错绑）',
    E002_CHAR_REF_MISMATCH: 'E002_CHAR_REF_MISMATCH（人物引用不一致）',
    E003_SPATIOTEMPORAL_POLLUTION: 'E003_SPATIOTEMPORAL_POLLUTION（时空 / 跨镜污染）',
    E004_HARD_FACT_CONFLICT: 'E004_HARD_FACT_CONFLICT（硬事实冲突）',
    E005_DIALOGUE_SPEAKER_MISMATCH: 'E005_DIALOGUE_SPEAKER_MISMATCH（对白说话人不一致）',
    E006_UNRESOLVABLE_PROP_STATE: 'E006_UNRESOLVABLE_PROP_STATE（关键道具状态无法解析）',
    E007_NON_CHINESE_OUTPUT: 'E007_NON_CHINESE_OUTPUT（最终提示词存在非中文文本）',
    W001_MISSING_COLOR: 'W001_MISSING_COLOR（配色信息缺失）',
    W002_MISSING_LIGHTING: 'W002_MISSING_LIGHTING（光照信息缺失）',
    W003_DURATION_RISK: 'W003_DURATION_RISK（时长风险）',
    W004_STYLE_PSB_DRIFT: 'W004_STYLE_PSB_DRIFT（全局风格与场景视觉资产漂移）',
    W005_PROMPT_LENGTH_HIGH: 'W005_PROMPT_LENGTH_HIGH（提示词偏长）',
    W006_VISUAL_FOCUS_CONFLICT: 'W006_VISUAL_FOCUS_CONFLICT（视觉重点与景别潜在冲突）',
    W007_STYLE_HARD_FACT_DRIFT: 'W007_STYLE_HARD_FACT_DRIFT（全局风格与硬事实漂移）',
    W008_NON_CHINESE_ASSET_FIELD: 'W008_NON_CHINESE_ASSET_FIELD（资产字段存在非中文文本）',
  })[value] || value || '未分类问题'
}
function frameworkLabel(value) {
  return String(value || '').replace(/-frozen$/i, ' 冻结版')
}
function shotSizeLabel(value) {
  return ({
    extreme_wide: '大远景', wide: '全景', medium: '中景', medium_close: '中近景', close: '近景', extreme_close: '特写',
  })[value] || value || ''
}
function cameraLabel(value) {
  return ({
    eye_level: '平视机位', high_angle: '高角度俯拍', low_angle: '低角度仰拍', overhead: '顶视机位', dutch: '斜角机位', pov: '主观视角',
  })[value] || value || ''
}
function movementLabel(value) {
  return ({
    static: '固定镜头', pan: '横摇', tilt: '纵摇', dolly: '移动镜头', truck: '平移', crane: '升降', handheld: '手持镜头', zoom: '变焦', push_in: '缓慢推近', pull_out: '缓慢拉远',
  })[value] || value || ''
}
function focusTypeLabel(value) {
  return ({
    character: '人物', body_region: '身体局部', prop: '道具', spatial_relation: '空间关系', environment: '环境', reaction: '人物反应',
  })[value] || value || ''
}
function unitLabel(value) {
  if (!value) return ''
  const raw = String(value)
  const idx = raw.indexOf(':')
  if (idx < 0) return raw
  const stage = raw.slice(0, idx)
  const target = raw.slice(idx + 1)
  return `${stageLabel(stage)}：${target}`
}
function statusLabel(value) {
  return ({
    pending: '等待执行',
    running: '正在执行',
    completed: '已完成',
    paused: '已暂停',
    failed: '执行失败',
    failed_recoverable: '执行失败，可点击重试',
    passed: '已通过',
    validation_failed: '校验未通过',
    skipped: '已跳过',
    candidate: '候选',
    locked: '已锁定',
    confirmed: '已确认',
    optional_absent: '可选项缺省',
    ok: '正常',
  })[value] || (value ? `未知状态（${value}）` : '未知状态')
}
function formatDate(value) { if (!value) return ''; return new Date(value).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' }) }
function formatDateTime(value) { if (!value) return ''; return new Date(value).toLocaleString('zh-CN', { hour12: false }) }
function stageLabel(value) {
  return ({
    story_bible: '故事设定', scene_plan: '场景规划', script: '剧本', storyboard: '基础分镜', storyboard_base: '基础分镜',
    pvb: '人物视觉资产', psb: '场景视觉资产', style_guide: '全局视觉风格', production_semantics: '生产语义',
    director: '导演执行', state_shotspec: '状态解析 / ShotSpec', compile: '核心编译 / 静态校验', director_baseline_integrity: '导演基线完整性',
    pvb_candidate: '人物视觉资产候选', pvb_locked: '人物视觉资产已锁定', static_evaluation: '静态校验', consumption_evaluation: '消费层语义检查',
  })[value] || value
}

$('sourceInput').addEventListener('input', () => $('charCount').textContent = `${$('sourceInput').value.length} 字`)
$('runBtn').addEventListener('click', createRun)
$('newRunBtn').addEventListener('click', newRun)
$('toggleModelConfigBtn').addEventListener('click', toggleModelConfig)
$('saveModelConfigBtn').addEventListener('click', saveModelConfig)
$('testModelBtn').addEventListener('click', testModel)
$('refreshHistoryBtn').addEventListener('click', loadHistory)
$('copyRunIdBtn').addEventListener('click', async () => {
  if (!state.run) return
  await navigator.clipboard.writeText(state.run.run_id)
  toast('任务编号已复制')
})
document.querySelectorAll('.tab').forEach((tab) => tab.addEventListener('click', () => {
  state.activeTab = tab.dataset.tab
  document.querySelectorAll('.tab').forEach((node) => node.classList.toggle('active', node === tab))
  renderTab()
}))

const advancedDebugPanel = $('advancedDebugPanel')
const debugTabs = new Set(['production', 'director', 'validation'])
if (advancedDebugPanel) {
  advancedDebugPanel.addEventListener('toggle', () => {
    if (!advancedDebugPanel.open && debugTabs.has(state.activeTab)) {
      state.activeTab = 'overview'
      document.querySelectorAll('.tab').forEach((node) => node.classList.toggle('active', node.dataset.tab === state.activeTab))
      renderTab()
    }
  })
}

Promise.all([loadHealth(), loadConfig(), loadHistory()])
