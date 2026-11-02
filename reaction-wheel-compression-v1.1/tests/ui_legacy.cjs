const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const path=require('path');
const root=path.resolve(__dirname,'..');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_BINARY || undefined,args:['--no-sandbox']});
 const page=await browser.newPage({viewport:{width:1440,height:1100}});
 const errors=[];page.on('pageerror',e=>errors.push(String(e)));
 // Upload an actual host-encoded zero sample through the live HTTP endpoint.
 const {execFileSync}=require('child_process');
 const frame=execFileSync(process.env.PYTHON || 'python',['-c',"import sys;sys.path.insert(0,sys.argv[1]);from wheel_protocol import encode;sys.stdout.buffer.write(encode(bytes(64),0,0))",path.join(root,'serial-agent')]);
 const resp=await page.request.post('http://127.0.0.1:8082/api/wheel/frames',{data:frame,headers:{'Content-Type':'application/octet-stream','X-Wheel-Session':'serial-ui-'+Date.now(),'X-Wheel-Batch-Id':'ui1'}});
 if(!resp.ok())throw Error(await resp.text());
 await page.goto('http://127.0.0.1:8080/wheel');
 await page.getByText('上传组批周期（毫秒）',{exact:true}).waitFor();
 await page.getByText('未提供（预留）',{exact:true}).first().waitFor();
 const period=page.locator('input[type=number]');await period.fill('100');
 await page.getByRole('button',{name:'应用配置',exact:true}).click();
 await page.getByText('配置已保存，等待采集程序应用并上传确认；回放不确认配置。',{exact:true}).waitFor();
 const cfg=await (await page.request.get('http://127.0.0.1:8082/api/wheel/config')).json();
 if(cfg.periodMs!==100)throw Error(JSON.stringify(cfg));
 const csv=await page.request.get('http://127.0.0.1:8080/api/wheel/export.csv');
 if(!(await csv.text()).startsWith('host_sequence,host_elapsed_ms,'))throw Error('CSV semantics');
 await page.screenshot({path:path.join(root,'tests','legacy-wheel-page.png'),fullPage:true});
 if(errors.length)throw Error(errors.join('\n'));
 console.log('PASS: host label, reserved channels, live config API, CSV export, no page errors');
 await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
