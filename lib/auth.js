/**
 * Authentication Middleware.
 *
 * @author Jared Allard <jaredallard@outlook.com>
 * @license MIT
 * @version 1.0.0
 **/

'use strict';

const debug  = require('debug')('backend:auth');

module.exports = class Auth {
  constructor(db) {
    this.db = db;
    this.SCRYPT_PARAMS = {N: 10, r:8, p:8};
    debug('constructor', 'setup');
  }

  /**
   * Return a ExpressJS middleware for checking authentication.
   *
   * @return {Function} ExpressJS middleware.
   **/
  requireAuthentication() {
    debug('express', 'generated middleware');

    let db = this.db;

    return (req, res, next) => {
      let PROVIDED_AUTH = req.get('Authentication') || req.body.apikey;
      if(!PROVIDED_AUTH) {
        return res.error(401, 'INVALID_AUTHENTICATION_APIKEY');
      }

      let PROC_AUTH     = PROVIDED_AUTH.split(':');

      if(!PROC_AUTH) {
        return res.error(401, 'INVALID_AUTHENTICATION_APIKEY');
      }

      // processed authentication.
      let API_PUBLIC    = PROC_AUTH[0];
      let API_SECRET    = PROC_AUTH[1];

      db.searchClient('users', [
        ['api.public', '==', API_PUBLIC],
        ['api.secret', '===', API_SECRET]
      ])
      .then(res => {

        debug('checkAuth', 'set req#user -> user')
        debug('checkAuth', 'res ->', res);

        req.user = res;
        req.user.apikey = API_PUBLIC+':'+API_SECRET
        req.user.id = req.user.key

        return next();
      })
      .catch(err => {
        if(err == 'CONDITIONS_NOT_MET') {
          debug('auth', err);
          return res.error(401, 'AUTHENTICATION_INVALID');
        }

        return res.error(500, 'INTERNAL');
      });
    }
  }

  /**
   * Check if an password is valid.
   *
   * @param {String} password - plain text ascii password.
   * @param {String} hash     - hex representation of scrypt.
   *
   * @returns {Boolean} is valid.
   **/
  isValid(password, hash) {
    //Asynchronous with promise
    return new Promise((fulfill, reject) => {
      scrypt.verifyKdf(new Buffer(hash, 'hex'), password)
      .then(valid => {
        debug('isValid', valid);
        return fulfill(valid);
      }, err => {
        return reject(err);
      });
    })
  }

  /**
   * Generate an scrypt hash.
   *
   * @param {String} password - ascii password string.
   *
   * @returns {Promise} with then result of base64 encoded string.
   **/
  generateHash(password) {
    return scrypt.kdf(password, this.SCRYPT_PARAMS)
  }

  /**
   * Get a user object from USERNAME from the database.
   *
   * @param {String} username - user's username
   * @returns {Object} User Object.
   **/
  getUserObject(username) {
    return new Promise((fulfill, reject) => {
      this.db.search('users', 'username', username)
      .then(results => {
        return fulfill(results);
      })
      .catch(err => {
        return reject(err);
      });
    });
  }

  /**
   * Get a user object from their email.
   *
   * @returns {Object} User Object.
   **/
  getUserObjectByEmail(email) {
    return new Promise((fulfill, reject) => {
      this.db.search('users', 'email', email)
      .then(results => {
        return fulfill(results);
      })
      .catch(err => {
        return reject(err);
      });
    });
  }

  getUserKeyByUsername(username) {
    return new Promise((fulfill, reject) => {
      this.db.search('users', 'username', username)
      .then(results => {

        return fulfill(results.key)
      })
      .catch(err => {
        return reject(err);
      });
    });
  }

  getUserWorkspace(username) {
    return new Promise((fulfill, reject) => {
      return this.db.search('users', 'username', username)
      .then(user => {
        if(typeof user.docker !== 'object') {
          return reject('NOT_INITIALIZED');
        }

        return fulfill(user.docker)
      })
      .catch(err => {
        debug('getUserWorkspace', err);
        return reject(err);
      });
    });
  }
}
