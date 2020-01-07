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
String line;
unsigned long current_time;
float heating = 0;
float temperature = 0.0;
float humidity = 0.0;
int err = SimpleDHTErrSuccess;

WiFiClient client;
ESP8266WebServer controler_server(80);

void setup(void){
  Serial.begin(115200);
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

void handle_root() {
  controler_server.send(
    200,
    "text/plain",
    update_status()
  );
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
    if (client.connect(server, 80)) {
      readserver();
    } else {
      Serial.println("Connection to server failed");
      // connect to thermometer
      if (client.connect(thermometer, 80)) {
        readthermometer();
      } else {
        Serial.println("Connection to thermometer failed");
        readinternalthermometer();
      }
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
  } else {
    if (temperature < default_temp + internal_temp_correction + heating) {
      Serial.println("too cold.");
      relayOn();
      heating = temp_lag;
    }
    if (temperature >= default_temp + internal_temp_correction + heating) {
      Serial.println("too hot.");
      relayOff();
      heating = 0.0;
    }
  }
}

void readthermometer(){
  Serial.println("Connected to thermometer - sending request...");
  client.println("GET /temp HTTP/1.1");
  client.println(String("Host: ") + String(thermometer));
  client.println("Connection: close");
  client.println();
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
      } else {
        if (line.toFloat() < default_temp + heating) {
          Serial.println("too cold.");
          relayOn();
          heating = temp_lag;
        }
        if (line.toFloat() >= default_temp + heating) {
          Serial.println("too hot.");
          relayOff();
          heating = 0.0;
        }
      }
    }
  }
}

void readserver(){
  Serial.println("Connected to server - sending request...");
  client.println(String("GET /?t=") + readinternaltempString() + String(" HTTP/1.1"));
  client.println(String("Host: ") + String(server));
  client.println("Connection: close");
  client.println();
  Serial.println("Request sent - waiting for reply...");
  delay(1000);
  // Read the entire response and flush it to Serial output
  while(client.available()){
    String line = client.readStringUntil('\n');
    Serial.println(line);
    if (line.equals("on")) {
      Serial.println("Server says to be on.");
      relayOn();
    }
    if (line.equals("off")) {
      Serial.println("Server says to be off.");
      relayOff();
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

String update_status() {
  return("{\"internal\": " +
    readinternaltempString() + "}");
}
