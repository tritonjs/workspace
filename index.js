/**
 * Workspace Service.
 *
 * @author Jared Allard <jaredallard@outlook.com>
 * @license MIT
 * @version 1.1.0
 **/

const config = require('./lib/config.js');

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
const raven   = require('raven');

// catch exceptions for sentry
if(config.enabled.sentry) {
  console.log('NOTICE: Sentry *is* enabled.')
  let client = new raven.Client(config.sentry.DSN);
  client.patchGlobal();
}

let app       = express();
let redis     = Redis();
let db        = new Db(config);
let auth      = new Auth(db);
let workspace = require('./lib/workspace.js')(db, auth, redis);

/**
 * sentry
 **/
if(config.sentry.enabled) app.use(raven.middleware.express.requestHandler(config.sentry.DSN));
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
    return res.status(400).send('FAIL');
  }

  workspace.heartbeat(req.body.username, err => {
    if(err) return res.status(400).send('FAIL');

    return res.status(200).send('OK');
  });
})

if(config.sentry.enabled) app.use(raven.middleware.express.errorHandler(config.sentry.DSN));

app.listen(80);
