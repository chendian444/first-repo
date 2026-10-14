import json
from pathlib import Path
from playwright.sync_api import sync_playwright
out=Path(__file__).resolve().parent
with sync_playwright() as p:
 browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
 results=[]
 for kind,port in [('adaptive',8102),('prediction',8103)]:
  page=browser.new_page(viewport={'width':1920,'height':1200})
  errors=[]; page.on('pageerror',lambda e:errors.append(str(e)))
  page.goto(f'http://127.0.0.1:{port}/analysis');page.get_by_text('发送端配置',exact=True).wait_for();page.wait_for_timeout(1800)
  required=['发送端配置','接收端状态','当前推荐策略','压缩率–总耗时分析'] if kind=='adaptive' else ['发送端配置','接收端状态','长短期记忆网络速率预测对比','预测模型','预测健康','速率贴合度','趋势一致率','平均分片时延','平均传输速率','分片抖动']
  for label in required: assert page.get_by_text(label,exact=True).count()>0,label
  if kind=='adaptive': assert page.get_by_text('长短期记忆网络速率预测对比',exact=True).count()==0
  else: assert page.get_by_text('当前推荐策略',exact=True).count()==0
  assert not errors,errors
  boxes=page.locator('.split-software .panel').evaluate_all('(nodes)=>nodes.map(n=>({text:n.innerText.slice(0,32),x:n.getBoundingClientRect().x,y:n.getBoundingClientRect().y,w:n.getBoundingClientRect().width,h:n.getBoundingClientRect().height}))')
  style=page.locator('body').evaluate('(n)=>({font:getComputedStyle(n).fontFamily,color:getComputedStyle(n).color,background:getComputedStyle(n).backgroundColor})')
  page.screenshot(path=str(out/f'{kind}-overview.png'),full_page=True)
  results.append({'software':kind,'requiredLabels':required,'pageErrors':errors,'style':style,'panels':boxes})
  page.close()
 browser.close()
(out/'ui-checks.json').write_text(json.dumps(results,ensure_ascii=False,indent=2))
print(json.dumps(results,ensure_ascii=False,indent=2))
