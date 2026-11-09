const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const path=require('path');const {execFileSync}=require('child_process');
const root=path.resolve(__dirname,'..');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_BINARY || undefined,args:['--no-sandbox']});
 const page=await browser.newPage({viewport:{width:1440,height:1100}});const errors=[];
 page.on('pageerror',e=>errors.push(String(e)));
 await page.request.put('http://127.0.0.1:8082/api/wheel/config',{data:{mode:'AUTO',periodMs:100}});
 const frame=execFileSync(process.env.PYTHON || 'python',['-c',"import sys,struct;sys.path.insert(0,sys.argv[1]);from wheel_protocol import encode;sys.stdout.buffer.write(encode(struct.pack('<26f',*range(1,27)),0,110,period_ms=100,source=2))",path.join(root,'serial-agent')]);
 const resp=await page.request.post('http://127.0.0.1:8082/api/wheel/frames',{data:frame,headers:{'Content-Type':'application/octet-stream','X-Wheel-Session':'serial-ui-raw26-'+Date.now(),'X-Wheel-Batch-Id':'ui1'}});
 if(!resp.ok())throw Error(await resp.text());
 await page.goto('http://127.0.0.1:8080/wheel');
 await page.getByText('26通道原始遥测 → 电脑压缩 → 接收端解压',{exact:true}).waitFor();
 await page.getByText('wheel1_id',{exact:true}).waitFor();
 if(await page.getByText('未提供（预留）',{exact:true}).count())throw Error('Full channels incorrectly masked');
 const groups={gyro:'角速度（°/s）',angle:'姿态角（°）',speed:'三轮角速度（°/s，RPM=数值/6）',encoder:'编码器原始值',id:'三路 FOC Id（原标定单位）',iq:'三路 FOC Iq（原标定单位）',voltage:'电池电压（V）',remote:'遥控输入（原单位）',state:'状态与模式值'};
 for(const [key,title] of Object.entries(groups)){
  await page.locator('select').nth(1).selectOption(key);
  await page.getByRole('heading',{name:title,exact:true}).waitFor();
 }
 const csv=await (await page.request.get('http://127.0.0.1:8080/api/wheel/export.csv')).text();
 if(csv.split('\n')[0].split(',').length!==32 || !csv.includes('wheel1_id,wheel2_id,wheel3_id'))throw Error('CSV missing full fields');
 await page.locator('select').nth(1).selectOption('voltage');
 await page.screenshot({path:path.join(root,'tests','full26-wheel-page.png'),fullPage:true});
 if(errors.length)throw Error(errors.join('\n'));
 console.log('PASS: full26 labels/values, 9 selectable chart groups, device time, 32-column CSV, no page script errors');
 await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
