const state = {
  dashboard: null,
  sources: [],
  algorithms: [],
  tasks: [],
  alarms: [],
  activeTaskId: null,
  pollTimer: null
};

let chartResizeTimer = null;

const $ = id => document.getElementById(id);

document.addEventListener('DOMContentLoaded', async () => {
  bindNavigation();
  bindForms();
  setInterval(() => $('clock').textContent = new Date().toLocaleTimeString(), 1000);
  await Promise.all([loadSources(), loadAlgorithms()]);
  await refreshAll(true);
  window.addEventListener('resize', () => {
    clearTimeout(chartResizeTimer);
    chartResizeTimer = setTimeout(renderChartsForActiveView, 120);
  });
});

function bindNavigation() {
  const titles = {
    monitor:['传输监控','查看发送端、链路、接收端和任务全过程'],
    strategy:['策略分析','比较预测速率、实际速率并展示压缩与传输任务策略'],
    effect:['效果展示','对比压缩前后耗时、网络状态和优化收益'],
    sources:['数据源管理','统一管理工业现场和远程监测数据源'],
    alarms:['告警中心','查看网络、任务、恢复、完整性和资源异常']
  };
  document.querySelectorAll('.nav').forEach(button => {
    button.addEventListener('click', () => {
      document.querySelectorAll('.nav').forEach(v => v.classList.remove('active'));
      document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
      button.classList.add('active');
      const name = button.dataset.view;
      $(`view-${name}`).classList.add('active');
      $('pageTitle').textContent = titles[name][0];
      $('pageSubtitle').textContent = titles[name][1];
      renderAll(false);
      requestAnimationFrame(renderChartsForActiveView);
    });
  });
}

function bindForms() {
  $('fileInput').addEventListener('change', () => { $('folderInput').value = ''; recognizeSelectedFile(); });
  $('folderInput').addEventListener('change', () => { $('fileInput').value = ''; recognizeSelectedFile(); });
  $('taskForm').addEventListener('submit', submitTask);
  $('sourceForm').addEventListener('submit', addSource);
  $('refreshAlarms').addEventListener('click', loadAlarms);
  $('alarmLevelFilter').addEventListener('change', loadAlarms);
  $('alarmStatusFilter').addEventListener('change', loadAlarms);
  $('modeInput').addEventListener('change', () => {
    const manual = $('modeInput').value === 'MANUAL';
    $('algorithmInput').disabled = !manual;
    $('levelInput').disabled = !manual;
  });
}

async function refreshAll(renderCharts = true) {
  try {
    const [dashboard, tasks] = await Promise.all([
      api('/api/dashboard'),
      api('/api/tasks')
    ]);
    state.dashboard = dashboard;
    state.tasks = tasks;
    ensureActiveTask();

    // 图表只使用共享任务历史中“当前选中任务”内部保存的静态 curve/chunks 数据。
    if (state.activeTaskId && !tasks.some(t => t.id === state.activeTaskId)) {
      state.activeTaskId = null;
      ensureActiveTask();
    }
    await loadAlarms(false);
    renderAll(renderCharts);
  } catch (error) {
    console.error(error);
  }
}

async function loadSources() {
  state.sources = await api('/api/sources');
  $('sourceSelect').innerHTML = state.sources
    .map(s => `<option value="${esc(s.id)}">${esc(s.name)} · ${esc(s.type)}</option>`)
    .join('');
  renderSources();
}

async function loadAlgorithms() {
  state.algorithms = await api('/api/algorithms');
  $('algorithmInput').innerHTML = state.algorithms
    .filter(a => a.name !== 'NONE')
    .map(a => `<option value="${a.name}">${a.name}</option>`)
    .join('');
  $('algorithmInput').value = 'ZSTD';
  $('algorithmInput').disabled = true;
  $('levelInput').disabled = true;
}

async function loadAlarms(render = true) {
  const level = encodeURIComponent($('alarmLevelFilter')?.value || '');
  const status = encodeURIComponent($('alarmStatusFilter')?.value || '');
  state.alarms = await api(`/api/alarms?level=${level}&status=${status}`);
  if (render) renderAlarms();
}

async function recognizeSelectedFile() {
  const files = selectedUploadFiles();
  if (!files.length || !$('sourceSelect').value) return;
  const data = new FormData();
  appendFiles(data, files);
  data.append('sourceId', $('sourceSelect').value);
  data.append('scene', $('sceneInput').value);
  $('recognitionBox').textContent = '正在打包并识别数据包…';
  try {
    const result = await api('/api/recognize', {method:'POST', body:data});
    const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
    $('recognitionBox').innerHTML = `
      <strong>${esc(result.modality)} · ${esc(result.format)}</strong><br>
      包内文件数：${files.length}；原始文件总量：${bytes(totalBytes)}<br>
      MIME：${esc(result.mimeType)}；置信度：${fmt(result.confidence*100,1)}%<br>
      可压缩性：${fmt(result.compressibilityScore*100,1)}%；已压缩：${result.alreadyCompressed?'是':'否'}<br>
      预处理：${esc(result.suggestedPreprocess)}<br>
      候选算法：${result.candidateAlgorithms.map(esc).join(' / ')}<br>
      策略标签：<b>${esc(result.strategyTag)}</b>`;
  } catch (error) {
    $('recognitionBox').textContent = error.message;
  }
}

async function submitTask(event) {
  event.preventDefault();
  const files = selectedUploadFiles();
  if (!files.length) return alert('请选择待压缩的文件或目录包');
  const data = new FormData();
  appendFiles(data, files);
  data.append('sourceId', $('sourceSelect').value);
  data.append('businessScene', $('sceneInput').value);
  data.append('priority', $('priorityInput').value);
  data.append('mode', $('modeInput').value);
  data.append('algorithm', $('algorithmInput').value);
  data.append('level', $('levelInput').value);

  $('startButton').disabled = true;
  $('startButton').textContent = '正在创建包压缩任务…';
  try {
    clearStaticCharts();
    const task = await api('/api/tasks', {method:'POST', body:data});
    state.activeTaskId = task.id;
    await refreshAll(false);
    renderAll(true);
    startTaskPolling(task.id);
  } catch (error) {
    alert(error.message);
  } finally {
    $('startButton').disabled = false;
    $('startButton').textContent = '开始压缩传输';
  }
}

function selectedUploadFiles() {
  const folderFiles = Array.from($('folderInput')?.files || []);
  if (folderFiles.length) return folderFiles;
  return Array.from($('fileInput')?.files || []);
}

function appendFiles(data, files) {
  files.forEach(file => data.append('files', file, file.webkitRelativePath || file.name));
}

function clearStaticCharts() {
  chartPlaceholder($('liveNetworkChart'), '包压缩任务完成后显示本次任务的静态网络状态快照');
  chartPlaceholder($('predictionChart'), '包压缩任务完成后显示静态速率对比');
  chartPlaceholder($('effectChart'), '包压缩任务完成后显示静态耗时对比');
}

async function addSource(event) {
  event.preventDefault();
  const payload = {
    id:null,
    name:$('sourceName').value,
    type:$('sourceType').value,
    endpoint:$('sourceEndpoint').value,
    deviceCode:$('sourceDevice').value,
    businessScene:$('sourceScene').value,
    online:true,
    lastReportTime:new Date().toISOString(),
    cumulativeBytes:0,
    collectionPeriodMs:1000
  };
  await api('/api/sources', {
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify(payload)
  });
  event.target.reset();
  await loadSources();
}

function renderAll(renderCharts = true) {
  renderDashboard();
  renderTasks();
  renderActiveTask();
  if (renderCharts) renderChartsForActiveView();
  renderSources();
  renderAlarms();
}

function renderChartsForActiveView() {
  const activeView = document.querySelector('.view.active')?.id;
  if (activeView === 'view-monitor') renderNetwork();
  else if (activeView === 'view-strategy') renderStrategy();
  else if (activeView === 'view-effect') renderEffect();
}

function startTaskPolling(taskId) {
  if (state.pollTimer) clearInterval(state.pollTimer);
  state.pollTimer = setInterval(async () => {
    try {
      const [dashboard, tasks] = await Promise.all([api('/api/dashboard'), api('/api/tasks')]);
      state.dashboard = dashboard;
      state.tasks = tasks;
      const task = tasks.find(t => t.id === taskId);
      const done = task && ['COMPLETED','FAILED','CACHED','WAITING_NETWORK'].includes(task.state);
      renderAll(false);
      if (done) {
        clearInterval(state.pollTimer);
        state.pollTimer = null;
        await refreshAll(true);
      }
    } catch (error) {
      console.error(error);
    }
  }, 1000);
}

function renderDashboard() {
  const d = state.dashboard;
  if (!d) return;
  const n = d.network;
  const cards = [
    ['网络质量',n.quality],
    ['有效吞吐率',`${fmt(n.throughputKbps,1)} KB/s`],
    ['RTT',`${fmt(n.rttMillis,1)} ms`],
    ['任务队列',d.queueSize],
    ['在线数据源',`${d.onlineSourceCount}/${d.sourceCount}`],
    ['未处理告警',d.openAlarmCount]
  ];
  $('dashboardCards').innerHTML = cards.map(([k,v]) =>
    `<div class="summary-card"><span>${esc(k)}</span><strong>${esc(String(v))}</strong></div>`).join('');
  $('alarmBadge').textContent = d.openAlarmCount;
  $('receiverQueue').textContent = d.queueSize;

  const connected = n.connectionState !== 'DISCONNECTED';
  $('connectionDot').style.background = connected ? '#20a66a' : '#dd4b4b';
  $('connectionText').textContent = connected ? `平台在线 · ${n.quality}` : '链路断开';
}

function renderNetwork() {
  const task = activeTask();
  const curve = task?.networkCurve || [];
  if (!isCompletedTask(task) || !curve.length) {
    chartPlaceholder($('liveNetworkChart'), '提交并完成包压缩后显示本次任务的静态网络状态快照');
    $('networkStats').innerHTML = '<div><span>状态</span><strong>等待完成任务</strong></div>';
    return;
  }

  showChartCanvas($('liveNetworkChart'));
  drawSeriesChart($('liveNetworkChart'), [
    {name:'Actual Rate', values:samplePoints(curve, p=>p.actualRateKbps), color:'#3478f6'}
  ], [], {yLabel:'Rate (KB/s)', xLabel:`Sample Point / Elapsed Time (ms), Samples: ${curve.length}`});

  const rates = curve.map(p=>p.actualRateKbps).filter(Number.isFinite);
  const errors = curve.map(p=>p.predictionErrorPercent).filter(Number.isFinite);
  const avgRate = rates.length ? rates.reduce((a,b)=>a+b,0)/rates.length : 0;
  const minRate = rates.length ? Math.min(...rates) : 0;
  const maxRate = rates.length ? Math.max(...rates) : 0;
  const avgError = errors.length ? errors.reduce((a,b)=>a+b,0)/errors.length : 0;
  const stats = [
    ['任务文件', task.fileName],
    ['平均实际速率', `${fmt(avgRate,1)} KB/s`],
    ['最低速率', `${fmt(minRate,1)} KB/s`],
    ['最高速率', `${fmt(maxRate,1)} KB/s`],
    ['预测平均误差', `${fmt(avgError,1)}%`],
    ['采样点数', curve.length]
  ];
  $('networkStats').innerHTML = stats.map(([k,v]) =>
    `<div><span>${esc(k)}</span><strong>${esc(String(v))}</strong></div>`).join('');
}

function priorityLabel(task) {
  return ({CRITICAL:'高', IMPORTANT:'中', NORMAL:'低'})[task?.priority?.priority] || task?.priority?.priority || '-';
}

function stateLabel(state) {
  return ({
    QUEUED:'排队中', PROFILING:'压缩分析中', TRANSMITTING:'传输中', VERIFYING:'校验中',
    COMPLETED:'已完成', FAILED:'失败', CACHED:'已缓存', WAITING_NETWORK:'等待网络', RETRYING:'重传中'
  })[state] || state || '-';
}

function algorithmLabel(task) {
  return String(task?.currentDecision?.algorithm || 'AUTO').toUpperCase();
}

function downloadLink(task, kind) {
  if (task.state !== 'COMPLETED') return '<span class="empty">待完成</span>';
  const compressed = kind === 'compressed';
  const endpoint = compressed ? 'compressed' : 'decompressed';
  const text = compressed ? '下载压缩文件' : '下载解压文件';
  return `<a class="task-download" href="/api/tasks/${task.id}/download/${endpoint}">${text}</a>`;
}

function renderTasks() {
  const monitorRows = state.tasks.map(task => `
    <tr class="${task.id===state.activeTaskId?'selected-row':''}">
      <td><button class="link-button" onclick="selectTask('${task.id}')">${esc(task.fileName)}</button></td>
      <td><span class="pill">${esc(priorityLabel(task))}</span></td>
      <td>${esc(stateLabel(task.state))}</td>
      <td><span class="algorithm-name">${esc(algorithmLabel(task))}</span></td>
      <td class="progress-cell"><span class="queue-progress-static"><i style="width:${Math.max(0,Math.min(100,Number(task.progressPercent)||0))}%"></i></span>${fmt(task.progressPercent,1)}%</td>
      <td>${downloadLink(task,'compressed')}</td>
      <td>${downloadLink(task,'decompressed')}</td>
    </tr>`).join('');
  $('taskTable').innerHTML = monitorRows || '<tr><td colspan="7" class="empty">暂无传输任务</td></tr>';

  if ($('strategyTaskTable')) {
    $('strategyTaskTable').innerHTML = state.tasks.map(task => `
      <tr class="${task.id===state.activeTaskId?'selected-row':''}">
        <td><button class="link-button" onclick="selectTask('${task.id}')">${esc(task.fileName)}</button></td>
        <td><span class="pill">${esc(priorityLabel(task))}</span></td>
        <td><span class="algorithm-name">${esc(algorithmLabel(task))}</span></td>
        <td class="progress-cell"><span class="queue-progress-static"><i style="width:${Math.max(0,Math.min(100,Number(task.progressPercent)||0))}%"></i></span>${fmt(task.progressPercent,1)}%</td>
        <td>${downloadLink(task,'compressed')}</td>
        <td>${downloadLink(task,'decompressed')}</td>
      </tr>`).join('') || '<tr><td colspan="6" class="empty">暂无传输任务</td></tr>';
  }
}

window.selectTask = id => {
  state.activeTaskId = id;
  localStorage.setItem('dccs.activeTaskId', id);
  renderAll(false);
  const monitorButton = document.querySelector('.nav[data-view="monitor"]');
  if (monitorButton && !monitorButton.classList.contains('active')) monitorButton.click();
  requestAnimationFrame(() => {
    renderChartsForActiveView();
    document.querySelector('.link-card')?.scrollIntoView({behavior:'smooth', block:'start'});
  });
};
window.retryTask = async id => { await api(`/api/tasks/${id}/retry`,{method:'POST'}); state.activeTaskId=id; localStorage.setItem('dccs.activeTaskId', id); await refreshAll(false); startTaskPolling(id); };
window.resolveAlarm = async id => {
  await api(`/api/alarms/${id}/resolve`, {
    method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({note:'用户在页面确认处理'})
  });
  await refreshAll(false);
};

function ensureActiveTask() {
  if (!state.tasks.length) {
    state.activeTaskId = null;
    localStorage.removeItem('dccs.activeTaskId');
    return;
  }
  const remembered = localStorage.getItem('dccs.activeTaskId');
  if (!state.activeTaskId && remembered) state.activeTaskId = remembered;
  if (state.activeTaskId && state.tasks.some(t => t.id === state.activeTaskId)) return;
  const latestCompleted = state.tasks.find(t => t.state === 'COMPLETED' && (t.networkCurve || []).length);
  const latestTask = latestCompleted || state.tasks[0];
  state.activeTaskId = latestTask ? latestTask.id : null;
  if (state.activeTaskId) localStorage.setItem('dccs.activeTaskId', state.activeTaskId);
}

function activeTask() {
  return state.tasks.find(t => t.id === state.activeTaskId) || null;
}

function samplePoints(curve, valueGetter) {
  return (curve || []).map((p, i) => ({
    x: i + 1,
    y: valueGetter(p),
    elapsedMillis: p.elapsedMillis,
    sampleIndex: i + 1
  }));
}

function nearestSampleMarker(curve, adjustment, index) {
  let sample = 1;
  let best = Number.POSITIVE_INFINITY;
  (curve || []).forEach((point, i) => {
    const distance = Math.abs((point.elapsedMillis || 0) - (adjustment.elapsedMillis || 0));
    if (distance < best) { best = distance; sample = i + 1; }
  });
  return {x: sample, label:`t${index + 1}: ${adjustment.toStrategy}`, color:'#dd4b4b'};
}

function isCompletedTask(task) {
  return task && task.state === 'COMPLETED';
}

function resetActiveTaskPanel() {
  $('activeTaskName').textContent = '暂无活动任务';
  $('taskState').textContent = '等待任务';
  $('taskProgressText').textContent = '0%';
  $('taskProgress').style.width = '0%';
  $('taskMessage').textContent = '完成参数配置后发起任务。';
  $('receiverState').textContent = '空闲';
  $('receiverStrategy').textContent = '-';
  $('receiverChunks').textContent = '0 / 0';
  $('receiverRetries').textContent = '0';
  $('receiverIntegrity').textContent = '-';
  $('taskMetrics').innerHTML = '';
  [$('flowAccess'),$('flowCompress'),$('flowTransfer'),$('flowRestore')]
    .forEach(node => node.textContent = '等待');
}

function renderActiveTask() {
  const task = activeTask();
  if (!task) {
    resetActiveTaskPanel();
    return;
  }
  $('activeTaskName').textContent = task.fileName;
  $('taskState').textContent = task.state;
  $('taskProgressText').textContent = `${fmt(task.progressPercent,1)}%`;
  $('taskProgress').style.width = `${task.progressPercent}%`;
  $('taskMessage').textContent = task.message;
  $('receiverState').textContent = task.state;
  $('receiverStrategy').textContent = task.currentDecision
    ? `${task.currentDecision.algorithm}-${task.currentDecision.level}` : '-';
  $('receiverChunks').textContent = `${task.completedChunks} / ${task.totalChunks}`;
  $('receiverRetries').textContent = task.retryCount;
  $('receiverIntegrity').textContent = task.integrityPassed ? '通过' : '待确认';

  const flow = {
    QUEUED:['排队','等待','等待','等待'],
    PROFILING:['完成','画像','等待','等待'],
    TRANSMITTING:['完成','完成','发送中','等待'],
    VERIFYING:['完成','完成','完成','校验中'],
    COMPLETED:['完成','完成','完成','完成'],
    FAILED:['完成','异常','失败','异常'],
    CACHED:['完成','完成','缓存','等待'],
    WAITING_NETWORK:['完成','完成','等待链路','等待'],
    RETRYING:['完成','完成','补传','等待']
  }[task.state] || ['等待','等待','等待','等待'];
  [$('flowAccess'),$('flowCompress'),$('flowTransfer'),$('flowRestore')]
    .forEach((node,i)=>node.textContent=flow[i]);

  const metrics = [
    ['原始大小',bytes(task.originalBytes)],
    ['压缩后',bytes(task.compressedBytes)],
    ['压缩耗时',`${fmt(task.totalCompressionMillis,1)} ms`],
    ['传输耗时',`${fmt(task.totalTransferMillis,1)} ms`],
    ['解压耗时',`${fmt(task.totalDecompressionMillis,1)} ms`],
    ['压缩文件', task.state === 'COMPLETED' ? `<a href="/api/tasks/${task.id}/download/compressed">下载</a>` : '-'],
    ['解压文件', task.state === 'COMPLETED' ? `<a href="/api/tasks/${task.id}/download/decompressed">下载</a>` : '-']
  ];
  $('taskMetrics').innerHTML = metrics.map(([k,v]) =>
    `<div><span>${k}</span><strong>${v}</strong></div>`).join('');
}

function renderStrategy() {
  const task = activeTask();
  if (!isCompletedTask(task)) {
    chartPlaceholder($('predictionChart'), '提交并完成数据包任务后显示静态速率对比');
    $('recommendation').innerHTML = '<span class="empty">等待已完成任务</span>';
    $('feedbackMetrics').innerHTML = '<div><span>状态</span><strong>等待完成任务</strong></div>';
    $('chunkTable').innerHTML = '';
    return;
  }

  const curve = task.networkCurve || [];
  if (!curve.length) {
    chartPlaceholder($('predictionChart'), '当前已完成任务没有网络速率曲线数据');
  } else {
    showChartCanvas($('predictionChart'));
    drawSeriesChart($('predictionChart'), [
      {name:'实际速率',values:samplePoints(curve, p=>p.actualRateKbps),color:'#3478f6'},
      {name:'预测速率',values:samplePoints(curve, p=>p.predictedRateKbps),color:'#18a7a0'}
    ], [], {yLabel:'速率（KB/s）', xLabel:`采样点 / 运行时间（ms），共 ${curve.length} 个采样点`});
  }

  const d = task.currentDecision;
  $('recommendation').innerHTML = d ? `
    <strong class="algorithm-name">${esc(String(d.algorithm || 'AUTO').toUpperCase())}</strong>
    <p>当前压缩级别：${esc(d.level)}</p>
    <p>预处理：${esc(d.preprocess)}</p>
    <p>分块：${bytes(d.chunkSizeBytes)}；发送顺序：${esc(d.sendOrder)}</p>
    <p>预计压缩比：${fmt(d.estimatedCompressedRatio*100,1)}%</p>
    <p>${esc(d.reason)}</p>` : '等待策略推荐';

  const actualValues = curve.map(p => p.actualRateKbps).filter(Number.isFinite);
  const predictedValues = curve.map(p => p.predictedRateKbps).filter(Number.isFinite);
  const percentErrors = curve.map(p => p.predictionErrorPercent).filter(Number.isFinite);
  const absoluteErrors = curve.map(p => Math.abs(Number(p.predictedRateKbps)-Number(p.actualRateKbps))).filter(Number.isFinite);
  const avg = values => values.length ? values.reduce((a,b)=>a+b,0) / values.length : 0;
  $('feedbackMetrics').innerHTML = curve.length ? `
    <div><span>预测模型</span><strong>长短期记忆网络</strong></div>
    <div><span>采样点数</span><strong>${curve.length}</strong></div>
    <div><span>MAE（平均绝对误差）</span><strong>${fmt(avg(absoluteErrors),2)} KB/s</strong></div>
    <div><span>MAPE（平均绝对百分比误差）</span><strong>${fmt(avg(percentErrors),2)}%</strong></div>` : '<div><span>状态</span><strong>暂无预测反馈</strong></div>';

  $('chunkTable').innerHTML = (task.chunks||[]).map(c=>`
    <tr><td>${c.chunkIndex}</td><td>${c.elapsedMillis} ms</td>
    <td>${fmt(c.actualRateKbps,1)}</td><td>${fmt(c.predictedRateKbps,1)}</td>
    <td><span class="algorithm-name">${esc(String(c.algorithm||'AUTO').toUpperCase())}</span> / ${c.level}</td><td>${bytes(c.originalBytes)}</td>
    <td>${bytes(c.compressedBytes)}</td><td>${fmt(c.compressionMillis,2)}</td>
    <td>${fmt(c.modeledTransferMillis,2)}</td><td>${fmt(c.decompressionMillis,2)}</td>
    <td>${c.checksumPassed?'通过':'失败'}</td></tr>`).join('');
}
function renderEffect() {
  const task = activeTask();
  if (!isCompletedTask(task) || !(task.networkCurve||[]).length) {
    chartPlaceholder($('effectChart'), '提交并完成包压缩后显示静态耗时对比');
    $('networkConclusion').innerHTML = '<strong>等待完成任务</strong><p>完成一次压缩传输后，这里展示任务期间链路评价。</p>';
    $('effectConclusion').innerHTML = '<strong>等待完成任务</strong><p>完成一次压缩传输后，这里展示压缩收益和完整性结论。</p>';
    $('effectMetrics').innerHTML = '';
    return;
  }
  const avgRate = task.networkCurve.reduce((s,p)=>s+p.actualRateKbps,0)/task.networkCurve.length;
  const rawTransfer = task.originalBytes/1024/Math.max(1,avgRate)*1000;
  const optimized = task.totalCompressionMillis + task.totalTransferMillis + task.totalDecompressionMillis;
  const saved = rawTransfer - optimized;
  const improvement = saved/rawTransfer*100;

  showChartCanvas($('effectChart'));
  drawBarChart($('effectChart'), [
    ['Direct Transfer',rawTransfer,'#94a3b8'],
    ['Compression',task.totalCompressionMillis,'#ed8b2f'],
    ['Network Transfer',task.totalTransferMillis,'#3478f6'],
    ['Decompression',task.totalDecompressionMillis,'#18a7a0'],
    ['Optimized Total',optimized,'#20a66a']
  ]);

  const errors = task.networkCurve.map(p=>p.predictionErrorPercent);
  const avgError = errors.reduce((a,b)=>a+b,0)/errors.length;
  $('networkConclusion').innerHTML = `
    <strong>${avgError<15?'网络预测与实际较为一致':'网络波动或预测偏差较高'}</strong>
    <p>任务期间平均实际速率 ${fmt(avgRate,1)} KB/s，平均预测误差 ${fmt(avgError,1)}%，
    共发生 ${task.retryCount} 次重传。</p>`;

  $('effectConclusion').innerHTML = `
    <strong>${saved>0?'动态压缩取得正收益':'本次压缩未取得时间收益'}</strong>
    <p>相对不压缩估算${saved>0?'节约':'增加'} ${fmt(Math.abs(saved),1)} ms，
    传输效率变化 ${fmt(improvement,1)}%。完整性校验${task.integrityPassed?'通过':'失败'}。</p>`;

  const ratio = task.compressedBytes/task.originalBytes*100;
  const cards = [
    ['原始数据',bytes(task.originalBytes)],['压缩后',bytes(task.compressedBytes)],
    ['整体压缩率',`${fmt(ratio,1)}%`],['压缩耗时',`${fmt(task.totalCompressionMillis,1)} ms`],
    ['传输耗时',`${fmt(task.totalTransferMillis,1)} ms`],['解压耗时',`${fmt(task.totalDecompressionMillis,1)} ms`]
  ];
  $('effectMetrics').innerHTML = cards.map(([k,v])=>
    `<div class="summary-card"><span>${k}</span><strong>${v}</strong></div>`).join('');
}

function renderSources() {
  if (!$('sourceTable')) return;
  $('sourceTable').innerHTML = state.sources.map(s=>`
    <tr><td>${esc(s.name)}</td><td>${esc(s.type)}</td><td>${esc(s.deviceCode||'-')}</td>
    <td>${esc(s.businessScene||'-')}</td><td>${esc(s.endpoint||'-')}</td>
    <td>${s.online?'在线':'离线'}</td><td>${bytes(s.cumulativeBytes)}</td>
    <td>${s.lastReportTime?new Date(s.lastReportTime).toLocaleString():'-'}</td></tr>`).join('');
}

function renderAlarms() {
  if (!$('alarmList')) return;
  $('alarmList').innerHTML = state.alarms.length ? state.alarms.map(a=>`
    <div class="alarm-item">
      <div class="alarm-level">${esc(a.level)}<br><span class="pill">${esc(a.status)}</span></div>
      <div><strong>${esc(a.type)} · ${esc(a.source)}</strong>
        <p>${esc(a.description)}</p><small>建议：${esc(a.suggestion)}</small></div>
      <div>${new Date(a.occurredAt).toLocaleString()}<br>
        ${a.status==='OPEN'?`<button class="secondary" onclick="resolveAlarm('${a.id}')">确认处理</button>`:''}
      </div>
    </div>`).join('') : '<div class="empty">当前筛选条件下没有告警</div>';
}

function chartPlaceholder(canvas, message) {
  if (!canvas) return;
  canvas.style.display = 'none';
  const parent = canvas.parentElement;
  let box = parent.querySelector(`.chart-placeholder[data-chart="${canvas.id}"]`);
  if (!box) {
    box = document.createElement('div');
    box.className = 'chart-placeholder';
    box.dataset.chart = canvas.id;
    parent.insertBefore(box, canvas);
  }
  box.innerHTML = `<div><strong>暂无静态图表</strong>${esc(message)}</div>`;
  const ctx = canvas.getContext('2d');
  if (ctx) ctx.clearRect(0, 0, canvas.width || 1, canvas.height || 1);
}

function showChartCanvas(canvas) {
  if (!canvas) return;
  const parent = canvas.parentElement;
  const box = parent.querySelector(`.chart-placeholder[data-chart="${canvas.id}"]`);
  if (box) box.remove();
  canvas.style.display = 'block';
}

function drawSeriesChart(canvas, series, markers = [], labels = {}) {
  const frame = canvasFrame(canvas);
  if (!frame) return;
  const {ctx,width,height} = frame;
  const all = series.flatMap(s=>s.values).filter(p=>Number.isFinite(p.x)&&Number.isFinite(p.y));
  if (!all.length) { drawEmptyChart(canvas, '暂无图表数据'); return; }
  const yLabel = typeof labels === 'object' ? (labels.yLabel || '') : (labels || '');
  const xLabel = typeof labels === 'object' ? (labels.xLabel || '') : '';

  let minX=Math.min(...all.map(p=>p.x)), maxX=Math.max(...all.map(p=>p.x));
  let minY=Math.min(...all.map(p=>p.y)), maxY=Math.max(...all.map(p=>p.y));
  if (maxX===minX) { minX=minX-.5; maxX=maxX+.5; }
  if (maxY===minY) {
    const pad=Math.max(0.5, Math.abs(maxY)*0.0002);
    minY=Math.max(0, minY-pad);
    maxY=maxY+pad;
  } else {
    const pad=Math.max(0.2,(maxY-minY)*.12);
    minY=Math.max(0,minY-pad);
    maxY+=pad;
  }

  const m={l:78,r:26,t:28,b:72}, cw=width-m.l-m.r, ch=height-m.t-m.b;
  const x=v=>m.l+(v-minX)/(maxX-minX)*cw;
  const y=v=>m.t+(1-(v-minY)/Math.max(1e-9,maxY-minY))*ch;

  const yTicks = linearTicks(minY, maxY, 6);
  const yLabels = uniqueTickLabels(yTicks);
  ctx.font='12px Arial';
  ctx.textAlign='left';
  ctx.fillStyle='#6d778b';
  ctx.strokeStyle='#e3e8f0';
  for(let i=0;i<yTicks.length;i++){
    const yy=y(yTicks[i]);
    ctx.beginPath();ctx.moveTo(m.l,yy);ctx.lineTo(width-m.r,yy);ctx.stroke();
    ctx.fillText(yLabels[i],8,yy+4);
  }

  drawSampleXAxis(ctx, all, x, minX, maxX, m, width, height);
  ctx.textAlign='left';
  ctx.fillStyle='#6d778b';
  ctx.fillText(yLabel,8,16);
  ctx.textAlign='center';
  ctx.fillText(xLabel,width/2,height-8);
  ctx.textAlign='left';

  series.forEach(s=>{ctx.strokeStyle=s.color;ctx.lineWidth=2;ctx.beginPath();
    s.values.forEach((p,i)=>{const xx=x(p.x),yy=y(p.y);i?ctx.lineTo(xx,yy):ctx.moveTo(xx,yy)});ctx.stroke();
    ctx.fillStyle=s.color;
    s.values.forEach(p=>{const xx=x(p.x),yy=y(p.y);ctx.beginPath();ctx.arc(xx,yy,3,0,Math.PI*2);ctx.fill()});
  });
  markers.forEach(marker=>{const xx=x(marker.x);ctx.save();ctx.strokeStyle=marker.color;ctx.setLineDash([5,5]);
    ctx.beginPath();ctx.moveTo(xx,m.t);ctx.lineTo(xx,height-m.b);ctx.stroke();ctx.restore();
    ctx.fillStyle=marker.color;ctx.fillText(marker.label,Math.min(xx+4,width-145),m.t+13)});
}

function drawBarChart(canvas, items) {
  const frame = canvasFrame(canvas);
  if (!frame) return;
  const {ctx,width,height}=frame, m={l:78,r:25,t:25,b:70};
  const max=Math.max(...items.map(i=>i[1]),1), cw=width-m.l-m.r, ch=height-m.t-m.b;
  ctx.strokeStyle='#e3e8f0';ctx.fillStyle='#6d778b';ctx.font='12px Arial';
  const ticks = linearTicks(0, max, 6);
  const labels = uniqueTickLabels(ticks);
  for(let i=0;i<ticks.length;i++){const yy=m.t+(1-ticks[i]/max)*ch;ctx.beginPath();ctx.moveTo(m.l,yy);ctx.lineTo(width-m.r,yy);ctx.stroke();
    ctx.fillText(labels[i],8,yy+4)}
  const slot=cw/items.length;
  items.forEach((item,i)=>{const h=item[1]/max*ch,x=m.l+i*slot+slot*.18,y=m.t+ch-h;
    ctx.fillStyle=item[2];ctx.fillRect(x,y,slot*.64,h);ctx.fillStyle='#172033';
    ctx.save();ctx.translate(x+slot*.32,height-m.b+15);ctx.rotate(-.25);ctx.fillText(item[0],-30,0);ctx.restore()});
}

function canvasFrame(canvas) {
  if (!canvas) return null;
  const ratio=window.devicePixelRatio||1;
  const parentWidth = canvas.parentElement?.getBoundingClientRect().width || 0;
  const cssWidth=Math.max(320,Math.round(parentWidth || canvas.getBoundingClientRect().width || 600));
  const height=Number(canvas.getAttribute('height')||300);
  canvas.style.width='100%';
  canvas.style.maxWidth='100%';
  canvas.style.height=`${height}px`;
  const targetWidth=Math.max(1,Math.round(cssWidth*ratio));
  const targetHeight=Math.max(1,Math.round(height*ratio));
  if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
    canvas.width=targetWidth;
    canvas.height=targetHeight;
  }
  const ctx=canvas.getContext('2d');
  ctx.setTransform(ratio,0,0,ratio,0,0);
  ctx.clearRect(0,0,cssWidth,height);
  return {ctx,width:cssWidth,height};
}

function drawSampleXAxis(ctx, all, x, minX, maxX, m, width, height) {
  const sampleMap = new Map();
  all.forEach(p => {
    if (!sampleMap.has(p.x)) sampleMap.set(p.x, p);
  });
  const keys = Array.from(sampleMap.keys()).sort((a,b)=>a-b);
  const tickCount = Math.min(6, Math.max(1, keys.length));
  const ticks = [];
  for (let i=0;i<tickCount;i++) {
    const keyIndex = Math.round((keys.length - 1) * i / Math.max(1, tickCount - 1));
    const tick = keys[keyIndex];
    if (!ticks.includes(tick)) ticks.push(tick);
  }
  ctx.save();
  ctx.strokeStyle='#e3e8f0';
  ctx.fillStyle='#6d778b';
  ctx.font='11px Arial';
  ctx.textAlign='center';
  ticks.forEach(tick => {
    const p = sampleMap.get(tick) || {elapsedMillis:null};
    const xx = x(tick);
    ctx.beginPath();ctx.moveTo(xx,m.t);ctx.lineTo(xx,height-m.b);ctx.stroke();
    ctx.fillText(`S${Math.round(tick)}`, xx, height-m.b+18);
    ctx.fillText(formatElapsed(p.elapsedMillis), xx, height-m.b+34);
  });
  ctx.restore();
}

function linearTicks(min, max, count) {
  if (!Number.isFinite(min) || !Number.isFinite(max) || count < 2) return [0, 1];
  if (max === min) max = min + 1;
  return Array.from({length:count}, (_,i)=>min+(max-min)*i/(count-1)).reverse();
}

function uniqueTickLabels(values) {
  const range = Math.abs((values[0] || 0) - (values[values.length - 1] || 0));
  let startDecimals = range >= 50 ? 0 : range >= 5 ? 1 : range >= .5 ? 2 : range >= .05 ? 3 : 4;
  for (let decimals=startDecimals; decimals<=4; decimals++) {
    const labels = values.map(v => Number(v).toFixed(decimals));
    if (new Set(labels).size === labels.length) return labels;
  }
  return values.map(v => Number(v).toPrecision(5));
}

function formatElapsed(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '-';
  if (Math.abs(n) >= 1000) return `${(n/1000).toFixed(n >= 10000 ? 0 : 1)}s`;
  return `${Math.round(n)}ms`;
}

function drawEmptyChart(canvas, message) {
  const frame = canvasFrame(canvas);
  if (!frame) return;
  const {ctx,width,height}=frame;
  ctx.fillStyle='#8b95a7';
  ctx.font='14px Arial';
  ctx.textAlign='center';
  ctx.fillText(message, width/2, height/2);
  ctx.textAlign='left';
}

async function api(url, options={}) {
  const response=await fetch(url,options);
  const data=await response.json().catch(()=>null);
  if(!response.ok) throw new Error(data?.message||`HTTP ${response.status}`);
  return data;
}
function fmt(v,d=2){const n=Number(v);return Number.isFinite(n)?n.toFixed(d):'-'}
function bytes(v){let n=Math.abs(Number(v));if(!Number.isFinite(n))return'-';const u=['B','KB','MB','GB'];let i=0;
  while(n>=1024&&i<u.length-1){n/=1024;i++}return`${n.toFixed(i?2:0)} ${u[i]}`}
function esc(v){return String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')
  .replaceAll('"','&quot;').replaceAll("'",'&#039;')}
