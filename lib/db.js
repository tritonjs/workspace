/**
 * Database Layer.
 *
 * @author Jared Allard <jaredallard@outlook.com>
 * @license MIT
 * @version 0.1.0
 **/

'use strict';

const arangojs = require('arangojs');
const aqb      = require('aqb');
const debug    = require('debug')('backend:db');
const async    = require('async');
const url      = require('url');

class DB {
  constructor(config) {
    if(typeof config !== 'object') {
      throw 'No Config'
      return null;
    }

    let user = config.db.user;
    let pass = config.db.password;
    let host = config.db.host;
    let port = config.db.port;
    let db   = config.db.name;

    debug('constructor:host', 'set', host)

    if(host === '<env>') {
      // docker stuff.
      let db_string = process.env.DB_1_PORT || process.env.DB_PORT;

      let db_url    = url.parse(db_string);

      if(!db_url) {
        debug('constructor:host', 'set to <env> but didn\'t find docker');
        process.exit(1);
      }

      debug('constructor:host', 'using docker');
      host = db_url.hostname;
      port = db_url.port;
    }

    debug('constructor:host', 'db ->', host, port)
    this.db     = arangojs({
      url: `http://${user}:${pass}@${host}:${port}`,
      databaseName: db
    });


    this.config = config.db;

    debug('constructor', 'success');
  }

  /**
   * Init the Database
   *
   * @param {Function} cb - callback.
   * @returns undefined
   **/
  init(cb) {
    this.db.useDatabase('_system');
    async.waterfall([
      (next) => {
        this.db.createDatabase(this.config.name)
        .then(info => {
          next();
        })
        .catch(err => next(err))
      },

      // create the collectons
      (next) => {
        this.db.useDatabase(this.config.name)
        async.eachSeries(this.config.collections, (c, next) => {
          debug('init:collections', 'create', c)
          let col = this.db.collection(c);
          col.create().then(() => {
            next();
          }).catch(err => {
            next(err);
          })
        }, err => {
          if(err) return next(err);

          next();
        });
      }
    ], err => {
      if(err) {
        if(err.code === 409) {
          debug('init', 'db is OK')
        } else {
          console.log('INIT: DB connect fail, try again in 2000ms');

          setTimeout(() => {
            return this.init(cb);
          }, 2000)
        }
      }

      debug('init', 'using db:', this.config.name)
      this.db.useDatabase(this.config.name);

      return cb();
    })
  }

  /**
   * Search, but pull all results and process on the client side.
   *
   * @param {String} collection - to search through.
   * @param {Array} params      - conditions, all eq.
   *
   * @returns {Promise} I PROMISE
   **/
  searchClient(collection, params) {
    // example
    /*
      params = [
        ['mykey', '==', 'value']
      ]
    */
    return new Promise((fulfill, reject) => {
      debug('searchClient', 'query', collection);

      return this.db.query(
        aqb.for('u')
        .in(collection)
        .return('u')
      )
      .then(cursor => {
        debug('searchClient', 'got cursor back')

        // retrieve all the cursor values.
        cursor.all()
        .then(vals => {
          // if nothing, or vals object empty, reject.
          if(!vals || !vals[0]) return reject('CONDITIONS_NOT_MET')

          debug('searchClient', 'exhausted cursor.')
          vals.forEach(val => {
            let pint = val.data_wrapper;
            let req  = params.length;
            let met  = 0;

            // process each param.
            params.forEach(con => {
              let key = con[0]; // key to eval against.
              let opr = con[1]; // operator (equals, etc.)
              let val = con[2]; // value it should meet.

              let KEY = pint[key];

              // map dot notation.
              if(key.indexOf('.') !== -1) {
                KEY = key.split('.').reduce((o,i)=>o[i], pint);

                debug('searchClient', key, '->', KEY);
              }

              let res = false;

              // equal operator.
              if(opr == '==' || opr == '===') res = KEY === val;

              // not equal operator.
              if(opr == '!=' || opr == '!==') res = KEY !== val;

              if(!res) {
                debug(KEY, '~?', val);
                return;
              }

              met++;
            })

            // if all met, return.
            if(met === req) {
              debug('searchClient', 'all conditions met');

              val.data_wrapper.key = val._key;
              return fulfill(val.data_wrapper)
            }
          });

          // last of all, fail
          return reject('CONDITIONS_NOT_MET');
        })
      })
    })
  }

  _transform(data) {
    let trf = data.data_wrapper;
    trf.key = data._key;

    return trf;
  }

  /**
   * Search using the DB filter.
   *
   * @param {String} collection - collection to "use"
   * @param {String} key        - key to match against.
   * @param {Var}    value      - value to match.
   * @param {Bool}   raw        - return raw cursor instead of data.
   *
   * @returns {Promise} promise object.
   **/
  search(collection, key, value, raw) {
    debug('search', 'collection ->', collection);
    debug('search', key, '->', value)

    let KEY = 'u.data_wrapper.'+key;

    debug('search', 'filter key set:', KEY);
    return new Promise((fulfill, reject) => {
      return this.db.query(
        aqb.for('u')
        .in(collection)
        .filter(aqb.eq(KEY, '@value'))
        .return('u'),
        {
          value: value
        }
      )
      .then(cursor => {
        debug('search', 'cursor fetched');
        if(raw) {
          debug('search', 'returning raw cursor')
          return fulfill(cursor);
        }

        cursor.next()
        .then(val => {
          debug('search', 'cursor->next')
          if(!val) return reject('CONDITIONS_NOT_MET');
          debug('search', 'cursor:', val)
          return fulfill(this._transform(val));
        })
      })
      .catch(reject);
    });
  }

  /**
   * Return all the results of dataset.
   *
   * @param {String} collection - collection name
   * @returns {Promise} std promise done/catch.
   **/
  all(collection) {
    return new Promise((fulfill, reject) => {
      this.db.query(
        aqb.for('u')
        .in(collection)
        .return('u')
      )
      .then(cursor => {
        cursor.all()
        .then(fulfill);
      })
      .catch(reject);
    });
  }

  /**
   * Get a Key's value.
   *
   * @param {String} collection - collection to search in.
   * @param {String} key - key path.
   *
   * @returns {Promise} w/ data on success.
   **/
  get(collection, key) {
    return new Promise((fulfill, reject) => {
      debug('get', collection+'/'+key)
      this.db.query(
        'RETURN DOCUMENT("'+collection+'/'+key+'")' // use something cleaner
        // collection.lookUpKey?
      )
      .then(cursor => {
        cursor.all()
        .then(data => {
          fulfill(data[0].data_wrapper);
        });
      })
      .catch(reject);
    });
  }

  /**
   * Post Data into a collection
   *
   * @param {String} collection - to insert into.
   * @param {*} data - data to insert.
   *
   * @returns {Promise} API Result.
   **/
  post(collection, data) {
    return this.put(collection, null, data);
  }

  /**
   * Put Data into a collection
   *
   * @param {String} collection - to insert into.
   * @param {String} key - key to insert into.
   * @param {*} data - data to insert.
   *
   * @returns {Promise} API Result.
   **/
  put(collection, key, data) {
    let DATA = {
      data_wrapper: data
    };

    if(key) {
      debug('put', 'manually specified key:', key);
      DATA._key = key;
    }

    return this.db.query(aqb.insert(aqb(DATA)).into(collection));
  }

  /**
   * Post Data into a collection
   *
   * @param {String} collection  - to interact with
   * @param {String} key         - key to remove.
   *
   * @returns {Promise} API Result.
   **/
  remove(collection, key) {
    return this.db.query(arangojs.aql`
      REMOVE "${key}" IN ${collection}
    `)
  }

  /**
   * Update the data in a collection
   *
   * @param {String} collection - to insert into.
   * @param {String} key        - key to modify
   * @param {*} data          - data to update with.
   *
   * @returns {Promise} promise.
   **/
  update(collection, key, data) {
    let DATA = {
      data_wrapper: data
    };

    debug('update', 'with', DATA)

    let col = this.db.collection(collection);

    return col.update(key, DATA)
  }
}

module.exports = DB;
