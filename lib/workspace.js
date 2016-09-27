/**
 * Control Workspaces.
 *
 * @author Jared Allard <jaredallard@outlook.com>
 * @license MIT
 * @version 0.1.0
 **/

'use strict';

const CONFIG = global.config;
const debug  = require('debug')('workspace:/lib/');
const async  = require('async');
const Docker = require('dockerode');
const Redis  = require('./redis.js');

let docker = new Docker();
let dbctl = null;
let auth  = null;
let redis = null;

let redism = Redis(true);
redism.db = 0; // use production db.

let REdis  = require('ioredis');
let pub  = new REdis(redism);
let sub  = new REdis(redism);

class Workspace {
  constructor(d, a, r) {
    dbctl = d;
    auth  = a;
    redis = r;
  }

  /**
   * Start process:
   * - Setup post boot processor.
   * - Start container
   *
   * @param {Object} req - start object.
   * @param {Function} done - callback
   * @returns {Undefined} nothing
   **/
  start(req, done) {
    async.waterfall([
      // Validate start object.
      next => {
        return next();
      },

      // Setup Post Boot
      next => {
        this.generateAuth({
          username:   req.username,
          assignment: req.assignment
        }, (err, auth) => {
          return next(err, auth);
        })
      },

      // Start Container
      (auth, next) => {
        this.startContainer(req.username, auth, req.assignment, err => {
          return next(err, auth);
        });
      }
    ], (err, auth) => {
      return done(err, auth);
    })
  }


  /**
   * Publish our IP and resolve conflict(s)
   * - Check Auth
   * - Process DB ip_conflicts.
   * - Process redis ip_confilicts.
   * - Publish to DB.
   * - Publish to Redis
   **/
  publish(auth, ip, done) {
    async.waterfall([
      // validate auth
      next => {
        redis.hgetall('auth:'+auth)
          .then(result => {
            debug('auth:result', result)
            if(typeof result !== 'object' || !result.username) {
              return next('INVALID_AUTH');
            }

            return next(null, result);
          })
          .catch(err => {
            debug('pub:auth', err);
            return next(err)
          })
      },

      // Process on DB
      (info, next) => {
        info.ip = ip;
        this.resolveConflictDB(info, err => {
          return next(err, info);
        })
      },

      // Publish to redis.
      (info, next) => {
        this.resolveConflictRedis(info, err => {
          return next(err, info);
        })
      },

      // publish on DB
      (info, next) => {
        this.publishIPDatabase(info, err => {
          return next(err, info);
        })
      },

      // publish on redis.
      (info, next) => {
        this.publishIPRedis(info, err => {
          return next(err);
        });
      },

      next => {
        redis.del('auth:'+auth, result => {
          debug('auth:remove', 'result', result);

          return next();
        });
      }
    ], (err) => {
      return done(err);
    })
  }

  // BELOW ARE "LOW-LEVEL"

  /**
   * Start a new container
   *
   * @param {Object} user       - user object.
   * @param {String} auth       - post init auth token
   * @param {String} assignment - assignment id
   * @param {Function} done     - callback.
   *
   * @returns {undefined}
   **/
  startContainer(user, ath, assignment, done) {
    debug('user', user);

    let username = user;
    async.waterfall([
      (next) => {
        docker.createContainer({
          Image: CONFIG.docker.image,
          ExposedPorts: {
            '80/tcp': {
              HostIp: '0.0.0.0',
              HostPort: '80'
            }
          },
          Labels: {
            'io.rancher.container.network': "true",
            'com.triton.workspace.owner': username,
            'com.triton.workspace.post_auth': ath
          },
          Networks: {
            bridge: {
              Gateway: '172.17.0.1',
              IPPrefixLen: 16
            }
          },
          Env: [
            'POST_AUTH='+ath,
            'BACKEND_1_PORT='+CONFIG.docker.backend_advertise,
            'ASSIGNMENTID='+assignment,
            'USERNAME='+username
          ]
        }, (err, cont) => {
          if(err) {
            debug('start', 'failed to create container', err)
          }
          debug('start', 'container created.');
          return next(err, cont);
        });
      },

      (container, next) => {

        container.inspect((err, data) => {
          if(err) return next(err);
          const ID   = data.Id;

          debug('container', ID)

          auth.getUserObject(user)
          .then(user => {
            let OLD = user.docker.id;

            debug('old container', OLD);
            debug('start:log:db', 'user key is', user.key);

            // rotate IDs
            dbctl.update('users', user.key, {
              docker: {
                id: ID,
                old: OLD
              }
            })
            .then(() => {
              pub.publish('WorkspaceDelete', JSON.stringify({
                username: username
              }));

              return next(null, container);
            })
            .catch(err => {
              debug('start:log:db', 'error', err);
              return next(err);
            })
          })
        });
      },

      // start the container to make sure it has defaults (new IP, etc)
      (container, next) => {
        debug('start', 'starting container');
        return container.start(err => {
          return next(err);
        });
      }
    ], (err) => {
      return done(err);
    });
  }

  /**
   * Register the (new) IP of a workspace's container.
   *
   * @param {String} username   - username
   * @param {String} assignment - assignment
   * @param {Function} done - callback
   **/
  publishIPDatabase(info, done) {
    auth.getUserKeyByUsername(info.username)
    .then(key => {
      debug('start:db', 'user key is', key);
      dbctl.update('users', key, {
        docker: {
          ip: info.ip,
          username: info.username,
          assignment: info.assignment
        }
      })
      .then(() => {
        return done(null);
      })
      .catch(err => {
        debug('start:db', 'error', err);
        return done(err);
      })
    })
    .catch(err => {
      debug('start:auth', 'error', err);
      return done(err);
    });
  }

  /**
   * Publish an IP to redis.
   *
   * @param {Object} info - container object.
   * @param {Function} done - callback.
   **/
  publishIPRedis(info, done) {

    auth.getUserObject(info.username)
    .then(user => {
      let redism = Redis(true);
      redism.db = 0; // use production db.

      let REdis  = require('ioredis');
      let redis  = new REdis(redism);

      info.apikey = user.api.public+':'+user.api.secret;

      debug('redis', 'begin')
      debug('redis', 'info is -> ', info)

      let info_str;
      try {
        info_str = JSON.stringify(info)
      } catch(e) {
        return debug('redis:strigify', 'failed to convert object to JSON');
      }

      // set it and pub the new information.
      redis.set(info.username, info_str);
      pub.publish('NewWorkspace', info_str)

      return done();
    })
    .catch(err => {
      return done(err);
    })
  }

  /**
   * Resolve IP conflicts on the DB.
   *
   * @param {Object} info - db#info
   * @param {Function} done   - callback.
   *
   * @returns {Undefined} use cb.
   **/
  resolveConflictRedis(info, done) {
    let redism = Redis(true);
    redism.db = 0; // use production db.

    let REdis  = require('ioredis');
    let redis  = new REdis(redism);

    // clean up redis mismatche(s)
    let stream = pub.scanStream();
    let getpipe = redis.pipeline();

    // stream add the keys into the pipeline.
    stream.on('data', (resultKeys) => {
      for(let i = 0; i < resultKeys.length; i++) {
        debug('add user to pipe', resultKeys[i]);
        getpipe.get(resultKeys[i]);
      }
    });

    // execute the pipeline after it's finished streaming the keys.
    stream.on('end', () => {
      let setpipe = redis.pipeline()
      getpipe.exec((err, res) => {
        res.forEach((namecontainer) => {
          let container = namecontainer[1];

          try {
            container = JSON.parse(container);
          } catch(e) {
            debug('redis:invalid_res:ip_conflict', 'received invalid JSON response.');
            console.log('resp', container);
            return;
          }

          debug('redis:ip_conflict', 'process', container);
          if(container.ip === info.ip) {
            let newContainer = container;

            // invalidate the container.
            newContainer.ip = null;
            newContainer = JSON.stringify(newContainer);

            setpipe.set(container.username, newContainer)
            pub.publish('WorkspaceConflict', newContainer);
          }
        });

        setpipe.exec((err) => {
          return done(err);
        })
      });
    })
  }

  /**
   * Resolve IP conflicts on the DB.
   *
   * @param {Object} info - container object.
   * @param {Function} done   - callback.
   *
   * @returns {Undefined} use cb.
   **/
  resolveConflictDB(info, done) {
    dbctl.search('users', 'docker.ip', info.ip, true)
    .then(cursor => {
      cursor.all().then(vals => {
        async.each(vals, (w, done) => {
          w = dbctl._transform(w);

          debug('users', 'process', w);

          // match the values or return
          if(w.docker.ip !== info.ip) {
            debug('users', 'fetched ip doesn\'t match ip');
            return done();
          }

          dbctl.update('users', w.key, {
            docker: {
              ip: null
            }
          })
          .then(() => {return done()}).catch(done);
        }, e => {
          if(e) return done(e);

          debug('start:ip_conflict', 'resolved all conflict(s)')

          return done(false);
        });
      });
    })
    .catch(err => {
      debug('users', 'err', err);
      if(err === 'CONDITIONS_NOT_MET') return done(false);

      debug('start:ip_conflict:err', err);
      return done(err);
    })
  }

  /**
   * Generate a POST AUTH token.
   *
   * @param {Object} container - container
   * @param {Function} done - callback
   **/
  generateAuth(container, done) {
    if(!container.username || !container.assignment) {
      return cb('INVALID_GENREQ');
    }

    require('crypto').randomBytes(64, (err, buffer) => {
      let token = buffer.toString('hex');

      redis.hmset('auth:'+token,
        'username',   container.username,
        'assignment', container.assignment,
        'status',     'init'
      );

      return done(err, token);
    });
  }

  /**
   * Verify the POST process of generating a workspace.
   *
   * @param {Object} container - container.
   * @param {Function} cb - callback.
   **/
  postBoot(container, cb) {
    if(!container.auth) {
      return cb('NO_AUTH');
    }

    /**
      {
        ip: <ip>
      }
    */
  }
}


sub.on('message', (channel, message) => {
  let p = JSON.parse(message);

  auth.getUserWorkspace(p.username)
  .then(cont => {
    debug('start:select', 'ID is', cont.old);

    let container = docker.getContainer(cont.old);
    container.stop(err => {
      if(err) {
        return debug('container:stop', 'failed to stop', err);
      }

      container.remove(err => {
        if(err) return debug('container:remove', 'failed to remove', err);

        debug('container:remove', 'removed', cont.old);
      })

      debug('container:stop', 'stopped', cont.old);
    })
  })
  .catch(err => {
    if(err) {
      return debug('container:stop', 'failed to stop', err);
    }
  });
})

sub.subscribe('WorkspaceDelete');


/**
 * wrap around the instancer olf workspace class
 */
module.exports = (d, a, r) => {
  return new Workspace(d, a, r)
}
