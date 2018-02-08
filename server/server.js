const Express = require('express');
const Pouchdb = require('pouchdb'); // https://pouchdb.com/api.html
const Request = require('request-promise');
const Bluebird = require('bluebird');
const Fs = require('fs');
const Readline = require('readline');


const agenda_url = 'https://calendar.google.com/calendar/ical/.../basic.ics';
const controler_url = 'http://192.168.0.3/';
const thermometer_url = 'http://192.168.0.4/';
const city_id = '...';
const api_id = '...';
const weather_url = 'http://api.openweathermap.org/data/2.5/forecast?id=' +
  city_id +
  '&APPID=' +
  api_id +
  '&units=metric';
const temperature_base = 17.00;
const temperature_max = 22.00;
const heat_lag = 1.50;
var heat_status_lag = 0.0;


function heatindex(temperature, humidity) {
  var T = temperature * 1.8000 + 32.0;
  var RH = humidity;
  var HI = -42.379 + 2.04901523*T + 10.14333127*RH - 0.22475541*T*RH - 0.00683783*T*T - 0.05481717*RH*RH + 0.00122874*T*T*RH + 0.00085282*T*RH*RH - 0.00000199*T*T*RH*RH;
  if (RH < 13.0) {
    if (80.0 < T && T < 120.0 ){
      HI = HI - ((13.0-RH)/4.0) * Math.sqrt((17.0-Math.abs(T-95.0))/17.0);
    }
  }
  if (RH > 85.0) {
    if (80.0 < T && T < 87.0 ){
      HI = HI + ((RH-85.0)/10.0) * ((87.0-T)/5.0);
    }
  }
  if (HI < 80.0) {
    HI = 0.5 * (T + 61.0 + ((T-68.0)*1.2) + (RH*0.094));
  }
  return (HI - 32.00) / 1.8000;
}

////////////////////////////////////////////////////////////////////////////////
/////////////////////////// get temperature from agenda ////////////////////////

function match_date(line, re) {
  var year = line.replace(re, '$1');
  var month = line.replace(re, '$2') - 1;
  var day = line.replace(re, '$3');
  var hour = line.replace(re, '$4');
  var min = line.replace(re, '$5');
  return new Date(year, month, day, hour, min, 0, 0);
}

function default_temp() {
  return(temperature_base);
}

function parse_ics(body) {
  return new Promise(function (fulfill, reject){
    var re_start = /DTSTART.*:(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2}).*/;
    var re_stop = /DTEND.*:(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2}).*/;
    var re_temp = /SUMMARY:(.*)/;
    var date_start;
    var date_stop = 0;
    var date_now = new Date();
    var temp_found = default_temp();
    var lines = body.split('\n');
    for(i = 0; i < lines.length; i++) {
      if (lines[i].match(re_start)) {
        date_start = match_date( lines[i], re_start );
      }
      if (lines[i].match(re_stop)) {
        date_stop = match_date( lines[i], re_stop );
      }
      if (lines[i].match(re_temp)) {
        if (date_start.getTime() <= date_now.getTime() &&
            date_now.getTime() <= date_stop.getTime()) {
          temp_found = lines[i].replace(re_temp, '$1');
          if (temp_found > temperature_max){
            temp_found = temperature_max;
          }
        }
        date_start = 0;
        date_stop = 0;
      }
    }
    fulfill(parseFloat(temp_found));
  });
}

function write_temp() {
  return new  Promise(function (fulfill, reject){
    Request(agenda_url)
    .then(function (body) {
      var ics_file = Fs.createWriteStream('readings/thermostat.ics');
      ics_file.on('open', function(fd) {
        ics_file.write(body);
	ics_file.end();
      });
      ics_file.on('end', function(fd) {
      });
    })
    .then(function (body) {
      fulfill(parse_ics());
    })
    .catch(function (err) {
      reject(err);
    });
  });
}

function write_ics(body, file) {
  return new Promise( function(fulfill, reject) {
    Fs.writeFile(file, body, function(err) {
      if (err) {
        console.log("error in write_ics(): " + err);
        reject(err);
      }
      fulfill("ics writen");
    });
  });
}

function read_ics(file) {
  return new Promise( function(fulfill, reject) {
    Fs.readFile(file, 'utf8', function(err, data) {
      if (err) {
        console.log("error in read_ics(): " + err);
        reject(err);
      }
      fulfill(data);
    });
  });
}

function get_calendar(){
  return Request(agenda_url)
  .then( function(body) {
    return Bluebird.all([
      parse_ics(body),
      write_ics(body, 'readings/thermostat.ics')
    ])
    .then( function (res) {
      return res[0];
    });
  })
  .catch( function(err) {
    console.log("error in get_calendar(): " + err);
    return read_ics('readings/thermostat.ics')
    .then( function(body) {
      return parse_ics(body)
      .then( function (res) {
        return res;
      });
    });
  });
}

////////////////////////////////////////////////////////////////////////////////
///////////////////////////// get temperature captor ///////////////////////////

function get_thermometer() {
  return( new Promise(function(fulfill, reject){
    fulfill({
      temperature: 18.6,
      humidity: 32.8,
      heatindex: heatindex(18.6, 32.8)
      });
    }));
  return( Request(thermometer_url + "both")
    .then(function (body) {
      var res = JSON.parse(body);
      return({
        temperature: parseFloat(res.temperature),
        humidity: parseFloat(res.humidity),
        heatindex: heatindex(res.temperature, res.humidity)
      });
    })
    .catch(function (err){
      console.log("error: get_thermometer() " + err);
      return({
        temperature: err,
        humidity: err,
        heatindex: err
      });
    })
  );
}

////////////////////////////////////////////////////////////////////////////////
//////////////////////////// get weather temperature ///////////////////////////

function get_weather() {
  return( Request(weather_url)
    .then(function (body) {
      var res = JSON.parse(body).list[0].main;
      return({
        temperature: parseFloat(res.temp),
        humidity: parseFloat(res.humidity),
        heatindex: heatindex(res.temp, res.humidity)
      });
    })
    .catch(function (err){
      console.log("error: get_weather() " + err);
      return({
        temperature: err,
        humidity: err,
        heatindex: err
      });
    })
  );
}

////////////////////////////////////////////////////////////////////////////////
////////////////////////////// set heating status //////////////////////////////

function heat() {
  var heat_status = 0;
  var date_now = new Date();
  return Bluebird.all([
    get_calendar(),
    get_thermometer(),
    get_weather()
  ])
  .then( function ( temperatures ) {
    calendar_temp = temperatures[0];
    indoor = temperatures[1];
    outdoor = temperatures[2];
    if (indoor.temperature <= calendar_temp + heat_status_lag) {
      heat_status = 1;
      heat_status_lag = heat_lag;
    }
    if (indoor.temperature > calendar_temp + heat_status_lag) {
      heat_status = 0;
      heat_status_lag = 0.0;
    }
    return( {
      heat: heat_status,
      calendar: calendar_temp,
      indoor_temperature: indoor.temperature,
      indoor_humidity: indoor.humidity,
      indoor_hi: indoor.heatindex,
      outdoor_temperature: outdoor.temperature,
      outdoor_humidity: outdoor.humidity,
      outdoor_hi: outdoor.heatindex,
      date: date_now.getTime()
    } );
  })
  .catch( function(err) {
    console.log("error heat(): " + err);
    return( {
      heat: heat_status,
      calendar: err,
      indoor_temperature: err,
      indoor_humidity: err,
      indoor_hi: err,
      outdoor_temperature: err,
      outdoor_humidity: err,
      outdoor_hi: err,
      date: date_now.getTime()
    } );
  });
}

function heating2string(heating){
  return(
    heating.date + ", " +
    heating.heat + ", " +
    heating.calendar + ", " +
    heating.indoor_temperature + ", " +
    heating.indoor_humidity + ", " +
    heating.indoor_hi + ", " +
    heating.outdoor_temperature + ", " +
    heating.outdoor_humidity + ", " +
    heating.outdoor_hi
  );
}

var app = Express();
app.get('/', function(req, res) {
  heat().then( function(heating) {
    if (heating.heat == 1) {
	    res.send("on");
    } else {
	    res.send("off");
    }
    console.log(heating2string(heating));
  }).catch( function(heating) {
    res.send("off");
    console.log(heating2string(heating));
  });
});

app.get('/thermostat', function(req, res) {
  heat().then( function(heating) {
    res.send(heating2string(heating));
    console.log(heating2string(heating));
  }).catch( function(heating) {
    res.send(heating2string(heating));
    console.log(heating2string(heating));
  });
});

app.listen(8080);

// .then({

// });
//
//
// var db = new Pouchdb('temperatures');
//
// db.info().then(function (info) {
//   console.log(info);
// });
// var date = new Date();
// var temp_record = {
//   "_id": date.now(),
//   "internal": request(controler_url, function (error, response, body) {
//       return body;
//     }),
//   "thermometer": request(controler_url, function (error, response, body) {
//       return body;
//     }),
//   "external": request(external_url, function (error, response, body) {
//       return JSON.parse(body)[0].main.temp;
//     }),
//   "status": "on",
//   "status_lag": "timestamp"
// };
// db.put(temp_record);
//
// db.allDocs({
//   startkey: "startkey",
//   endkey: "endkey"
// }).then(function (result) {
//   // handle result
// }).catch(function (err) {
//   console.log(err);
// });

// var app = Express();
//
// app.get('/', (req, res) => res.send('Hello World!'));
//
// app.listen(8080, () => console.log('Example app listening on port 3000!'));
//
// const express = require('express');
// const path = require('path');
// const bodyParser = require('body-parser');
// const app = express();
//
// app.engine('html', require('ejs').renderFile);
// app.set('view engine', 'html');
//
// // on a un formulaire html sur l'adresse contacts
// app.get('/contact', function (req, res) {
//   res.sendFile(__dirname + '/vues/contact.html');
// });
//
// // par défaut node ne parse pas ce qui se trouve dans POST
// app.use('/public', express.static('static'));
// app.use(bodyParser.urlencoded({extended:true}));
//
// app.get('/contact', function (req, res) {
//   res.sendFile(__dirname + '/vues/contact.html');
// });
//
// app.post('/', function (req, res) {
//   var msg = req.body.message;
//   res.render(__dirname + '/vues/response',{msg:msg});
// });
