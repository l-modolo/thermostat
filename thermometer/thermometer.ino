#include <SimpleDHT.h>
#include <ESP8266WiFi.h>
#include <WiFiClient.h>
#include <ESP8266WebServer.h>
// for OTA
#include <WiFiUdp.h>
#include <ArduinoOTA.h>
#include "config.h"

SimpleDHT22 dht22;

ESP8266WebServer server(80);
float temperature = 0.0;
float humidity = 0.0;
int err = SimpleDHTErrSuccess;

void setup(void){
  Serial.begin(115200);
  // wifi connection
  wificonnect();

  ArduinoOTA.setHostname("thermometer");
  ArduinoOTA.setPassword(OTApassword);
  ArduinoOTA.begin(); // OTA initalisation

  // Define capabilities of our little web server
  server.on("/", handle_root);
  
  server.on("/temp", [](){
    err = dht22.read2(pinDHT22, &temperature, &humidity, NULL);
    Serial.println("temp");
    if ( err != SimpleDHTErrSuccess) {
       Serial.println("nan");
       server.send(200, "text/plain", "nan");
    } else {
      Serial.println(String((float) temperature));
      server.send(200, "text/plain", String((float) temperature));
    }
  });
  
  server.on("/humidity", [](){
    err = dht22.read2(pinDHT22, &temperature, &humidity, NULL);
    Serial.println("humidity");
    if ( err != SimpleDHTErrSuccess) {
       Serial.println("nan");
       server.send(200, "text/plain", "nan");
    } else {
      Serial.println(String((float) humidity));
      server.send(200, "text/plain", String((float) humidity));
    }
  });

  server.begin();
  Serial.println("HTTP server started");
}

void loop(void){
  wificonnect();
  server.handleClient();
  ArduinoOTA.handle();
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

void handle_root() {
  server.send(200, "text/plain", "All systems go. Read data from /temp or or /temp_c or /humidity or /heatindex.");
  delay(100);
}
