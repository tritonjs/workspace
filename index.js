/**
 * Workspace Service.
 *
 * @author Jared Allard <jaredallard@outlook.com>
 * @license MIT
 * @version 1.1.0
 **/

let config;
try {
  config  = require('./config/config.json')
} catch(e) {
  console.log('Error:', 'no config found. (./config/config.json)');
  console.log('Stack Trace:', e);
  process.exit(1)
}

global.config = config;

 if(config.debug === undefined || config.debug === true) {
   process.env.DEBUG = 'backend:*,workspace:*'
   process.env.TERM = 'xterm'
 }

 if(config.colors) {
   process.env.DEBUG_COLORS = '1'
 }


const Redis   = require('./lib/redis.js');
const Db      = require('./lib/db.js');
const Auth    = require('./lib/auth.js');
const express = require('express');
const bodyP   = require('body-parser');


let app       = express();
let redis     = Redis();
let db        = new Db(config);
let auth      = new Auth(db);
let workspace = require('./lib/workspace.js')(db, auth, redis);

app.use(bodyP.json());



app.post('/post', (req, res) => {
  if(!req.body.auth || !req.body.ip) {
    return res.send('FAIL');
  }

  workspace.publish(req.body.auth, req.body.ip, err => {
    if(err) {
      console.error(err);
      return res.send('FAIL');
    }

    return res.send('OK')
  })
});

app.post('/start', (req, res) => {
  if(!req.body.username || !req.body.assignment) {
    return res.send('FAIL');
  }

  workspace.start({
    username: req.body.username,
    assignment: req.body.assignment
  }, (err) => {
    if(err) return res.send('FAIL');

    res.send('OK');
  })
})

app.get('/healthcheck', (req, res) => {
  return res.send('OK');
})

app.post('/updateImage', (req, res) => {
  workspace.updateWrapper();

  return res.send('OK');
})

app.post('/heartbeat', (req, res) => {
  if(!req.body.username) {
    return res.send('FAIL');
  }

  workspace.heatbeat({
    username: req.body.username
  }, err => {
    if(err) return res.send('FAIL');

    return res.send('OK');
  });
})

app.listen(80);
