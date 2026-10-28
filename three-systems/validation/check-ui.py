import json
from pathlib import Path
from playwright.sync_api import sync_playwright
out = Path(__file__).resolve().parent
required = {
 'monitor': ['发送端配置', '接收端状态', '传输链路', '传输任务队列', '关键指标'],
 'adaptive': ['发送端配置', '接收端状态', '当前推荐策略', '压缩率–总耗时分析', '传输任务队列'],
 'prediction': ['发送端配置', '接收端状态', '长短期记忆网络速率预测对比', '预测模型', '预测健康', '速率贴合度', '趋势一致率', '平均分片时延', '平均传输速率', '分片抖动', '平均网络延迟', '丢包率', '网络抖动', '平均有效吞吐率', '网络吞吐率', '重试次数', '完整性校验', '传输进度', '已处理帧/总帧']
}
results = []
software_titles = {
 'monitor': '工业网络传输状态实时感知与监测系统',
 'adaptive': '运行监测数据自适应压缩传输控制决策与优化系统',
 'prediction': '工业网络数据传输智能诊断与预测系统'
}
with sync_playwright() as p:
 browser = p.chromium.launch(executable_path='/usr/bin/chromium', headless=True, args=['--no-sandbox'])
 for width,height in [(1920,1080),(2560,1440),(1440,900)]:
  for kind,port in [('monitor',8101),('adaptive',8102),('prediction',8103)]:
   page = browser.new_page(viewport={'width':width,'height':height})
   errors = []; page.on('pageerror',lambda e: errors.append(str(e)))
   page.goto(f'http://127.0.0.1:{port}/analysis')
   page.get_by_text('发送端配置',exact=True).wait_for();page.wait_for_timeout(1500)
   assert page.title() == software_titles[kind]
   assert page.locator('.brand').inner_text() == software_titles[kind]
   for label in required[kind]:
    locator=page.get_by_text(label,exact=True) if label!='关键指标' else page.locator('.section-heading h2').filter(has_text=label)
    assert locator.count()>0,(kind,label)
   assert page.locator('.sidebar,.nav-item').count()==0,'Old sidebar remains'
   assert page.locator('.content-area').bounding_box()['x']==0
   if kind=='monitor':
    assert page.locator('.receiver-services,.receiver-queue').count()==0
    sender=page.locator('.sender-panel').bounding_box();receiver=page.locator('.receiver-panel').bounding_box()
    route=page.locator('.route-panel').bounding_box();queue=page.locator('.task-queue-panel').bounding_box()
    assert receiver['y']>=sender['y']+sender['height'] and queue['y']>=route['y']+route['height']
    assert abs(sender['x']-receiver['x'])<1 and abs(route['x']-queue['x'])<1
    details=page.locator('.sender-panel .config-list').bounding_box();actions=page.locator('.sender-panel .task-actions').bounding_box()
    assert details['y']+details['height']<=actions['y']+2,'Sender details overlap actions'
   if kind=='adaptive':
    box=page.locator('.recommendation-panel').bounding_box();assert box['height']>=460
    assert page.locator('.line-chart-shell').bounding_box()['height']>=180,'Compression chart compressed'
    table=page.locator('.recommendation-table').bounding_box()
    for row in page.locator('.recommend-row').all():
     bounds=row.bounding_box();assert bounds['y']+bounds['height']<=table['y']+table['height']+2,'Recommendation clipped'
    assert page.get_by_text('长短期记忆网络速率预测对比',exact=True).count()==0
   if kind=='prediction':
    assert page.locator('.prediction-kpis .kpi-card').count()==12
    assert page.locator('.forecast-metrics > div').count()==4
    legend=page.locator('.network-chart-legend').bounding_box();forecast=page.locator('.forecast-metrics').bounding_box()
    assert legend['y']+legend['height']<=forecast['y']+2,'Chart legend overlaps forecast metrics'
    shell=page.locator('.split-software').bounding_box();metrics=page.locator('.monitor-metrics-panel').bounding_box()
    assert abs(metrics['y']+metrics['height']-(shell['y']+shell['height']))<3,'Prediction page has unused bottom area'
    assert page.get_by_text('当前推荐策略',exact=True).count()==0
   assert not errors,errors
   panelSelector='.monitor-software .panel' if kind=='monitor' else '.split-software .panel'
   boxes=page.locator(panelSelector).evaluate_all('(ns)=>ns.map(n=>({label:n.innerText.slice(0,30),x:n.getBoundingClientRect().x,y:n.getBoundingClientRect().y,width:n.getBoundingClientRect().width,height:n.getBoundingClientRect().height}))')
   style=page.locator('body').evaluate('(n)=>({font:getComputedStyle(n).fontFamily,color:getComputedStyle(n).color,background:getComputedStyle(n).backgroundColor})')
   results.append({'software':kind,'viewport':[width,height],'requiredLabels':required[kind],'pageErrors':errors,'style':style,'panels':boxes})
   if width==1920: page.screenshot(path=str(out/f'{kind}-overview.png'),full_page=True)
   page.goto(f'http://127.0.0.1:{port}/receiver')
   page.get_by_text('接收端配置',exact=True).wait_for()
   assert page.title() == software_titles[kind]
   assert page.locator('.brand').inner_text() == software_titles[kind]
   page.close()
 browser.close()
(out/'ui-checks.json').write_text(json.dumps(results,ensure_ascii=False,indent=2))
print('Three systems: 9 viewport checks passed, no sidebar; monitoring layout, recommendation rows and 16 prediction metrics verified.')
