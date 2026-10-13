import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const [app,port,out]=process.argv.slice(2);
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
const page=await browser.newPage({viewport:{width:1440,height:1080}});
const errors=[];
page.on('pageerror',e=>errors.push(e.message));
page.on('response',r=>{if(r.status()>=400)errors.push('HTTP '+r.status()+': '+r.url());});
try{
    await page.goto(`http://127.0.0.1:${port}`,{waitUntil:'networkidle'});
    if(!(await page.locator('h1').textContent()).includes('软件'))throw Error('缺少软件标题');
    const sample={name:'sample.txt',mimeType:'text/plain',buffer:Buffer.from('sensor,temperature,state\nA,23.5,NORMAL\n'.repeat(100))};
    if(app.includes('monitor')){
        await page.locator('#reportId').fill('browser-source');
        await page.locator('#rate').fill('1234');
        await page.getByRole('button',{name:'上报此样本'}).click();
        await page.waitForFunction(()=>document.querySelector('#sources').textContent.includes('browser-source'));
    }else if(app.includes('strategy')){
        await page.locator('#sample').setInputFiles(sample);
        await page.getByRole('button',{name:'实测样本'}).click();
        await page.waitForFunction(()=>document.querySelector('#profiles').value.includes('DEFLATE'));
        await page.getByRole('button',{name:'分析并优化'}).click();
        await page.waitForFunction(()=>document.querySelector('#recommendation').textContent.includes('级别'));
    }else if(app.includes('prediction')){
        await page.getByRole('button',{name:'载入演示样本'}).click();
        await page.getByRole('button',{name:'运行预测'}).click();
        await page.waitForFunction(()=>document.querySelector('#model').textContent.includes('LSTM'));
        await page.locator('#actual').fill('1100');
        await page.getByRole('button',{name:'更新反馈校正'}).click();
        await page.waitForFunction(()=>document.querySelector('#notice').textContent.includes('对应实际值'));
    }else if(app.includes('library')){
        await page.locator('#benchmarkFile').setInputFiles(sample);
        await page.getByRole('button',{name:'比较已启用算法'}).click();
        await page.waitForFunction(()=>document.querySelector('#benchmark').textContent.includes('BROTLI'));
        await page.waitForFunction(()=>document.querySelector('#notice').textContent.includes('基准完成'));
        if(await page.locator('#comparison .bar-row').count()!==10)throw Error('算法可视化不完整');
    }else{
        await page.locator('#files').setInputFiles(sample);
        await page.locator('#name').fill('浏览器完整传输测试');
        await page.getByRole('button',{name:'提交并开始传输'}).click();
        await page.waitForFunction(()=>document.querySelector('#details').textContent.includes('逐文件校验 通过'));
        if(!(await page.locator('#jobs').textContent()).includes('恢复包'))throw Error('未提供恢复包下载');
    }
    await page.screenshot({path:out,fullPage:true});
    if(errors.length)throw Error(errors.join('\n'));
    console.log(app+' 浏览器功能检查通过');
}finally{await browser.close();}
