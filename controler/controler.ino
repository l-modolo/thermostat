#include <ESP8266WiFi.h>
#include <WiFiClient.h>
#include <ESP8266WebServer.h>
// for OTA
#include <WiFiUdp.h>
#include <ArduinoOTA.h>
#include "config.h"

int i = 0;
String controler_status;
String line;
unsigned long current_time;

WiFiClient client;
ESP8266WebServer controler_server(80);

void setup(void){
  Serial.begin(115200);
  controler_status = "controler started";
  // wifi connection
  WiFi.begin(ssid, password);
  Serial.println("");
  // wait for wifi connection
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
}

void getinfos (){
  if (millis() > (current_time + update_time)) {
    current_time = millis();
    if (!client.connect(server, 80)) {
      Serial.println("Connection to server failed");
      // connect to thermometer
      if (!client.connect(thermometer, 80)) {
        Serial.println("Connection to thermometer failed");
        relayOn();
        controler_status = "no server, no thermometer, relay on.";
      } else {
        readthermometer();
      }
    } else {
      readserver();
    }
    Serial.println("Connection closed.");
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
        Serial.println("no reading.");
        relayOn();
        controler_status = "no server, thermometer temp : nan, relay on.";
      } else {
        if (line.toFloat() < default_temp) {
          Serial.println("too cold.");
          relayOn();
          controler_status = "no server, thermometer temp :" +
            line + 
            " < " +
            String((float) default_temp) +
            ", relay on.";
        }
        if (line.toFloat() >= default_temp) {
          Serial.println("too hot.");
          relayOff();
          controler_status = "no server, thermometer temp :" +
            line + 
            " >= " +
            String((float) default_temp) +
            ", relay off.";
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

