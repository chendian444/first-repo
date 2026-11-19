#define _POSIX_C_SOURCE 200809L
#define _DEFAULT_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <math.h>
#include <poll.h>
#include <signal.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/file.h>
#include <termios.h>
#include <time.h>
#include <unistd.h>

/* UART parsing and PC compression only; no motor command or control UART access. */
_Static_assert(sizeof(float)==4,"requires float32");
static int cleanup_fd=-1;
static struct termios cleanup_termios;
static void restore_tty(void){if(cleanup_fd>=0)(void)tcsetattr(cleanup_fd,TCSANOW,&cleanup_termios);}
static volatile sig_atomic_t running=1;
static void stop(int sig){(void)sig;running=0;}
static uint8_t buffer[8192];static size_t used;
static uint64_t frames,bad,discarded,raw_bytes,wire_bytes,payload_bytes;static uint32_t host_sequence;
static double started;
static FILE *csv,*dcw,*rawlog;
static int emit;
static double clock_s(clockid_t kind){struct timespec t;if(clock_gettime(kind,&t)){perror("clock_gettime");exit(1);}return t.tv_sec+t.tv_nsec/1e9;}
static uint16_t get16(const uint8_t*p){return (uint16_t)(p[0]|(uint16_t)p[1]<<8);}
static uint32_t get32(const uint8_t*p){return (uint32_t)p[0]|(uint32_t)p[1]<<8|(uint32_t)p[2]<<16|(uint32_t)p[3]<<24;}
static void put16(uint8_t*p,uint16_t v){p[0]=(uint8_t)v;p[1]=(uint8_t)(v>>8);}
static void put32(uint8_t*p,uint32_t v){for(int i=0;i<4;i++)p[i]=(uint8_t)(v>>(8*i));}
static uint16_t crc16(const uint8_t*p,size_t n){uint16_t c=0xffff;while(n--){c^=(uint16_t)*p++<<8;for(int i=0;i<8;i++)c=(uint16_t)((c&0x8000)?(c<<1)^0x1021:c<<1);}return c;}
static void write_all(FILE*f,const void*p,size_t n){if(f&&fwrite(p,1,n,f)!=n){perror("output write");exit(1);}}
static void output(const uint8_t*raw,size_t size,uint32_t seq,uint32_t ticks,int source,int auto_mode){
    uint8_t packed[208],frame[126];size_t pos=0,n=0;
    while(pos<size){size_t start=pos;int zero=raw[pos]==0;while(pos<size&&(raw[pos]==0)==zero)pos++;
        packed[n++]=(uint8_t)((zero?128:0)|(pos-start-1));if(!zero){memcpy(packed+n,raw+start,pos-start);n+=pos-start;}}
    int codec=auto_mode&&n<size;size_t length=codec?n:size;
    memcpy(frame,"DCW1",4);frame[4]=(uint8_t)codec;frame[5]=(uint8_t)(size/4);put16(frame+6,(uint16_t)length);
    put32(frame+8,seq);put32(frame+12,ticks);frame[16]=(uint8_t)auto_mode;put16(frame+17,10);frame[19]=(uint8_t)source;
    memcpy(frame+20,codec?packed:raw,length);put16(frame+20+length,crc16(frame,20+length));
    write_all(dcw,frame,22+length);if(emit)write_all(stdout,frame,22+length);
    if(csv){fprintf(csv,"%.6f,%u,%u,%d",clock_s(CLOCK_REALTIME),seq,ticks,source);for(size_t i=0;i<size;i+=4){uint32_t bits=get32(raw+i);float value;memcpy(&value,&bits,4);fprintf(csv,",%.9g",(double)value);}fputc('\n',csv);if(ferror(csv)){perror("CSV write");exit(1);}}
    frames++;raw_bytes+=size;wire_bytes+=22+length;payload_bytes+=length;
}
static void remove_bytes(size_t n){memmove(buffer,buffer+n,used-n);used-=n;}
static void parse(int full,int auto_mode){
    const size_t total=full?122:66;
    while(used){
        if(full){
            if(used<4)break;
            if(memcmp(buffer,"RWT1",4)){discarded++;remove_bytes(1);continue;}
            if(used<8)break;
            if(buffer[4]!=1||buffer[5]!=26||get16(buffer+6)!=104){bad++;discarded++;remove_bytes(1);continue;}
        }else if(buffer[0]!=0x23){discarded++;remove_bytes(1);continue;}
        if(used<total)break;
        int valid;
        if(full)valid=crc16(buffer,120)==get16(buffer+120);
        else{uint8_t sum=0;for(int i=1;i<=64;i++)sum=(uint8_t)(sum+buffer[i]);valid=sum==buffer[65];}
        if(!valid){bad++;discarded++;remove_bytes(1);continue;}
        if(full)output(buffer+16,104,get32(buffer+8),get32(buffer+12),2,auto_mode);
        else output(buffer+1,64,host_sequence++,(uint32_t)((clock_s(CLOCK_MONOTONIC)-started)*1000),1,auto_mode);
        remove_bytes(total);
    }
}
static FILE* exclusive(const char*path){int fd=open(path,O_WRONLY|O_CREAT|O_EXCL,0600);if(fd<0){perror(path);exit(1);}FILE*f=fdopen(fd,"wb");if(!f){perror("fdopen");close(fd);exit(1);}return f;}
static const char*full_names="gyro_x,gyro_y,gyro_z,angle_x,angle_y,wheel1_speed,wheel2_speed,wheel3_speed,encoder1_raw,encoder2_raw,encoder3_raw,wheel1_id,wheel2_id,wheel3_id,wheel1_iq,wheel2_iq,wheel3_iq,battery_v,battery_filtered_v,rc_x,rc_y,rc_z,protect_flag,auto_mode,manual_mode,calibrated";
static const char*legacy_names="gyro_x,gyro_y,gyro_z,reserved_4,reserved_5,reserved_6,reserved_7,reserved_8,reserved_9,reserved_10,reserved_11,reserved_12,reserved_13,reserved_14,rc_x,rc_y";
static void usage(void){fprintf(stderr,"collector --protocol legacy|raw26 (--file INPUT | --serial /dev/ttyUSB0) --dcw OUT --csv OUT --raw OUT [--baud 230400] [--enable-stream] [--emit] [--mode AUTO|RAW]\nOutputs must not exist. Serial is board USART3 telemetry, NOT ESP32 debug or control UART.\n");}
int main(int argc,char**argv){
    const char*input=NULL,*serial=NULL,*protocol=NULL,*dcw_path=NULL,*csv_path=NULL,*raw_path=NULL;int baud=230400,enable=0,full=0,auto_mode=1;
    for(int i=1;i<argc;i++){
        if(!strcmp(argv[i],"--emit")){emit=1;continue;}if(!strcmp(argv[i],"--enable-stream")){enable=1;continue;}
        if(!strcmp(argv[i],"--help")){usage();return 0;}
        if(i+1==argc){usage();return 2;}
        const char*k=argv[i],*v=argv[++i];
        if(!strcmp(k,"--file"))input=v;else if(!strcmp(k,"--serial"))serial=v;else if(!strcmp(k,"--protocol"))protocol=v;
        else if(!strcmp(k,"--dcw"))dcw_path=v;else if(!strcmp(k,"--csv"))csv_path=v;else if(!strcmp(k,"--raw"))raw_path=v;
        else if(!strcmp(k,"--baud")){char*end;long b=strtol(v,&end,10);if(*end||b<1||b>1000000){usage();return 2;}baud=(int)b;}
        else if(!strcmp(k,"--mode")){if(!strcmp(v,"RAW"))auto_mode=0;else if(strcmp(v,"AUTO")){usage();return 2;}}
        else{usage();return 2;}
    }
    if((!input&&!serial)||(input&&serial)||!protocol||!dcw_path||!csv_path||!raw_path||(!strcmp(dcw_path,csv_path)||!strcmp(dcw_path,raw_path)||!strcmp(csv_path,raw_path))){usage();return 2;}
    if(!strcmp(protocol,"raw26"))full=1;else if(strcmp(protocol,"legacy")){usage();return 2;}
    if(enable&&!serial){fprintf(stderr,"--enable-stream requires --serial\n");return 2;}
    int fd=open(serial?serial:input,O_RDONLY|(serial?(O_NOCTTY|O_NONBLOCK):0));
    /* Open read-write only when explicitly permitted to send telemetry enable. */
    if(serial&&enable){if(fd>=0)close(fd);fd=open(serial,O_RDWR|O_NOCTTY|O_NONBLOCK);}
    if(fd<0){perror("input open");return 1;}
    struct termios saved;int restore=0;
    if(serial){
        if(flock(fd,LOCK_EX|LOCK_NB)<0){perror("serial lock");close(fd);return 1;}
        if(tcgetattr(fd,&saved)){perror("tcgetattr");close(fd);return 1;}
        struct termios cfg=saved;cfmakeraw(&cfg);cfg.c_cflag&=~(PARENB|CSTOPB|CSIZE|CRTSCTS);cfg.c_cflag|=CS8|CLOCAL|CREAD;cfg.c_cc[VMIN]=0;cfg.c_cc[VTIME]=0;
        speed_t speed;
        if(baud==230400)speed=B230400;else if(baud==115200)speed=B115200;else if(baud==9600)speed=B9600;else{fprintf(stderr,"supported baud: 9600,115200,230400\n");close(fd);return 2;}
        if(cfsetispeed(&cfg,speed)||cfsetospeed(&cfg,speed)||tcsetattr(fd,TCSANOW,&cfg)){perror("serial setup");close(fd);return 1;}restore=1;cleanup_fd=fd;cleanup_termios=saved;atexit(restore_tty);
    }
    dcw=exclusive(dcw_path);csv=exclusive(csv_path);rawlog=exclusive(raw_path);
    fprintf(csv,"received_unix,sequence,ticks_ms,source,%s\n",full?full_names:legacy_names);
    signal(SIGINT,stop);signal(SIGTERM,stop);signal(SIGPIPE,SIG_IGN);started=clock_s(CLOCK_MONOTONIC);
    int result=0;double flushed=started;
    if(enable){const uint8_t command[]={0xa0,0xac,0x08,0xba,0x66};size_t sent=0;while(sent<sizeof command){ssize_t n=write(fd,command+sent,sizeof command-sent);if(n>0)sent+=(size_t)n;else if(n<0&&errno==EINTR)continue;else{perror("enable telemetry");running=0;result=1;break;}}}
    while(running){
        struct pollfd pfd={fd,POLLIN,0};int ready=poll(&pfd,1,100);
        if(ready<0){if(errno==EINTR)continue;perror("poll");result=1;break;}
        if(ready){
            if(pfd.revents&POLLNVAL){fprintf(stderr,"invalid descriptor\n");result=1;break;}
            uint8_t data[4096];ssize_t n=read(fd,data,sizeof data);
            if(n>0){write_all(rawlog,data,(size_t)n);for(ssize_t i=0;i<n;i++){buffer[used++]=data[i];parse(full,auto_mode);}}
            else if(n==0){if(!serial)break;if(pfd.revents&(POLLHUP|POLLERR)){fprintf(stderr,"serial disconnected\n");result=1;break;}}
            else if(errno!=EAGAIN&&errno!=EINTR){perror("read");result=1;break;}
        }
        double now=clock_s(CLOCK_MONOTONIC);
        if(now-flushed>=0.1){if(fflush(csv)||fflush(dcw)||fflush(rawlog)||(emit&&fflush(stdout))){perror("flush");result=1;break;}flushed=now;}
    }
    if(restore&&tcsetattr(fd,TCSANOW,&saved)){perror("restore termios");result=1;}cleanup_fd=-1;close(fd);
    if(fclose(csv)||fclose(dcw)||fclose(rawlog)){perror("close output");result=1;}if(emit&&fflush(stdout))result=1;
    fprintf(stderr,"{\"frames\":%llu,\"invalidCandidates\":%llu,\"discardedBytes\":%llu,\"trailingBytes\":%zu,\"rawPayloadBytes\":%llu,\"dcwFrameBytes\":%llu,\"encodedPayloadBytes\":%llu,\"hardwareValidated\":false}\n",(unsigned long long)frames,(unsigned long long)bad,(unsigned long long)discarded,used,(unsigned long long)raw_bytes,(unsigned long long)wire_bytes,(unsigned long long)payload_bytes);
    return result;
}
