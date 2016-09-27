/**
 * Get a redis instance from Docker or host.
 *
 * @author Jared Allard <jaredallard@outlook.com>
 * @license MIT
 * @version 1.0.0
 **/

const url   = require('url');
const debug = require('debug')('backend:redis')
const redis = require('ioredis');

let REDIS = {
  parser: 'hiredis',
  dropBufferSupport: true,
  db: 1
};

let Redis = (only_meta) => {

  // init redis
  let redis_string = process.env.REDIS_1_PORT || process.env.REDIS_PORT;

  if(redis_string) {
    let redis_url    = url.parse(redis_string);

    debug('init', 'using docker');
    REDIS.host = redis_url.hostname;
    REDIS.port = redis_url.port;
  } else {
    debug('init', 'not on docker, assuming defaults');

    REDIS.host = '127.0.0.1';
    REDIS.port = 6379;
  }


  debug('redis', 'found redis on', REDIS.host+':'+REDIS.port);

  if(only_meta) {
    return REDIS;
  }

  return new redis(REDIS)
}

module.exports = Redis;
