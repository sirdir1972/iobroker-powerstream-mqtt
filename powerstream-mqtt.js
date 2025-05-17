const axios = require('axios');
const mqtt = require('mqtt');
const crypto = require('crypto');
var ConfigData = {
    PS: [{ serial : ''}, // serial ps1
    { serial : '', // serial ps2
    { serial : ''}], //serial ps3 etc.
    D2M: [ { serial : ''}],
    statesPrefix : '0_userdata.0.ecoflow_public_api',   // hier werden die objekte abgelegt
    runEvery: 4,                                    // alle 4 sekunden ausführen
    demand: "0_userdata.0.sumpower.actualDemand", // hier eintragen wo der Verbrauch gemessen wird (zähler, shelly etc)
    LowerLimitPerecents: 10,                            // ab 10% Bat Ladung
    LowerLimitMaxWatts: 1000,                          // nur noch max x/10 Watt einspeisen
    DoSleepFrom: 24,                                     // nix tun von - wenn script nicht schlafen soll, wert auf "" setzen. 
    DoSleepTo: 8,                                       // bis
}
//****** HIER DEINE DATEN ******
const accessKey = 'YOUR ACCESS KEY'; // Ersetze dies mit deinem tatsächlichen Access Key
const secretKey = 'YOUR SECRET KEY'; // Ersetze dies mit deinem tatsächlichen Secret Key
const MQTT_Clientid = 134522      // zufälligen wert eintragen
//*********************/
 
var PowerStream = []
var Delta2Max = []
var lastMessageTimes = {};
// Konfigurationen
const host = 'api-e.ecoflow.com';
const mqttHost = 'mqtt.ecoflow.com';
const mqttPort = 8883;
const mqttProtocol = 'mqtts';
initMyObjectAsBoolean(".regulate",true)
initMyObjectAsBoolean(".Debug",true)
initDevicesDefault();
var debug = getState(ConfigData.statesPrefix + ".Debug").val
const mqttCert = ConfigData.statesPrefix + '.mqttCert'

// Globale Variablen für client und certification
let client;
let certification;
 
if (!existsState(mqttCert)) {
    createState(mqttCert, "");
}

 function parseMessage(topic,message) {
    var myObject = JSON.parse(message)
    var serial = topic.split('/')[3]
    lastMessageTimes[serial] = Date.now();
    const path = ConfigData.statesPrefix + "." + serial
    if (!existsState(path)) createState(path)
    logDebug(JSON.stringify(myObject, null, 2));
    setMessage(myObject,ConfigData.statesPrefix,serial,'param','invOutputWatts')
    setMessage(myObject,ConfigData.statesPrefix,serial,'param',"batInputWatts")
    setMessage(myObject,ConfigData.statesPrefix,serial,'param',"pv1InputWatts")
    setMessage(myObject,ConfigData.statesPrefix,serial,'param',"pv2InputWatts")
    setMessage(myObject,ConfigData.statesPrefix,serial,'param',"batSoc")
    setMessage(myObject,ConfigData.statesPrefix,serial,'param',"pv1Temp")
    setMessage(myObject,ConfigData.statesPrefix,serial,'param',"pv2Temp")
    setMessage(myObject,ConfigData.statesPrefix,serial,'param',"supplyPriority")
    setMessage(myObject,ConfigData.statesPrefix,serial,'param',"batErrCode")
    setMessage(myObject,ConfigData.statesPrefix,serial,'param',"permanentWatts")
    setMessage(myObject,ConfigData.statesPrefix,serial,'params',"soc")
    setMessage(myObject,ConfigData.statesPrefix,serial,'params',"inputWatts")
    setMessage(myObject,ConfigData.statesPrefix,serial,'params',"SlowChgWatts")


 }
 
 function setMessage(myObject,path,serial,objpath,name) {
    var pathForObject = path + "." + serial + "." + name
    try {
        var myVar = myObject[objpath][name]
    } catch {}
    if (myVar != undefined) {
        if (!existsState(pathForObject)) createState(pathForObject)
        //log(pathForObject + " " + myVar)
        setState(pathForObject,myVar)

    }
 }
// Hilfsfunktion zur Erstellung eines HMAC-SHA256-Signatur
function createSignature(params, secretKey) {
    const queryString = Object.keys(params)
        .sort()
        .map(key => `${key}=${params[key]}`)
        .join('&');
    return crypto.createHmac('sha256', secretKey).update(queryString).digest('hex');
}
 
// Funktion zur Überprüfung, ob Zertifikat bereits vorhanden ist
async function loadMQTTCertification() {
    return new Promise((resolve, reject) => {
        // Überprüfen, ob der State existiert
 
        getState(mqttCert, (err, state) => {
            if (err) {
                console.error('Fehler beim Überprüfen des Zertifikat-States:', err);
                return reject(err);
            }
            if (state && state.val) {
                try {
                    const storedCert = JSON.parse(state.val);
                    // Überprüfen, ob die Felder im Zertifikat vorhanden sind
                    if (storedCert.certificateAccount && storedCert.certificatePassword) {
                        logDebug('Zertifikat aus ioBroker geladen');
                        return resolve(storedCert);
                    }
                } catch (error) {
                    console.error('Fehler beim Parsen des Zertifikats:'+ error);
                }
            }
            resolve(null); // Kein Zertifikat gefunden oder ungültig
        });
    });
}
 
// Zertifikate für MQTT abrufen und speichern
async function getMQTTCertification() {
    const nonce = Math.floor(Math.random() * 1000000);
    const timestamp = Date.now();
    const params = {
        accessKey: accessKey,
        nonce: nonce,
        timestamp: timestamp
    };
 
    const signature = createSignature(params, secretKey);
 
    try {
        const response = await axios.get(`https://${host}/iot-open/sign/certification`, {
            headers: {
                accessKey: accessKey,
                nonce: nonce,
                timestamp: timestamp,
                sign: signature
            }
        });
 
        const certData = response.data.data;
        // Zertifikat in ioBroker speichern
        setState(mqttCert, JSON.stringify(certData), true);
        logDebug('Zertifikat erfolgreich abgerufen und in ioBroker gespeichert');
        return certData;
    } catch (error) {
        console.error('Fehler beim Abrufen der MQTT-Zertifikate:'+ error);
        throw error;
    }
}
 
 function setSupplyPriority(deviceSN, prioValue) {
     const oldprioValue = getState(ConfigData.statesPrefix + "." + deviceSN + ".supplyPriority").val
    if (oldprioValue != prioValue) {

    if (!client || !certification) {
        console.error("MQTT-Client oder Zertifizierung nicht bereit.");
        return;
    }
 
    const setTopic = `/open/${certification.certificateAccount}/${deviceSN}/set`;
 
    const message = {
        id: Date.now(), // Einzigartige ID
        version: "1.0",
        sn: deviceSN,
        cmdCode: "WN511_SET_SUPPLY_PRIORITY_PACK", // Befehlscode zum Setzen von permanentWatts
        params: {
            "supplyPriority": prioValue // Der Wert, den du setzen möchtest
        }
    };
 
    client.publish(setTopic, JSON.stringify(message), (err) => {
        if (!err) {
            logDebug(`Befehl zum Setzen von SupplyPriority auf ${prioValue} W für Gerät ${deviceSN} wurde gesendet.`);
            setState(ConfigData.statesPrefix+"."+deviceSN+".setSupplyPriority",prioValue)    
            logDebug('setSupplyPriority updated')
        } else {
            logDebug(`Fehler beim Senden des SupplyPriority-Befehls für Gerät ${deviceSN}:` + err);
        }
    });
    }
}
// Funktion zum Setzen von Parametern (z.B. permanentWatts) ohne client und certification als Parameter
function setPermanentWatts(deviceSN, wattsValue) {
    wattsValue = toInt(Math.round(wattsValue / 10) * 10)
    if (wattsValue > 8000) wattsValue = 8000
    const oldWatts = toInt(getState(ConfigData.statesPrefix+ "." + deviceSN + ".permanentWatts").val)
    if (oldWatts != wattsValue) {

    if (!client || !certification) {
        console.error("MQTT-Client oder Zertifizierung nicht bereit.");
        return;
    }
 
    const setTopic = `/open/${certification.certificateAccount}/${deviceSN}/set`;
 
    const message = {
        id: Date.now(), // Einzigartige ID
        version: "1.0",
        cmdCode: "WN511_SET_PERMANENT_WATTS_PACK", // Befehlscode zum Setzen von permanentWatts
        params: {
            permanentWatts: wattsValue // Der Wert, den du setzen möchtest
        }
    };
    client.publish(setTopic, JSON.stringify(message), (err) => {
        if (!err) {
            logDebug(`Befehl zum Setzen von permanentWatts auf ${wattsValue} W für Gerät ${deviceSN} wurde gesendet.`);
            setState(ConfigData.statesPrefix+"."+deviceSN+".setAC",wattsValue)    
            //if (debug) log ('.setAC updated')
        } else {
            logDebug(`Fehler beim Senden des permanentWatts-Befehls für Gerät ${deviceSN}:` + err);
            reconnect()
            //startMQTTClient()
            //startScript()

        }
    });
    }
}

function setSlowChgWatts(deviceSN, wattsValue) {
    const oldWatts = toInt(getState(ConfigData.statesPrefix+ "." + deviceSN + ".SlowChgWatts").val)
    if (oldWatts != wattsValue) {
    if (!client || !certification) {
        console.error("MQTT-Client oder Zertifizierung nicht bereit.");
        return;
    }
 
    const setTopic = `/open/${certification.certificateAccount}/${deviceSN}/set`;
 
    const message = {
        "id": 1,
        "version": "1.0",
        "moduleType": 3,
        "operateType": "acChgCfg",
        "params": {
            "fastChgWatts": 2400,
            "slowChgWatts": wattsValue,
            "chgPauseFlag": 0
    }
};

   client.publish(setTopic, JSON.stringify(message), (err) => {
        if (!err) {
            logDebug(`Befehl zum Setzen von slowChgWatts auf ${wattsValue} W für Gerät ${deviceSN} wurde gesendet.`);
            setState(ConfigData.statesPrefix+"."+deviceSN+".setAC",toInt(wattsValue))    
        } else {
            logDebug(`Fehler beim Senden des slowChgWatts-Befehls für Gerät ${deviceSN}:` + err);
        }
    });
    }
}

 
function subscribeMQTT(deviceSN) {

    const quotaTopic = `/open/${certification.certificateAccount}/${deviceSN}/quota`;
    const statusTopic = `/open/${certification.certificateAccount}/${deviceSN}/status`;
 
    // Abonnieren des Status-Themas
    client.subscribe(statusTopic, (err) => {
        if (!err) {
            logDebug(`Subscribed to status topic: ${statusTopic}`);
        } else {
            console.error(`Error subscribing to status topic for device ${deviceSN}:` + err);
        }
    });
 
    // Abonnieren des Quota-Themas
    client.subscribe(quotaTopic, (err) => {
        if (!err) {
            logDebug(`Subscribed to quota topic: ${quotaTopic}`);
        } else {
            console.error(`Error subscribing to quota topic for device ${deviceSN}:` + err);
        }
    });
}

function initDevices() {
     for (const xx in ConfigData.PS) {
                PowerStream[xx] = ConfigData.PS[xx].serial
                var deviceSN = PowerStream[xx]
                subscribeMQTT(deviceSN)
            }
            for (const xx in ConfigData.D2M) {
                Delta2Max[xx] = ConfigData.D2M[xx].serial
                var deviceSN = Delta2Max[xx]
                subscribeMQTT(deviceSN)
            }
}

function initDevicesDefault() {
 for (const xx in ConfigData.PS) {
                PowerStream[xx] = ConfigData.PS[xx].serial
                var deviceSN = PowerStream[xx]
                //log (ConfigData.statesPrefix+ "." + deviceSN + '.setAC')
                initMyObjectAsNumber("." + deviceSN + '.setAC',0)
                initMyObjectAsNumber("." + deviceSN + '.setSupplyPriority',0)
                initMyObjectAsNumber("." + deviceSN + '.supplyPriority',0)
                initMyObjectAsNumber("." + deviceSN + '.invOutputWatts',0)
                initMyObjectAsNumber("." + deviceSN + '.batInputWatts',0)
                initMyObjectAsNumber("." + deviceSN + '.pv1InputWatts',0)
                initMyObjectAsNumber("." + deviceSN + '.pv2InputWatts',0)
                initMyObjectAsNumber("." + deviceSN + '.permanentWatts',0)
                initMyObjectAsNumber("." + deviceSN + '.pv1Temp',0)
                initMyObjectAsNumber("." + deviceSN + '.pv2Temp',0)
                initMyObjectAsNumber("." + deviceSN + '.batSoc',0)
                initMyObjectAsNumber("." + deviceSN + '.supplyPriority',0)
                initMyObjectAsNumber("." + deviceSN + '.batErrCode',0)
               
            }
            for (const xx in ConfigData.D2M) {
                Delta2Max[xx] = ConfigData.D2M[xx].serial
                var deviceSN = Delta2Max[xx]
                initMyObjectAsNumber("." + deviceSN + '.setAC',0)
                initMyObjectAsNumber("." + deviceSN + '.soc',0)
                initMyObjectAsNumber("." + deviceSN + '.inputWatts',0)
                initMyObjectAsNumber("." + deviceSN + '.SlowChgWatts',0)

            }
}

// MQTT-Verbindung herstellen und Daten empfangen
async function startMQTTClient() {
    try {
        // Zertifikat aus ioBroker laden, falls vorhanden
        certification = await loadMQTTCertification();
        if (!certification) {
            // Zertifikat neu generieren, wenn es nicht vorhanden ist
            certification = await getMQTTCertification();
        }
 
        client = mqtt.connect(`${mqttProtocol}://${mqttHost}:${mqttPort}`, {
            clientId: 'EcoFlowClient_' + MQTT_Clientid,
            username: certification.certificateAccount,
            password: certification.certificatePassword,
            protocol: mqttProtocol
        });
 
        client.on('connect', () => {
            logDebug('Connected to MQTT broker');
            initDevices();
            // Abonnieren von Status und anderen Daten für jedes Gerät

        });
 
        client.on('message', (topic, message) => {
          //var debug = getState(ConfigData.statesPrefix + ".Debug").val
          logDebug(`Nachricht empfangen von Topic ${topic}: ${message.toString()}`);
          parseMessage (topic,message)
          
        });
 
        client.on('error', (err) => {
            console.error('MQTT connection error:' + err);
            client.end();  // Disconnect on error
            logDebug('Connection terminated due to error ' + err);
        });
 
        client.on('close', () => {
            logDebug('MQTT connection closed');
           // runScript()
        });
 
    } catch (error) {
        console.error('Fehler beim Starten des MQTT-Clients:' + error);
    }
}
// Schließe die Verbindung, wenn das Skript gestoppt wird
onStop(function (callback) {
    if (client) {
        client.end();
        logDebug("Script gestoppt");
    }
    callback();
}, 2000);
// Start der MQTT-Client-Verbindung
startMQTTClient();



setTimeout(() => {
 // Setzt permanentWatts für ein bestimmtes Gerät auf 300 W

    schedule('*/'+ConfigData.runEvery+' * * * * *', function () {

    updateWriteables()
    updateFeedin()
    });
}, 5000);


function initMyObjectAsNumber(myObject, myValue) {
    let debug = ConfigData.Debug
    let myvar = ConfigData.statesPrefix + myObject 
    if(!existsState(myvar)) {
       createState(myvar, myValue, {type: "number"})
       logDebug("creating object: " + myvar + " as number")
    } else {
        logDebug("anscheinend existiert " + myvar + " schon")
    }
}

function initMyObjectAsBoolean(myObject, myValue) {
    //let debug = ConfigData.Debug
    let myvar = ConfigData.statesPrefix + myObject 
    if(!existsState(myvar)) {
       createState(myvar, myValue, {type: "boolean"})
       logDebug("creating object: " + myvar + " as boolean")
    } else {
        logDebug("anscheinend existiert " + myvar + " schon")
    }
}

function initMyObjectAsString(myObject, myValue)
{
//    let debug = ConfigData.Debug
    let myvar = ConfigData.statesPrefix + myObject 
    if(!existsState(myvar)) {
       createState(myvar, myValue, {'type': 'string'})
       logDebug ("creating object: " + myvar + " as string")
    } else {
        logDebug ("anscheinend existiert " + myvar + " schon")
    }
}

function getIntState(myObject, oldvalue) { //returns new value of object or, if empty, the old one
    var value
    if (!isNaN(getState(myObject).val)) {
        value = toInt(getState(myObject).val)
    } else {
        value = oldvalue
        setState(myObject, value)       
    }
    //log (myObject + " " + value)
    return (value)
}

function updateWriteables() {
    for (const xx in PowerStream) {
        const newAC=getState(ConfigData.statesPrefix+ "." + PowerStream[xx] + ".setAC").val
        setPermanentWatts(PowerStream[xx],newAC)
        const newSupplyPrio = getState(ConfigData.statesPrefix+ "." + PowerStream[xx] + ".setSupplyPriority").val
        setSupplyPriority(PowerStream[xx],newSupplyPrio)
    }

    for (const xx in Delta2Max) {
        const newMAC=getState(ConfigData.statesPrefix+ "." + Delta2Max[xx] + ".setAC").val
        setSlowChgWatts(Delta2Max[xx],newMAC)
    }
 }

function reconnect() {
    if (client) {
        client.end(); // Verbindung trennen
        client = null; // Setze client zurück, um sicherzustellen, dass keine veralteten Referenzen verwendet werden
    }
    setTimeout(function () {
        startMQTTClient(); // Neue Verbindung herstellen
        //log("Ecoflow neuverbindung");
    }, 2000); // Wartezeit
}


function updateFeedin() {
    var debug = getState(ConfigData.statesPrefix + ".Debug").val
    const myDate = new Date();
    var myHour = toInt(myDate.getHours().toString().padStart(2, "0"));
    regulate = getState(ConfigData.statesPrefix + '.regulate').val
    if (regulate == false) logDebug("regulate: " + regulate)

    if (myHour == 0) myHour = 24
    logDebug('hour: ' + myHour + ' Myhour < ' + (myHour < (toInt(ConfigData.DoSleepFrom))) + ' >= ' + (myHour >= toInt(ConfigData.DoSleepTo)))

    if (myHour < (toInt(ConfigData.DoSleepFrom)) && myHour >= (toInt(ConfigData.DoSleepTo))) {
        if (regulate == true) {
            bedarf = getState(ConfigData.demand).val * 10
            if (bedarf < 0) bedarf = 0
            logDebug("Total demand: " + bedarf + "W")

            const now = Date.now();
            const ONE_MINUTE = 60 * 1000;

            let psData = PowerStream.map(serial => ({
                serial: serial,
                batSoc: getState(ConfigData.statesPrefix + "." + serial + '.batSoc').val,
                actualOutput: getState(ConfigData.statesPrefix + "." + serial + '.invOutputWatts').val,
                targetWatts: 0, // Will be set in initial distribution
                newTarget: 0,   // Will be used for redistribution
                lastMessage: lastMessageTimes[serial] || 0
            }));

            // Filter active PowerStreams
            //logDebug(JSON.stringify(psData, null, 2));
            let activePowerStreams = psData.filter(ps => 
                (now - ps.lastMessage) < ONE_MINUTE && ps.batSoc > 0
            );

            if (activePowerStreams.length === 0) {
                logDebug('No active PowerStreams found')
                return;
            }

            // Calculate initial distribution based on battery levels
            let totalBatSoc = activePowerStreams.reduce((sum, ps) => sum + ps.batSoc, 0);
            
            // First pass: Set initial targets based on battery levels
            activePowerStreams.forEach(ps => {
                if (ps.batSoc <= toInt(ConfigData.LowerLimitPerecents)) {
                    ps.targetWatts = ConfigData.LowerLimitMaxWatts;
                } else {
                    let share = ps.batSoc / totalBatSoc;
                    ps.targetWatts = Math.min(8000, bedarf * share);
                }
                ps.newTarget = ps.targetWatts; // Initialize newTarget with original target
            });

            // Calculate total shortfall from devices not meeting their targets
            let totalShortfall = 0;
            activePowerStreams.forEach(ps => {
                if (ps.actualOutput < ps.targetWatts * 0.9) { // 10% tolerance
                    let shortfall = ps.targetWatts - ps.actualOutput;
                    totalShortfall += shortfall;
                    logDebug(`${ps.serial}: Shortfall of ${shortfall}W (Target: ${ps.targetWatts}W, Actual: ${ps.actualOutput}W)`);
                }
            });

            // Redistribute shortfall while keeping original targets
            if (totalShortfall > 0) {
                // Sort by capacity to take more load (difference between target and max 8000W)
                let availablePowerStreams = activePowerStreams
                    .filter(ps => ps.actualOutput >= ps.targetWatts * 0.9) // Only use devices meeting their targets
                    .sort((a, b) => (8000 - a.targetWatts) - (8000 - b.targetWatts)); // Sort by available headroom

                for (let ps of availablePowerStreams) {
                    let headroom = 8000 - ps.targetWatts;
                    let additional = Math.min(headroom, totalShortfall);
                    ps.newTarget = ps.targetWatts + additional;
                    totalShortfall -= additional;
                    if (debug) log(`${ps.serial}: Increasing target by ${additional}W to compensate (New target: ${ps.newTarget}W)`);
                    
                    if (totalShortfall <= 0) break;
                }
            }

            // Apply final values - keeping original targets for underperforming units
            activePowerStreams.forEach(ps => {
                setPermanentWatts(ps.serial, Math.round(ps.targetWatts));  // Keep original target
                if (ps.newTarget > ps.targetWatts) {
                    // Only update if we're increasing power to compensate
                    setPermanentWatts(ps.serial, Math.round(ps.newTarget));
                }
                logDebug(`${ps.serial}: Final setting ${Math.round(ps.newTarget)}W (Original target: ${Math.round(ps.targetWatts)}W)`);
            });

        } else {
            logDebug('regulation off');
        }
    } else {
        logDebug('it is sleep time');
    }
}

// Add overall system health monitoring
function checkSystemHealth() {
    const healthStatus = {
        mqttConnected: client && client.connected,
        certificationValid: !!certification,
        activeDevices: 0,
        totalDevices: PowerStream.length + Delta2Max.length,
        lastErrors: []
    };

    // Check device status
    [...PowerStream, ...Delta2Max].forEach(serial => {
        if (lastMessageTimes[serial] && Date.now() - lastMessageTimes[serial] < 60000) {
            healthStatus.activeDevices++;
        }
    });

    // Store health status
    setState(ConfigData.statesPrefix + '.systemHealth', JSON.stringify(healthStatus));

    // Take action if health is poor
    if (healthStatus.activeDevices === 0 || !healthStatus.mqttConnected) {
        console.error('System health check failed, initiating recovery...');
        reconnect();
    }
}

function logDebug(message) {
    if (getState(ConfigData.statesPrefix + ".Debug").val) {
        log(ConfigData.logPrefix + ' ' + message);
    }
}
// Run health check periodically
setInterval(checkSystemHealth, 5 * 60 * 1000); // Every 5 minutes


