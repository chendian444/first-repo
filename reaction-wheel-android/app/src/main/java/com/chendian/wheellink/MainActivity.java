package com.chendian.wheellink;

import android.app.*;
import android.content.*;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.hardware.usb.*;
import android.net.Uri;
import android.os.*;
import android.view.*;
import android.widget.*;
import com.hoho.android.usbserial.driver.*;
import java.io.*;
import java.text.SimpleDateFormat;
import java.util.*;

public final class MainActivity extends Activity {
    private static final String USB_PERMISSION="com.chendian.wheellink.USB_PERMISSION";
    private static final int EXPORT=42,INK=0xff183739,TEAL=0xff087e83,MUTED=0xff6f8585;
    private final Handler main=new Handler(Looper.getMainLooper());
    private final UsbLink link=new UsbLink();
    private final Object dataLock=new Object();
    private UsbManager usb;
    private UsbSerialDriver pendingDriver;
    private boolean permissionPending,visible,destroyed;
    private volatile boolean recording,demo;
    private int pendingCommand=-1;
    private long commandAt,lastDataAt,sessionAt,lastDrawnFrame;
    private WheelProtocol parser=new WheelProtocol();
    private float[] latest=new float[16];
    private BufferedOutputStream rawLog;
    private BufferedWriter csvLog;
    private File csvFile,rawFile,exportFile;
    private TextView state,device,metrics,values,remoteValues,commandStatus,recordStatus,logView;
    private Button connect,disconnect,openTelemetry,stop,record,exportCsv,exportRaw,demoButton;
    private TrendView chart;
    private final ArrayDeque<String> logs=new ArrayDeque<>();

    private UsbLink.Listener serialListener;
    private UsbLink.Listener newListener(final long sourceSession){return new UsbLink.Listener(){
        @Override public void onConnected(){main.post(()->{
            if(sourceSession==serialSession&&visible&&link.isConnected()){state.setText("USB已连接 · 等待遥测");log("USB已连接，230400 / 8N1");refreshButtons();}
        });}
        @Override public void onBytes(byte[] data){if(sourceSession==serialSession)consume(data);}
        @Override public void onError(String error){main.post(()->{
            if(destroyed||sourceSession!=serialSession)return;
            disconnectSession();state.setText("连接中断");commandStatus.setText("无法确认电机状态，请按原设备流程处理");log(error);
        });}
        @Override public void onWritten(WheelProtocol.Command command){main.post(()->{
            if(sourceSession!=serialSession)return;
            if(pendingCommand==command.code)commandStatus.setText("命令已写入USB，等待固件回显");
            log(command==WheelProtocol.Command.STOP_MOTORS?"已发送05停止电机命令":"已发送08开启遥测命令");
        });}
    };}
    private final BroadcastReceiver usbEvents=new BroadcastReceiver(){
        @Override public void onReceive(Context context,Intent intent){
            if(USB_PERMISSION.equals(intent.getAction())){
                boolean waiting=permissionPending;permissionPending=false;
                UsbDevice granted=intent.getParcelableExtra(UsbManager.EXTRA_DEVICE);
                UsbSerialDriver candidate=pendingDriver;pendingDriver=null;
                if(!waiting||!visible||candidate==null||granted==null||candidate.getDevice().getDeviceId()!=granted.getDeviceId())return;
                if(intent.getBooleanExtra(UsbManager.EXTRA_PERMISSION_GRANTED,false)&&usb.hasPermission(granted))startConnection(candidate);
                else{state.setText("USB授权未通过");log("请允许USB设备访问后重新连接");refreshButtons();}
            }else if(UsbManager.ACTION_USB_DEVICE_DETACHED.equals(intent.getAction())){
                UsbDevice detached=intent.getParcelableExtra(UsbManager.EXTRA_DEVICE);
                if(detached!=null&&activeDeviceId==detached.getDeviceId()){
                    disconnectSession();state.setText("USB已拔出");log("连接已断开，不能据此确认电机停止");
                }
            }
        }
    };
    private int activeDeviceId=-1;
    private volatile long serialSession;

    @Override public void onCreate(Bundle saved){
        super.onCreate(saved);usb=(UsbManager)getSystemService(USB_SERVICE);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        buildUi();
        SharedPreferences prefs=getSharedPreferences("records",MODE_PRIVATE);
        File recordsDir=new File(getFilesDir(),"records");
        String savedCsv=prefs.getString("csv","");String savedRaw=prefs.getString("raw","");
        if(!savedCsv.isEmpty()&&!savedCsv.contains("/"))csvFile=new File(recordsDir,savedCsv);
        if(!savedRaw.isEmpty()&&!savedRaw.contains("/"))rawFile=new File(recordsDir,savedRaw);
        if(csvFile!=null&&csvFile.exists())recordStatus.setText("可导出最近记录："+csvFile.getName());
        refreshButtons();
        IntentFilter filter=new IntentFilter(USB_PERMISSION);filter.addAction(UsbManager.ACTION_USB_DEVICE_DETACHED);
        if(Build.VERSION.SDK_INT>=33)registerReceiver(usbEvents,filter,Context.RECEIVER_NOT_EXPORTED);
        else registerReceiver(usbEvents,filter);
        log("首版使用旧固件与USB OTG，不修改板端程序");
    }
    @Override protected void onStart(){super.onStart();visible=true;main.post(tick);}
    @Override protected void onStop(){
        visible=false;main.removeCallbacks(tick);disconnectSession();super.onStop();
    }
    @Override protected void onDestroy(){destroyed=true;main.removeCallbacksAndMessages(null);unregisterReceiver(usbEvents);link.shutdown();super.onDestroy();}

    private int dp(float value){return Math.round(value*getResources().getDisplayMetrics().density);}
    private TextView text(String value,int size,int color){
        TextView t=new TextView(this);t.setText(value);t.setTextSize(size);t.setTextColor(color);t.setPadding(0,dp(4),0,dp(4));return t;
    }
    private GradientDrawable shape(int color){GradientDrawable d=new GradientDrawable();d.setColor(color);d.setCornerRadius(dp(18));return d;}
    private LinearLayout card(LinearLayout parent,String title){
        LinearLayout box=new LinearLayout(this);box.setOrientation(LinearLayout.VERTICAL);box.setPadding(dp(18),dp(14),dp(18),dp(14));box.setBackground(shape(Color.WHITE));
        LinearLayout.LayoutParams lp=new LinearLayout.LayoutParams(-1,-2);lp.bottomMargin=dp(14);parent.addView(box,lp);
        TextView heading=text(title,18,INK);heading.setTypeface(null,Typeface.BOLD);box.addView(heading);return box;
    }
    private Button button(LinearLayout box,String label,int color,Runnable action){
        Button b=new Button(this);b.setText(label);b.setTextColor(Color.WHITE);b.setTextSize(15);b.setAllCaps(false);b.setBackground(shape(color));b.setMinHeight(dp(48));
        LinearLayout.LayoutParams lp=new LinearLayout.LayoutParams(-1,dp(50));lp.topMargin=dp(8);box.addView(b,lp);b.setOnClickListener(v->action.run());return b;
    }
    private void buildUi(){
        ScrollView scroll=new ScrollView(this);scroll.setFillViewport(true);scroll.setBackgroundColor(0xfff3f6f5);
        LinearLayout root=new LinearLayout(this);root.setOrientation(LinearLayout.VERTICAL);root.setPadding(dp(20),dp(16),dp(20),dp(30));scroll.addView(root);setContentView(scroll);
        root.addView(text("WHEEL LINK  /  USB OTG",12,TEAL));
        TextView title=text("动量轮助手",30,INK);title.setTypeface(null,Typeface.BOLD);root.addView(title);
        root.addView(text("旧固件直连 · 实时遥测 · 串口控制",14,MUTED));
        state=text("尚未连接",16,TEAL);root.addView(state);
        LinearLayout conn=card(root,"01  设备连接");
        device=text("手机 → OTG → CH340 → AT32 Debug\nTX/RX交叉、共地，板卡独立供电。",14,MUTED);conn.addView(device);
        connect=button(conn,"选择并连接 USB 串口",TEAL,this::chooseDevice);
        disconnect=button(conn,"断开 USB",0xff587174,()->{disconnectSession();state.setText("已断开 · 未确认电机状态");log("已断开USB；断开不等于停机");});
        demoButton=button(conn,"体验演示数据（不连接硬件）",0xff587174,this::toggleDemo);
        LinearLayout control=card(root,"02  遥测与电机");
        openTelemetry=button(control,"开启遥测",TEAL,()->send(WheelProtocol.Command.OPEN_TELEMETRY));
        stop=button(control,"停止电机",0xffc24e43,()->send(WheelProtocol.Command.STOP_MOTORS));
        commandStatus=text("连接后手动开启遥测；不会自动启动电机。",13,MUTED);control.addView(commandStatus);
        control.addView(text("停止按钮发送旧固件05命令。收到回显只表示固件收到命令，不是电机停转测量或硬件急停。",12,MUTED));
        LinearLayout telemetry=card(root,"03  实时角速度");
        values=text("X  —     Y  —     Z  —",20,INK);values.setTypeface(Typeface.MONOSPACE);telemetry.addView(values);
        telemetry.addView(text("X 青绿    Y 蓝色    Z 橙色    单位 °/s",12,MUTED));
        chart=new TrendView(this);telemetry.addView(chart,new LinearLayout.LayoutParams(-1,dp(180)));
        metrics=text("有效帧 0 · 校验失败候选 0",13,MUTED);telemetry.addView(metrics);
        remoteValues=text("遥控 rc_x —   rc_y —",13,MUTED);telemetry.addView(remoteValues);
        telemetry.addView(text("旧协议仅提供角速度与遥控通道；4～14通道是预留。时间与编号由手机生成，不据此计算串口丢帧率。",12,MUTED));
        LinearLayout recordingBox=card(root,"04  数据记录");
        recordStatus=text("未记录。可保存CSV及原始串口二进制。",13,MUTED);recordingBox.addView(recordStatus);
        record=button(recordingBox,"开始记录",TEAL,this::toggleRecord);
        exportCsv=button(recordingBox,"导出最近记录 CSV",0xff587174,()->export(false));
        exportRaw=button(recordingBox,"导出最近原始记录",0xff587174,()->export(true));
        button(recordingBox,"选择历史记录导出",0xff587174,this::exportHistory);
        recordingBox.addView(text("先停止记录再导出。文件保存在App私有目录，卸载会删除；请及时导出。",12,MUTED));
        LinearLayout events=card(root,"连接日志");logView=text("",12,MUTED);events.addView(logView);
        root.addView(text("v1.0.0 · Android 8.0+\n离开App会断开USB，不代表电机已停止。原设备手柄与物理停机方式仍需保留。",12,MUTED));
        refreshButtons();
    }
    private void refreshButtons(){
        if(connect==null)return;
        boolean connected=link.isConnected();
        connect.setEnabled(!connected&&!permissionPending&&!demo);
        disconnect.setEnabled(connected||permissionPending);
        openTelemetry.setEnabled(connected&&!demo);stop.setEnabled(connected&&!demo);
        record.setEnabled(connected||demo||recording);record.setText(recording?"停止记录":"开始记录");
        demoButton.setEnabled(!connected&&!permissionPending);demoButton.setText(demo?"结束演示":"体验演示数据（不连接硬件）");
        exportCsv.setEnabled(!recording&&csvFile!=null&&csvFile.exists());
        exportRaw.setEnabled(!recording&&rawFile!=null&&rawFile.exists());
        for(Button b:new Button[]{connect,disconnect,openTelemetry,stop,record,exportCsv,exportRaw,demoButton})b.setAlpha(b.isEnabled()?1:.38f);
    }
    private void chooseDevice(){
        if(!getPackageManager().hasSystemFeature("android.hardware.usb.host")){log("手机不支持USB Host/OTG");return;}
        List<UsbSerialDriver> drivers=UsbSerialProber.getDefaultProber().findAllDrivers(usb);
        if(drivers.isEmpty()){state.setText("未找到USB串口");log("检查OTG开关、USB数据线及CH340是否插到手机");return;}
        String[] labels=new String[drivers.size()];
        for(int i=0;i<drivers.size();i++){
            UsbDevice d=drivers.get(i).getDevice();labels[i]=String.format(Locale.US,"%s  ·  %04X:%04X",drivers.get(i).getClass().getSimpleName(),d.getVendorId(),d.getProductId());
        }
        new AlertDialog.Builder(this).setTitle("选择串口设备").setItems(labels,(dialog,which)->{
            UsbSerialDriver d=drivers.get(which);pendingDriver=d;activeDeviceId=d.getDevice().getDeviceId();
            if(usb.hasPermission(d.getDevice()))startConnection(d);
            else{
                permissionPending=true;state.setText("等待USB授权");refreshButtons();
                Intent intent=new Intent(USB_PERMISSION).setPackage(getPackageName());
                PendingIntent request=PendingIntent.getBroadcast(this,activeDeviceId,intent,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
                try{usb.requestPermission(d.getDevice(),request);}catch(Exception e){permissionPending=false;log("USB授权请求失败："+e.getMessage());refreshButtons();}
            }
        }).setNegativeButton("取消",null).show();
    }
    private void resetData(){
        synchronized(dataLock){serialSession++;parser=new WheelProtocol();latest=new float[16];sessionAt=SystemClock.elapsedRealtime();lastDataAt=0;lastDrawnFrame=0;}
        chart.clear();values.setText("X  —     Y  —     Z  —");remoteValues.setText("遥控 rc_x —   rc_y —");
    }
    private void startConnection(UsbSerialDriver driver){
        pendingDriver=null;permissionPending=false;demo=false;resetData();activeDeviceId=driver.getDevice().getDeviceId();
        device.setText(String.format(Locale.US,"USB %04X:%04X · 230400 / 8N1\n板卡独立供电；不连接Debug电源脚。",driver.getDevice().getVendorId(),driver.getDevice().getProductId()));
        state.setText("正在连接USB…");connect.setEnabled(false);serialListener=newListener(serialSession);link.connect(usb,driver,serialListener);
    }
    private void disconnectSession(){
        serialSession++;permissionPending=false;pendingDriver=null;activeDeviceId=-1;pendingCommand=-1;demo=false;
        link.close();closeRecord();if(state!=null){state.setText("尚未连接");commandStatus.setText("USB已断开，无法确认电机状态");if(csvFile!=null)recordStatus.setText("记录已停止，可导出最近文件。");refreshButtons();}
    }
    private void send(WheelProtocol.Command command){
        if(!link.isConnected()||demo){log("未连接真实设备，命令未发送");return;}
        pendingCommand=command.code;commandAt=SystemClock.elapsedRealtime();
        commandStatus.setText("准备发送，等待固件回显");link.send(command,serialListener);
    }
    private void consume(byte[] bytes){
        synchronized(dataLock){
            try{
                final long dataSession=serialSession;
                if(recording&&rawLog!=null)rawLog.write(bytes);
                parser.feed(bytes,new WheelProtocol.Listener(){
                    @Override public void onFrame(byte[] raw){
                        latest=WheelProtocol.values(raw);lastDataAt=SystemClock.elapsedRealtime();
                        if(recording&&csvLog!=null)try{
                            csvLog.write(WheelProtocol.csvRow(demo?"DEMO":"USB",lastDataAt-sessionAt,parser.validFrames-1,raw));
                            if(parser.validFrames%100==0){csvLog.flush();rawLog.flush();}
                        }catch(IOException e){recordFailure(e);}
                    }
                    @Override public void onAcknowledgement(int code){main.post(()->{
                        if(dataSession!=serialSession||!link.isConnected())return;
                        if(pendingCommand==code){pendingCommand=-1;commandStatus.setText(code==5?"收到05回显 · 仍需确认实物停转":"收到08回显 · 等待有效遥测");}
                        log(String.format(Locale.US,"收到固件回显 %02X",code));
                    });}
                });
            }catch(IOException e){recordFailure(e);}
        }
    }
    private void recordFailure(Exception error){
        closeRecord();main.post(()->{recordStatus.setText("记录失败："+error.getMessage());log("记录已停止，请检查存储空间");refreshButtons();});
    }
    private void toggleDemo(){
        if(demo){disconnectSession();log("已结束演示");return;}
        disconnectSession();demo=true;resetData();state.setText("演示模式 · 非实机数据");device.setText("演示不访问USB、不发送任何硬件命令。");refreshButtons();
    }
    private final Runnable tick=new Runnable(){
        @Override public void run(){
            if(!visible||destroyed)return;
            if(demo){
                java.nio.ByteBuffer b=java.nio.ByteBuffer.allocate(64).order(java.nio.ByteOrder.LITTLE_ENDIAN);
                double t=(SystemClock.elapsedRealtime()-sessionAt)/1000.0;
                b.putFloat((float)(Math.sin(t)*12)).putFloat((float)(Math.cos(t*.7)*8)).putFloat((float)(Math.sin(t*1.4)*5));
                consume(WheelProtocol.legacyFrame(b.array()));
            }
            synchronized(dataLock){
                if(parser.validFrames>0){
                    values.setText(String.format(Locale.US,"X %s\nY %s\nZ %s",number(latest[0]),number(latest[1]),number(latest[2])));
                    remoteValues.setText("遥控 rc_x "+number(latest[14])+"   rc_y "+number(latest[15]));
                    if(lastDrawnFrame!=parser.validFrames){chart.add(latest);lastDrawnFrame=parser.validFrames;}
                }
                metrics.setText(String.format(Locale.US,"有效帧 %,d · 校验失败候选 %,d\n串口字节 %,d · 丢弃字节 %,d",parser.validFrames,parser.invalidCandidates,parser.receivedBytes,parser.discardedBytes));
                if(link.isConnected())state.setText(lastDataAt==0?"USB已连接 · 尚无有效遥测":SystemClock.elapsedRealtime()-lastDataAt>2000?"USB已连接 · 遥测暂未更新":"正在接收 · 旧固件USB遥测");
            }
            if(pendingCommand>=0&&SystemClock.elapsedRealtime()-commandAt>3000){pendingCommand=-1;commandStatus.setText("未收到命令回显，不能确认执行；请检查设备");}
            main.postDelayed(this,100);
        }
    };
    private String number(float f){return Float.isFinite(f)?String.format(Locale.US,"%8.3f",f):"     —";}
    private void toggleRecord(){
        if(recording){closeRecord();recordStatus.setText("记录已停止，可导出CSV和原始文件。");refreshButtons();return;}
        synchronized(dataLock){
            try{
                File dir=new File(getFilesDir(),"records");if(!dir.isDirectory()&&!dir.mkdirs())throw new IOException("无法创建记录目录");
                if(dir.getUsableSpace()<5*1024*1024)throw new IOException("可用存储不足5MB");
                String id=new SimpleDateFormat("yyyyMMdd-HHmmss-SSS",Locale.US).format(new Date());
                String prefix=demo?"demo-wheel-":"usb-wheel-";
                csvFile=new File(dir,prefix+id+".csv");rawFile=new File(dir,prefix+id+".legacy");
                rawLog=new BufferedOutputStream(new FileOutputStream(rawFile));
                csvLog=new BufferedWriter(new OutputStreamWriter(new FileOutputStream(csvFile),java.nio.charset.StandardCharsets.UTF_8));
                csvLog.write(WheelProtocol.csvHeader());recording=true;
                getSharedPreferences("records",MODE_PRIVATE).edit().putString("csv",csvFile.getName()).putString("raw",rawFile.getName()).apply();
                recordStatus.setText((demo?"演示":"USB")+"记录中："+csvFile.getName());
            }catch(IOException e){recordFailure(e);}
        }
        refreshButtons();
    }
    private void closeRecord(){
        synchronized(dataLock){
            recording=false;
            if(csvLog!=null)try{csvLog.close();}catch(IOException ignored){}finally{csvLog=null;}
            if(rawLog!=null)try{rawLog.close();}catch(IOException ignored){}finally{rawLog=null;}
        }
    }
    private void export(boolean raw){
        if(recording)return;
        beginExport(raw?rawFile:csvFile);
    }
    private void exportHistory(){
        if(recording){log("先停止记录再导出");return;}
        File dir=new File(getFilesDir(),"records");
        File[] files=dir.listFiles((folder,name)->name.endsWith(".csv")||name.endsWith(".legacy"));
        if(files==null||files.length==0){log("暂无历史记录");return;}
        Arrays.sort(files,(a,b)->Long.compare(b.lastModified(),a.lastModified()));
        String[] names=new String[files.length];for(int n=0;n<files.length;n++)names[n]=files[n].getName();
        new AlertDialog.Builder(this).setTitle("选择历史记录").setItems(names,(dialog,index)->beginExport(files[index])).setNegativeButton("取消",null).show();
    }
    private void beginExport(File source){
        exportFile=source;if(source==null||!source.isFile())return;
        Intent i=new Intent(Intent.ACTION_CREATE_DOCUMENT);i.addCategory(Intent.CATEGORY_OPENABLE);
        i.setType(source.getName().endsWith(".csv")?"text/csv":"application/octet-stream");
        i.putExtra(Intent.EXTRA_TITLE,source.getName());startActivityForResult(i,EXPORT);
    }
    @Override protected void onActivityResult(int request,int result,Intent data){
        super.onActivityResult(request,result,data);
        if(request!=EXPORT||result!=RESULT_OK||data==null||data.getData()==null||exportFile==null)return;
        Uri uri=data.getData();File source=exportFile;
        new Thread(()->{
            try(InputStream in=new FileInputStream(source);OutputStream out=getContentResolver().openOutputStream(uri)){
                if(out==null)throw new IOException("无法写入导出位置");byte[] bytes=new byte[8192];int n;while((n=in.read(bytes))!=-1)out.write(bytes,0,n);
                main.post(()->{if(!destroyed)log("已导出 "+source.getName());});
            }catch(Exception e){main.post(()->{if(!destroyed)log("导出失败："+e.getMessage());});}
        },"wheel-export").start();
    }
    private void log(String line){
        if(logView==null||destroyed)return;
        logs.addFirst(new SimpleDateFormat("HH:mm:ss",Locale.US).format(new Date())+"  "+line);
        while(logs.size()>12)logs.removeLast();StringBuilder s=new StringBuilder();for(String entry:logs)s.append(entry).append('\n');logView.setText(s.toString().trim());
    }
}
