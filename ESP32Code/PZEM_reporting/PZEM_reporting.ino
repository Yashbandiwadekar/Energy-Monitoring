#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <PubSubClient.h>
#include <PZEM004Tv30.h>

// ══════════════════════════════════════════════════════════════════════
// CONFIG — WiFi & HiveMQ Cloud
// ══════════════════════════════════════════════════════════════════════
const char* ssid = "Aarav24";
const char* password = "deepali28#";

const char* mqtt_server = "5da11b3a246749988e98dc9d44c2f012.s1.eu.hivemq.cloud";
const int   mqtt_port = 8883; // TLS port
const char* mqtt_client_id = "esp32_pzem_01";
const char* mqtt_user = "IOT-Device";
const char* mqtt_pass = "bT@Et5GTQP57_i_";
const char* mqtt_topic = "pzem/device01/telemetry";

// ══════════════════════════════════════════════════════════════════════
// HARDWARE SETUP
// ══════════════════════════════════════════════════════════════════════
// ESP32 UART2 pins
#define RXD2 16
#define TXD2 17

// Initialize PZEM on Serial2
PZEM004Tv30 pzem(Serial2, RXD2, TXD2);

// Initialize secure WiFi client and MQTT client
WiFiClientSecure espClient;
PubSubClient mqtt(espClient);

void setup_wifi() {
  delay(10);
  Serial.print("\nConnecting to WiFi: ");
  Serial.println(ssid);

  WiFi.begin(ssid, password);

  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }

  Serial.print("\nWiFi connected! IP address: ");
  Serial.println(WiFi.localIP());
}

void reconnect_mqtt() {
  // Loop until we're reconnected
  while (!mqtt.connected()) {
    Serial.print("Attempting MQTT connection...");
    
    // Attempt to connect
    if (mqtt.connect(mqtt_client_id, mqtt_user, mqtt_pass)) {
      Serial.println("Connected to HiveMQ!");
    } else {
      Serial.print("Failed, rc=");
      Serial.print(mqtt.state());
      Serial.println(" - Retrying in 5 seconds");
      delay(5000);
    }
  }
}

void setup() {
  Serial.begin(115200);
  
  setup_wifi();

  // Configure the secure client to skip certificate validation for an easier setup
  espClient.setInsecure();
  
  mqtt.setServer(mqtt_server, mqtt_port);
  
  Serial.println("System Boot Complete. Waiting for PZEM data...");
}

void loop() {
  // Ensure we stay connected to WiFi and MQTT
  if (WiFi.status() != WL_CONNECTED) {
    setup_wifi();
  }
  if (!mqtt.connected()) {
    reconnect_mqtt();
  }
  mqtt.loop();

  // Read data from the PZEM
  float voltage = pzem.voltage();
  float current = pzem.current();
  float power = pzem.power();
  float energy = pzem.energy();
  float frequency = pzem.frequency();
  float pf = pzem.pf();

  // Check if the reading is valid (isnan = "Is Not A Number")
  if (isnan(voltage)) {
    Serial.println("Error reading PZEM. Check AC mains power and wiring!");
  } else {
    // Construct a simple JSON payload manually
    String payload = "{";
    payload += "\"device\":\"" + String(mqtt_client_id) + "\",";
    payload += "\"voltage_V\":" + String(voltage) + ",";
    payload += "\"current_A\":" + String(current, 3) + ","; // 3 decimal places
    payload += "\"power_W\":" + String(power) + ",";
    payload += "\"energy_Wh\":" + String(energy) + ",";
    payload += "\"frequency_Hz\":" + String(frequency) + ",";
    payload += "\"power_factor\":" + String(pf);
    payload += "}";

    // Print to Serial Monitor for debugging
    Serial.print("Publishing: ");
    Serial.println(payload);

    // Publish to HiveMQ
    mqtt.publish(mqtt_topic, payload.c_str());
  }

  // Wait 10 seconds before polling again
  delay(1000); 
}