const Express = require('express');
const Request = require('request-promise');
const Bluebird = require('bluebird');
const Fs = require('fs');

function read_config() {
  var data_conf = Fs.readFileSync(__dirname + '/config.json', 'utf8', function(err, data) {
    if (err) {
      console.log("error in read_config(): " + err);
      reject(err);
    }
    return(data);
  });
  data_conf = JSON.parse(data_conf)
  return(data_conf);
}
var config = read_config();

const agenda_url = config.agenda_url;
const controler_url = config.controler_url;
const thermometer_url = config.thermometer_url;
const city_id = config.city_id;
const api_id = config.api_id;
const weather_url = 'http://api.openweathermap.org/data/2.5/forecast?id=' +
  city_id +
  '&APPID=' +
  api_id +
  '&units=metric';
const temperature_base = config.temperature_base;
const temperature_max = config.temperature_max;
const heat_lag = config.heat_lag;
var heat_status_lag = 0.0;
var thermometer_back = {
  temperature: config.temperature_back,
  humidity: 40,
  heatindex: 19
};
var weather_back = {temperature: 10, humidity: 80, heatindex: 8};
var last_thermometer_check = new Date();
var last_calendar_check = new Date();
var last_weather_check = new Date();


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
  return Math.round((HI - 32.00) / 1.8000 * 100) / 100;
}

////////////////////////////////////////////////////////////////////////////////
/////////////////////////// get temperature from agenda ////////////////////////

function default_temp() {
  return(temperature_base);
}

function zero_date() {
  return new Date(0, 0, 0, 0, 0, 0, 0);
}

function get_day(date) {
  var weekday = new Array(7);
  weekday[0] = "SU";
  weekday[1] = "MO";
  weekday[2] = "TU";
  weekday[3] = "WE";
  weekday[4] = "TH";
  weekday[5] = "FR";
  weekday[6] = "SA";
  return(weekday[date.getDay()]);
}

function match_date(line, re, tzone) {
  var year = parseInt(line.replace(re, '$1'));
  var month = parseInt(line.replace(re, '$2')) - 1;
  var day = parseInt(line.replace(re, '$3'));
  var hour = parseInt(line.replace(re, '$4')) + parseInt(tzone);
  var min = parseInt(line.replace(re, '$5'));
  return new Date(year, month, day, hour, min, 0, 0);
}

function match_rep(line, tzone) {
  var re_day = /RRULE:.*BYDAY=(-\d){0,1}([A-Z]{2}).*/;
  var re_until = /RRULE:.*UNTIL=(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2}).*/;
  var day = line.replace(re_day, '$2').slice(0, -1);
  var until = zero_date();
  if (line.match(re_until)) {
    until = match_date(line, re_until, tzone);
  }
  return ({ day: day, until: until });
}

function update_date(date, date_now, dayp) {
  return new Date(
    date_now.getFullYear(),
    date_now.getMonth(),
    date_now.getDate() + dayp,
    date.getHours(),
    date.getMinutes(),
    0, 0
  )
}

function update_event(event, date_now) {
    event.start = update_date(event.start, date_now, 0);
    event.stop = update_date(event.stop, event.start, 0);
    return event;
}

function apply_rep(event, date_now){
  // if no rep rule
  if (event.rep === "") {
    return event;
  }
  // if outdated rule
  if (event.rep.until.getTime() != zero_date().getTime() &&
      event.rep.until.getTime() < date_now.getTime()) {
    return event;
  }
  if (event.rep.day == get_day(date_now)) {
    return update_event(event, date_now);
  }
  return event;
}

function parse_ics_event(lines, date_now, tzone) {
  var re_start = /DTSTART;TZID.*:(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2}).*/;
  var re_stop = /DTEND;TZID.*:(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2}).*/;
  var re_temp = /SUMMARY:(.*)/;
  var re_rep = /RRULE:.*/;
  event = {
    start: zero_date(),
    stop: zero_date(),
    temp: default_temp(),
    rep: ""
  }
  for(i = 0; i < lines.length; i++) {
    if (lines[i].match(re_start)) {
      event.start = match_date( lines[i], re_start, tzone );
    }
    if (lines[i].match(re_stop)) {
      event.stop = match_date( lines[i], re_stop, tzone );
    }
    if (lines[i].match(re_temp)) {
      event.temp = parseFloat(lines[i].replace(re_temp, '$1'));
      if (event.temp > temperature_max){
        event.temp = temperature_max;
      }
    }
    if (lines[i].match(re_rep)) {
      event.rep = match_rep(lines[i], tzone);
    }
  }
  event = apply_rep(event, date_now);
  return event;
}

function parse_ics(body) {
  return new Promise(function (fulfill, reject){
    var re_start = /DTSTART;TZID.*:(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2}).*/;
    var re_tzone = /TZOFFSETTO:+(\d{2})\d{2}.*/;
    var date_now = new Date();
    var temp_found = default_temp();
    var lines = body.split('\n');
    var tzone = "2";
    date_now.setHours(date_now.getHours()+parseInt(tzone));
    var i = 0;
    while(i < lines.length) {
      if (lines[i].match(re_tzone)) {
	tzone = lines[i].replace(re_tzone, '$1');
    	date_now = new Date();
    date_now.setHours(date_now.getHours()+parseInt(tzone));
      }
      if (lines[i].match(re_start)) {
        var event = parse_ics_event(lines.slice(i, i+13), date_now, tzone);
	i = i + 13;
        if (event.start.getTime() <= date_now.getTime() &&
          date_now.getTime() <= event.stop.getTime()) {
          temp_found = event.temp;
	  i = lines.length;
        }
      }
      i = i + 1;
    }
    fulfill(temp_found);
  });
}

function write_temp() {
  return new  Promise(function (fulfill, reject){
    Request(agenda_url)
    .then(function (body) {
      var ics_file = Fs.createWriteStream(__dirname + '/readings/thermostat.ics');
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
      write_ics(body, __dirname + '/readings/thermostat.ics')
    ])
    .then( function (res) {
      last_calendar_check = new Date();
      return res[0];
    });
  })
  .catch( function(err) {
    console.log("error in get_calendar(): " + err);
    return read_ics(__dirname + '/readings/thermostat.ics')
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
  return( Request(thermometer_url + "both")
    .then(function (body) {
      var res = JSON.parse(body);
      thermometer_back = {
        temperature: parseFloat(res.temperature),
        humidity: parseFloat(res.humidity),
        heatindex: heatindex(res.temperature, res.humidity)
      };
      last_thermometer_check = new Date();
      return(thermometer_back);
    })
    .catch(function (err){
      console.log("error: get_thermometer() " + err);
      return(thermometer_back);
    })
  );
}

////////////////////////////////////////////////////////////////////////////////
//////////////////////////// get weather temperature ///////////////////////////

function get_weather() {
  return( Request(weather_url)
    .then(function (body) {
      var res = JSON.parse(body).list[0].main;
      weather_back = {
        temperature: parseFloat(res.temp),
        humidity: parseFloat(res.humidity),
        heatindex: heatindex(res.temp, res.humidity)
      }
      last_weather_check = new Date();
      return(weather_back);
    })
    .catch(function (err){
      console.log("error: get_weather() " + err);
      return(weather_back);
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
    console.log("calendar reading : " + temperatures[0])
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
      calendar_last_check: last_calendar_check.toLocaleString(),
      indoor_temperature: indoor.temperature,
      indoor_humidity: indoor.humidity,
      indoor_hi: indoor.heatindex,
      indoor_last_check: last_thermometer_check.toLocaleString(),
      outdoor_temperature: outdoor.temperature,
      outdoor_humidity: outdoor.humidity,
      outdoor_hi: outdoor.heatindex,
      outdoor_last_check: last_weather_check.toLocaleString(),
      date: date_now.getTime()
    } );
  })
  .catch( function(err) {
    console.log("error heat(): " + err);
    return( {
      heat: heat_status,
      calendar: err,
      calendar_last_check: last_calendar_check.toLocaleString(),
      indoor_temperature: err,
      indoor_humidity: err,
      indoor_hi: err,
      indoor_last_check: last_thermometer_check.toLocaleString(),
      outdoor_temperature: err,
      outdoor_humidity: err,
      outdoor_hi: err,
      outdoor_last_check: last_weather_check.toLocaleString(),
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
  })
  .catch( function(heating) {
    res.send("off");
    console.log(heating2string(heating));
  });
});

app.set('view engine', 'ejs');
app.get('/thermostat', function(req, res) {
  heat().then( function(heating) {
    var heatingstatus = "off";
    if (heating.heat == 1) {
      heatingstatus = "on";
    }
    res.render(
      __dirname + '/view/thermostat',
      {
        heatstatus: heatingstatus,
        heatcal: heating.calendar,
        heatdate: heating.calendar_last_check,
        tempint: heating.indoor_temperature,
        humiint: heating.indoor_humidity,
        hiint: heating.indoor_hi,
        dateint: heating.indoor_last_check,
        tempext: heating.outdoor_temperature,
        humiext: heating.outdoor_humidity,
        hiext: heating.outdoor_hi,
        dateext: heating.outdoor_last_check
      }
    );
    console.log(heating2string(heating));
  }).catch( function(heating) {
    var heatingstatus = "off";
    if (heating.heat == 1) {
      heatingstatus = "on";
    }
    res.render(
      __dirname + '/view/thermostat',
      {
        heatstatus: heatingstatus,
        heatcal: heating.calendar,
        heatdate: heating.calendar_last_check,
        tempint: heating.indoor_temperature,
        humiint: heating.indoor_humidity,
        hiint: heating.indoor_hi,
        dateint: heating.indoor_last_check,
        tempext: heating.outdoor_temperature,
        humiext: heating.outdoor_humidity,
        hiext: heating.outdoor_hi,
        dateext: heating.outdoor_last_check
      }
    );
    console.log(heating2string(heating));
  });
});

app.listen(80);

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
