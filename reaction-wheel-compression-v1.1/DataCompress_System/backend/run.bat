@echo off
setlocal
set MAVEN_OPTS=-Xms256m -Xmx1536m -Djava.net.preferIPv4Stack=true -Djava.net.preferIPv6Addresses=false
mvn -U spring-boot:run
endlocal
