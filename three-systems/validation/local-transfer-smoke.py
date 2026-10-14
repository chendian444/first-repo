import json,time
from urllib.request import Request,urlopen
out=[]
for kind,port in [('monitor',8101),('adaptive',8102),('prediction',8103)]:
 def call(path,data=None,method=None):
  r=Request(f'http://127.0.0.1:{port}/api/{path}',data=None if data is None else json.dumps(data).encode(),method=method,headers={'Content-Type':'application/json'})
  with urlopen(r,timeout=15) as response:
   j=json.load(response);assert j['code']==0,j;return j['data']
 deadline=time.time()+30
 while True:
  try: options=call('transfer/options');break
  except Exception:
   if time.time()>deadline:raise
   time.sleep(.5)
 call('receiver/disconnect',{},'POST')
 assert not call('dashboard/transmission')['receiver']['remoteConnected']
 config=options['currentConfig'];config={k:config[k] for k in ['fileId','mode','algorithmId','level','priority']};config.update(fileId='monitoring-data.csv',mode='AUTO')
 call('transfer/config',config,'PUT')
 old={t['id'] for t in call('transfer/tasks')}
 start=call('transfer/start',{},'POST');assert start['success'],start
 deadline=time.time()+60
 while time.time()<deadline:
  task=next((t for t in call('transfer/tasks') if t['id'] not in old),None)
  if task and task['state']=='FAILED':raise RuntimeError(task)
  effect=call('dashboard/effect')
  if task and task['state']=='COMPLETED' and effect['hasEvaluation']:break
  time.sleep(.5)
 else:raise RuntimeError('Local-only transfer/evaluation failed')
 assert task['integrityPassed']
 out.append({'software':kind,'taskId':task['id'],'remoteConnected':False,'mode':'AUTO','algorithm':task['currentDecision']['algorithm'],'integrityPassed':True,'hasEvaluation':True})
 print(kind,'local AUTO transfer passed',flush=True)
from pathlib import Path
(Path(__file__).resolve().parent/'local-transfer-checks.json').write_text(json.dumps(out,indent=2))
