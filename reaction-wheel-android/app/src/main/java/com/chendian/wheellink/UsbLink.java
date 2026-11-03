package com.chendian.wheellink;

import android.hardware.usb.UsbDeviceConnection;
import android.hardware.usb.UsbManager;
import com.hoho.android.usbserial.driver.UsbSerialDriver;
import com.hoho.android.usbserial.driver.UsbSerialPort;
import com.hoho.android.usbserial.util.SerialInputOutputManager;
import java.io.IOException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** No automatic motor command on connect, detach or reconnect. */
public final class UsbLink {
    public interface Listener {
        void onConnected();
        void onBytes(byte[] bytes);
        void onError(String message);
        void onWritten(WheelProtocol.Command command);
    }
    private final ExecutorService worker=Executors.newSingleThreadExecutor();
    private volatile int generation;
    private volatile UsbSerialPort port;
    private SerialInputOutputManager io;
    private volatile boolean connected;
    public boolean isConnected(){return connected;}

    public void connect(UsbManager manager,UsbSerialDriver driver,Listener listener) {
        close();final int token=generation;
        worker.execute(()->{
            UsbSerialPort opened=null;
            UsbDeviceConnection connection=null;
            try {
                connection=manager.openDevice(driver.getDevice());
                if(connection==null)throw new IOException("USB访问未授权或设备已移除");
                opened=driver.getPorts().get(0);
                opened.open(connection);
                opened.setParameters(230400,8,UsbSerialPort.STOPBITS_1,UsbSerialPort.PARITY_NONE);
                opened.setFlowControl(UsbSerialPort.FlowControl.NONE);
                final UsbSerialPort ready=opened;
                SerialInputOutputManager reader=new SerialInputOutputManager(ready,new SerialInputOutputManager.Listener(){
                    @Override public void onNewData(byte[] data){if(token==generation)listener.onBytes(data);}
                    @Override public void onRunError(Exception error){
                        if(token==generation){close();listener.onError("USB读取中断："+error.getMessage());}
                    }
                });
                reader.setReadTimeout(200);reader.setWriteTimeout(1000);
                synchronized(this){
                    if(token!=generation){opened.close();return;}
                    port=opened;io=reader;connected=true;reader.start();
                }
                listener.onConnected();
            }catch(Exception error){
                if(opened!=null)try{opened.close();}catch(Exception ignored){}
                else if(connection!=null)connection.close();
                if(token==generation){close();listener.onError("连接失败："+error.getMessage());}
            }
        });
    }
    public void send(WheelProtocol.Command command,Listener listener){
        final int token=generation;
        worker.execute(()->{
            UsbSerialPort p=port;
            if(token!=generation || !connected || p==null){listener.onError("USB未连接，命令未发送");return;}
            try{p.write(command.bytes(),1000);if(token==generation)listener.onWritten(command);}
            catch(Exception error){if(token==generation){close();listener.onError("命令发送失败："+error.getMessage());}}
        });
    }
    public synchronized void close(){
        generation++;connected=false;
        SerialInputOutputManager reader=io;io=null;
        UsbSerialPort old=port;port=null;
        if(reader!=null){reader.setListener(null);reader.stop();}
        if(old!=null)worker.execute(()->{try{old.close();}catch(Exception ignored){}});
    }
    public void shutdown(){close();worker.shutdown();}
}
