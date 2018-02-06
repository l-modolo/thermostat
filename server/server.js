const Express = require('express');
const Pouchdb = require('pouchdb'); // https://pouchdb.com/api.html
const Request = require('request-promise');
const Fs = require('fs');
const Readline = require('readline');


const agenda_url = 'https://calendar.google.com/calendar/ical/.../basic.ics';
const controler_url = 'http://192.168.0.3/temp';
const thermometer_url = 'http://192.168.0.4/temp';
const city_id = '...';
const api_id = '...';
const external_url = 'http://api.openweathermap.org/data/2.5/forecast?id=' +
  city_id +
  '&APPID=' +
  api_id +
  '&units=metric';
const temperature_base = 17.00;
const temperature_max = 22.00;
const heat_lag = 1.50;
var heat_status_lag = 0.0;

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

function get_temp(current_line, re_temp) {
  var temp_found = current_line.replace(re_temp, '$1');
  if (temp_found > temperature_max){
    temp_found = temperature_max;
  }
  var temp_file_found = Fs.createWriteStream('readings/temperature.txt');
  temp_file_found
    .on('open', function(fd) {
      temp_file_found.write("" + temp_found + "");
      temp_file_found.end();
    })
    .on('error', function(err) {
      console.log(err);
    });
  return(temp_found);
}

function default_temp() {
  var temp_file = Fs.createWriteStream('readings/temperature.txt');
  temp_file
    .on('open', function(fd) {
      temp_file.write("" + temperature_base + "");
      temp_file.end();
    })
    .on('error', function(err) {
      console.log(err);
    });
  return(temperature_base);
}

function parse_ics() {
  var re_start = /DTSTART.*:(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2}).*/;
  var re_stop = /DTEND.*:(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2}).*/;
  var re_temp = /SUMMARY:(.*)/;
  var date_start;
  var date_stop = 0;
  var date_now = new Date();
  var temp_found = default_temp();
  var rl = Readline.createInterface({
    input: Fs.createReadStream('readings/thermostat.ics')
  });
  return new Promise(function (fulfill, reject){
    rl.on('line', function (line) {
      if (line.match(re_start)) {
        date_start = match_date( line, re_start );
      }
      if (line.match(re_stop)) {
        date_stop = match_date( line, re_stop );
      }
      if (line.match(re_temp)) {
        if (date_start.getTime() <= date_now.getTime() && date_now.getTime() <= date_stop.getTime()) {
          temp_found = get_temp(line, re_temp);
          rl.close();
        }
        date_start = 0;
        date_stop = 0;
      }
    });
    rl.on('close', function() {
      fulfill(parseFloat(temp_found));
    });
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

////////////////////////////////////////////////////////////////////////////////
///////////////////////////// get temperature captor ///////////////////////////

function get_temperature() {
  return new Promise(function(fulfill, reject) {
    Request(thermometer_url)
    .then(function (body) {
      fulfill(parseFloat(body));
    })
    .catch(function(err) {
      reject(err);
    });
  });
}

function heat() {
  return new Promise( function(fulfill, reject) {
    write_temp().then( function(calendar_temp){
      get_temperature().then( function(thermometer_temp){
        var heat_status = "on";
        if (thermometer_temp <= calendar_temp + heat_status_lag) {
          heat_status = "on";
          heat_status_lag = heat_lag;
        }
        if (thermometer_temp > calendar_temp + heat_status_lag) {
          heat_status = "off";
          heat_status_lag = 0.0;
        }
        fulfill( {heat:heat_status, calendar: calendar_temp, thermometer: thermometer_temp});
      })
      .catch( function(err) {
        reject(err);
      });
    })
    .catch( function(err) {
      reject(err);
    });
  });
}

var app = Express();
app.get('/', function(req, res) {
  heat().then( function(heating) {
    res.send(heating.heat);
    console.log(heating);
  });
});
app.listen(80, () => console.log('server started'));

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
