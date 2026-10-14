import json,time,hashlib,os
from pathlib import Path
from playwright.sync_api import sync_playwright
root=Path(__file__).resolve().parents[1]; output=root/'validation'
fixtures=root/'.cache/validation-fixtures';fixtures.mkdir(parents=True,exist_ok=True)
(fixtures/'strategy-sensors.csv').write_text('sensor,value,status\n'+''.join(f'S{i%17},{i*.13:.2f},NORMAL\n' for i in range(100000)))
(fixtures/'monitor-sensors.csv').write_text((fixtures/'strategy-sensors.csv').read_text())
(fixtures/'prediction-stream.bin').write_bytes(os.urandom(2*1024*1024))
results=[]
with sync_playwright() as p:
 browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
 for kind,port,receiver,algorithm,filename in [('monitor',8101,8301,'ZSTD','monitor-sensors.csv'),('adaptive',8102,8302,'GZIP','strategy-sensors.csv'),('prediction',8103,8303,'NONE','prediction-stream.bin')]:
  page=browser.new_page(viewport={'width':1920,'height':1200});errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
  page.goto(f'http://127.0.0.1:{port}/analysis');page.get_by_text('发送端配置',exact=True).wait_for()
  if page.get_by_role('button',name='断开连接',exact=True).count():
   page.get_by_role('button',name='断开连接',exact=True).click()
   page.get_by_role('button',name='建立连接',exact=True).wait_for()
  page.locator('.receiver-connect-form input').fill(f'127.0.0.1:{receiver}')
  page.get_by_role('button',name='建立连接',exact=True).click()
  page.get_by_role('button',name='断开连接',exact=True).wait_for(timeout=15000)
  page.locator('.package-pick-row input[type=file]').first.set_input_files(str(fixtures/filename))
  page.wait_for_function('(name)=>Array.from(document.querySelector(".task-form select")?.options || []).some(o=>o.textContent.includes(name))',arg=filename)
  page.locator('.task-form select').first.select_option(label=filename)
  page.locator('input[type=radio][value=MANUAL]').check()
  page.locator('.task-form > label').filter(has=page.locator('span',has_text='压缩算法')).locator('select').select_option(algorithm)
  page.wait_for_function('()=>!document.querySelector(".task-form select").disabled')
  existingIds = {item['id'] for item in page.request.get(f'http://127.0.0.1:{port}/api/transfer/tasks').json()['data']}
  page.locator('button.primary-action').click()
  deadline=time.time()+90
  while time.time()<deadline:
   response=page.request.get(f'http://127.0.0.1:{port}/api/transfer/tasks').json()
   tasks=response['data']
   task=next((t for t in tasks if t['fileName']==filename and t['id'] not in existingIds),None)
   if task and task['state']=='FAILED':raise RuntimeError(task)
   if task and task['state']=='COMPLETED':break
   page.wait_for_timeout(500)
  else:raise RuntimeError('Transfer did not complete')
  # The gateway marks completion after delivery; also check the receiver's restored file bytes.
  original=(fixtures/filename).read_bytes()
  response=page.request.get(f'http://127.0.0.1:{port}/api/tasks/{task["id"]}/content/file')
  assert response.ok,(response.status,response.text()[:100])
  restored=response.body();assert restored==original,'Restored payload differs from original'
  deadline=time.time()+20
  received=None
  while time.time()<deadline:
   received=next((f for f in (root/'runtime'/kind/'receiver-received').rglob(filename) if f.is_file() and f.read_bytes()==original),None)
   if received:break
   page.wait_for_timeout(500)
  assert received,'Receiver has not saved exact original payload'
  remote = page.request.get(f'http://127.0.0.1:{receiver}/api/receiver/tasks/{task["id"]}/content/file')
  assert remote.ok and remote.body()==original,'Receiver content endpoint differs from original'
  strategy=page.request.get(f'http://127.0.0.1:{port}/api/dashboard/strategy').json()['data']
  effect=page.request.get(f'http://127.0.0.1:{port}/api/dashboard/effect').json()['data']
  evaluationDeadline = time.time()+20
  while not effect['hasEvaluation'] and time.time()<evaluationDeadline:
   page.wait_for_timeout(500)
   effect=page.request.get(f'http://127.0.0.1:{port}/api/dashboard/effect').json()['data']
  assert effect['hasEvaluation'],effect
  assert strategy['networkForecast']['points'],'No actual/predicted network points'
  page.wait_for_timeout(4500)
  if kind=='prediction':
   for metric in effect['network']['metrics']:
    assert page.get_by_text(metric['label'],exact=True).count()
    assert page.get_by_text(metric['value'],exact=True).count(),metric
  elif kind=='adaptive': assert page.get_by_text('GZIP',exact=True).count()
  else:
   row=page.locator('.strategy-task-table tbody tr').filter(has_text=filename)
   row.wait_for()
   assert row.get_by_role('link',name='打开文件',exact=True).count()==1
   browse=page.request.get(f'http://127.0.0.1:{port}/api/tasks/{task["id"]}/browse')
   assert browse.ok and filename in browse.text()
   row.locator('.task-name-button').click()
   page.wait_for_timeout(1200)
   assert page.url.split('?')[0].endswith('/analysis')
   assert page.locator('.receiver-services,.receiver-queue,.sidebar').count()==0
  assert not errors,errors
  page.screenshot(path=str(output/f'{kind}-completed.png'),full_page=True)
  page.goto(f'http://127.0.0.1:{port}/transmission');page.get_by_text('传输链路',exact=True).wait_for()
  page.goto(f'http://127.0.0.1:{port}/effect');page.get_by_text('完整性校验：',exact=False).first.wait_for()
  page.goto(f'http://127.0.0.1:{receiver}/receiver');page.get_by_text(filename,exact=False).first.wait_for(timeout=15000)
  assert not errors,errors
  results.append({'software':kind,'task':task,'bytes':len(original),'sha256':hashlib.sha256(original).hexdigest(),'restoredMatches':True,'remoteReceivedMatches':True,'forecastPointCount':len(strategy['networkForecast']['points']),'forecastMetrics':strategy['networkForecast']['metrics'],'networkMetrics':effect['network']['metrics'],'pageErrors':errors})
  print(kind,'verified',len(original),'bytes',len(strategy['networkForecast']['points']),'forecast points',flush=True)
  page.close()
 browser.close()
(output/'transfer-checks.json').write_text(json.dumps(results,ensure_ascii=False,indent=2))
