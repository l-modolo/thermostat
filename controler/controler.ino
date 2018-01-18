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
float internal_temp_correction = 3.0;
int err = SimpleDHTErrSuccess;

WiFiClient client;
ESP8266WebServer controler_server(80);

void setup(void){
  Serial.begin(115200);
  controler_status = "controler started";
  // wifi connection
  wificonnect();

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
  wificonnect()
  controler_server.handleClient();
  ArduinoOTA.handle();
  getinfos();
}

void wificonnect(){
  if (WiFi.status() != WL_CONNECTED)) {
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
      // connect to thermometer
      if (!client.connect(thermometer, 80)) {
        Serial.println("Connection to thermometer failed");
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
    return("nan");
  } else {
    return(String((float) temperature));
  }
}

void readinternalthermometer(){
  err = dht22.read2(pinDHT22, &temperature, &humidity, NULL);
  if ( err != SimpleDHTErrSuccess) {
    Serial.println("no internal reading.");
    relayOff();
    controler_status = "no server, no thermometer, internal: nan, relay off.";
  } else {
    if (temperature < default_temp + internal_temp_correction + heating) {
      Serial.println("too cold.");
      relayOn();
      heating = 1.0;
      controler_status = "no server, no thermometer, internal: " +
        String((float) temperature) + 
        " < " +
        String((float) default_temp + internal_temp_correction) +
        " (temperature corrected), relay on.";
    }
    if (temperature >= default_temp + internal_temp_correction + heating) {
      Serial.println("too hot.");
      relayOff();
      heating = 0.0;
      controler_status = "no server, no thermometer, internal: " +
        String((float) temperature) + 
        " >= " +
        String((float) default_temp + internal_temp_correction) +
        " (temperature corrected), relay off.";
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
        relayOff();
        controler_status = "no server, thermometer temp : nan, relay off.";
      } else {
        if (line.toFloat() < default_temp + heating) {
          Serial.println("too cold.");
          relayOn();
          heating = 1.0;
          controler_status = "no server, thermometer temp :" +
            line + 
            " < " +
            String((float) default_temp) +
            ", internal: " +
            readinternaltempString() + 
            " relay on.";
        }
        if (line.toFloat() >= default_temp + heating) {
          Serial.println("too hot.");
          relayOff();
          heating = 0.0;
          controler_status = "no server, thermometer temp :" +
            line + 
            " >= " +
            String((float) default_temp) +
            ", internal: " +
            readinternaltempString() + 
            " relay off.";
        }
      }
    }
  }
}

void readserver(){
  Serial.println("Connected to server - sending request...");
  client.print(String("GET /heater.html HTTP/1.1\r\n") +
               "Host: " + server + "\r\n" +
               "Connection: close\r\n\r\n");
  Serial.println("Request sent - waiting for reply...");
  delay(1000);
  // Read the entire response and flush it to Serial output
  while(client.available()){
    String line = client.readStringUntil('\r');
    Serial.println(line);
    if (line.equals("on")) {
      Serial.println("Server says to be on.");
      relayOn();
      controler_status = "server = on, relay on.";
    } else {
      Serial.println("Server says to be off.");
      relayOff();
      controler_status = "server = off, relay off.";
    }
  }
}

void relayOn() {
  Serial.println("relay on");
  digitalWrite(resetPin, LOW);
}

void relayOff() {
  Serial.println("relay off");
  digitalWrite(resetPin, HIGH);
}

void handle_root() {
  controler_server.send(
    200,
    "text/plain",
    controler_status
  );
}

