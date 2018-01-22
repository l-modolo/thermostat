const char* ssid = "..."; // wifi SSID
const char* password = "..."; // wifi password
const char* OTApassword = "..."; // OTA pasword

int resetPin = 16; // D0
int pinDHT22 = 5;  // D1
const char* server = "192.168.0.1"; // server adress
const char* thermometer = "192.168.0.4"; // thermometer adress
int update_time = 10000;
float default_temp = 18.50;
float internal_temp_correction = 3.0;
float temp_lag = 1.0;

