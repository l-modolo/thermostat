#include <SimpleDHT.h>
#include <ESP8266WiFi.h>
#include <WiFiClient.h>
#include <ESP8266WebServer.h>
// for OTA
#include <WiFiUdp.h>
#include <ArduinoOTA.h>
#include "config.h"

SimpleDHT22 dht22;

int i = 0;
String controler_status;
String line;
unsigned long current_time;
float heating = 0;
float temperature = 0.0;
float humidity = 0.0;
String relay_status = "\"off\"";
String server_status = "\"nan\"";
String thermometer_status = "\"nan\"";
int err = SimpleDHTErrSuccess;

WiFiClient client;
ESP8266WebServer controler_server(80);

void setup(void){
  Serial.begin(115200);
  controler_status = "controler started";
  // wifi connection
  WiFi.begin(ssid, password);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  // print ip adress when connected
  Serial.println("");
  Serial.print("IP address: ");
  Serial.println(WiFi.localIP());

  ArduinoOTA.setHostname("controler");
  ArduinoOTA.setPassword(OTApassword);
  ArduinoOTA.begin(); // OTA initalisation

  pinMode(resetPin, OUTPUT);
  controler_server.on("/", handle_root);
  current_time = millis();

  controler_server.begin();
  Serial.println("HTTP server started");
}

void loop(void){
  controler_server.handleClient();
  ArduinoOTA.handle();
  getinfos();
  wificonnect();
}

void wificonnect(){
  if (WiFi.status() != WL_CONNECTED) {
    WiFi.begin(ssid, password);
    Serial.println("");
    // wait for wifi connection during 10sec
    int wifi_wait = 0;
    while (WiFi.status() != WL_CONNECTED || wifi_wait < 10000) {
      delay(500);
      Serial.print(".");
      wifi_wait = wifi_wait + 500;
    }
    // print ip adress when connected
    Serial.println("");
    Serial.print("IP address: ");
    Serial.println(WiFi.localIP());
  }
}

void getinfos (){
  if (millis() > (current_time + update_time)) {
    current_time = millis();
    if (!client.connect(server, 80)) {
      Serial.println("Connection to server failed");
      server_status = "\"nan\"";
      // connect to thermometer
      if (!client.connect(thermometer, 80)) {
        Serial.println("Connection to thermometer failed");
        thermometer_status = "\"nan\"";
        readinternalthermometer();
      } else {
        readthermometer();
      }
    } else {
      readserver();
    }
    Serial.println("Connection closed.");
  }
}

String readinternaltempString(){
  err = dht22.read2(pinDHT22, &temperature, &humidity, NULL);
  if ( err != SimpleDHTErrSuccess) {
    return("\"nan\"");
  } else {
    return(String((float) temperature));
  }
}

void readinternalthermometer(){
  err = dht22.read2(pinDHT22, &temperature, &humidity, NULL);
  if ( err != SimpleDHTErrSuccess) {
    Serial.println("no internal reading.");
    relayOff();
    controler_status = "{\"server\": nan, \"thermometer\": nan, \"internal\": nan, \"relay\": " + relay_status + "}";
  } else {
    if (temperature < default_temp + internal_temp_correction + heating) {
      Serial.println("too cold.");
      relayOn();
      heating = temp_lag;
      controler_status = "{\"server\": nan, \"thermometer\": nan, \"internal\": " +
        String((float) temperature) + 
        ", \"relay\": " + relay_status + "}";
    }
    if (temperature >= default_temp + internal_temp_correction + heating) {
      Serial.println("too hot.");
      relayOff();
      heating = 0.0;
      controler_status = "{\"server\": nan, \"thermometer\": nan, \"internal\": " +
        String((float) temperature) + 
        ", \"relay\": " + relay_status + "}";
    }
  }
}

void readthermometer(){
  Serial.println("Connected to thermometer - sending request...");
  client.print(String("GET /temp HTTP/1.1\r\n") +
           "Host: " + thermometer + "\r\n" +
           "Connection: close\r\n\r\n");
  Serial.println("Request sent - waiting for reply...");
  delay(1000);
  i = 0;
  while (client.available()) {
    line = client.readStringUntil('\n');
    i = i + 1;
    if (i == 7) {
      Serial.println(line);
      if (line.equals("nan")) {
        Serial.println("no thermometer reading.");
        thermometer_status = "\"nan\"";
        relayOff();
        controler_status = "{\"server\": " + server_status + ", \"thermometer\": " +
            thermometer_status +
            ", \"internal\": " +
            readinternaltempString() + 
            ", \"relay\": " + relay_status + "}";
      } else {
        thermometer_status = line;
        if (line.toFloat() < default_temp + heating) {
          Serial.println("too cold.");
          relayOn();
          heating = temp_lag;
          controler_status = "{\"server\": " + server_status + ", \"thermometer\": " +
            thermometer_status + 
            ", \"internal\": " +
            readinternaltempString() + 
            ", \"relay\": " + relay_status + "}";
        }
        if (line.toFloat() >= default_temp + heating) {
          Serial.println("too hot.");
          relayOff();
          heating = 0.0;
          controler_status = "{\"server\": " + server_status + ", \"thermometer\": " +
            thermometer_status + 
            ", \"internal\": " +
            readinternaltempString() + 
            ", \"relay\": " + relay_status + "}";
        }
      }
    }
  }
}

void readserver(){
  Serial.println("Connected to server - sending request...");
  client.print(String("GET / HTTP/1.1\r\n") +
               "Host: " + server + "\r\n" +
               "Connection: close\r\n\r\n");
  Serial.println("Request sent - waiting for reply...");
  delay(1000);
  // Read the entire response and flush it to Serial output
  while(client.available()){
    String line = client.readStringUntil('\n');
    Serial.println(line);
    if (line.equals("on")) {
      server_status = "\"on\"";
      Serial.println("Server says to be on.");
      relayOn();
      controler_status = "{\"server\" = " + server_status + ", \"thermometer\": " +
            thermometer_status + 
            ", \"internal\": " +
            readinternaltempString() +
            ", \"relay\": " + relay_status + "}";
    }
    if (line.equals("off")) {
      Serial.println("Server says to be off.");
      server_status = "\"off\"";
      relayOff();
      controler_status = "\"server\" = " + server_status + ", \"thermometer\": " +
            thermometer_status + 
            ", \"internal\": " +
            readinternaltempString() + 
            ", \"relay\": " + relay_status + "}";
    }
  }
}

void relayOn() {
  relay_status = "\"on\"";
  Serial.println("relay on");
  digitalWrite(resetPin, LOW);
}

void relayOff() {
  relay_status = "\"off\"";
  Serial.println("relay off");
  digitalWrite(resetPin, HIGH);
}

void handle_root() {
  controler_status = "{\"server\": " + server_status + ", \"thermometer\": " +
            thermometer_status + 
            ", \"internal\": " +
            readinternaltempString() + 
            ", \"relay\": " + relay_status + "}";
  controler_server.send(
    200,
    "text/plain",
    controler_status
  );
}
