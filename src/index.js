import LRU from 'lru-cache';
import crypto from 'crypto';
import address from 'network-address';
import querystring from 'querystring';
import Etcd from 'node-etcd';
import _ from 'lodash';
import assert from 'assert';
require('source-map-support').install();
/* eslint no-param-reassign:[0] */

const noop = () => {};

const sha1 = (val) => crypto.createHash('sha1').update(val).digest('hex');

const safeJSONParse = (c) => {
  let r;
  try {
    r = JSON.parse(c);
  } catch (e) {
    r = null;
  }
  return r;
};

const parseSetting = (val) => {
  if (!val) {
    return undefined;
  }
  if (val === 'false') {
    return false;
  }
  if (val === 'true') {
    return true;
  }
  if (/^\d+$/.test(val)) {
    return parseInt(val, 10);
  }
  return val;
};

const parseConnectionString = (url) => {
  const opts = {};

  let hosts;
  if (!url || typeof url === 'object') {
    _.defaults(opts, url);
    hosts = url.url || url.hosts;
  } else {
    hosts = url;
    if (/^https:\/\/discovery.etcd.io\//.test(hosts)) {
      opts.token = hosts;
    }
  }

  const parsed = hosts.match(/^([^:]+:\/\/)?([^\/]+)(?:\/([^\?]+))?(?:\?(.+))?$/);
  if (!parsed) {
    throw new Error('Invalid connection string');
  }

  const protocol = parsed[1] || 'http://';
  const qs = querystring.parse(hosts.split('?')[1]);

  opts.namespace = parsed[3] || '';
  opts.refresh = !!parseSetting(qs.refresh);
  opts.cache = parseSetting(qs.cache);
  opts.hosts = parsed[2].split(/,\s*/).map((hostsPart) => protocol + hostsPart);

  return opts;
};


export default class Registry {
  constructor(opts) {
    opts = parseConnectionString(opts);
    this.store = new Etcd(opts.hosts, opts);
    this.cache = new LRU(opts.cache || 100);
    this.destroyed = false;
    this.services = [];
    this.maxRetries = opts.maxRetries;
    this.monitoredServices = {};
    this.activeServiceMonitors = {};
    this.ns = (opts.namespace || '').replace(/^\//, '').replace(/([^\/])$/, '$1/');
  }

  prefixKey(key) {
    return `services/${this.ns}${key}`;
  }

  normalizeKey(key) {
    return key.replace(/[^a-zA-Z0-9\-]/g, '-');
  }

  join({ name,
         service,
         ttl,
       }, cb) {
    assert(!_.isNil(name), 'Name should be defined');
    assert(cb === undefined || _.isFunction(cb), 'Callback should be a function');
    assert(_.isNil(ttl) || (_.isInteger(ttl) && ttl > 0),
           'ttl should be an integer greater than zero');

    if (typeof service === 'number') {
      service = { port: service };
    }

    if (!service) {
      service = {};
    }

    cb = cb || noop;

    service.name = name;
    service.hostname = service.hostname || address();
    service.host = service.host ||
      (service.port ? `${service.hostname}:${service.port}` : service.hostname);
    service.url = service.url || `${service.protocol || 'http'}://${service.host}`;

    const nameAndUrl = `${name}-${service.url}`;
    const key = this.prefixKey(`${this.normalizeKey(name)}/${sha1(nameAndUrl)}`);

    const value = JSON.stringify(service);
    const entry = { name,
                    key,
                    destroyed: false,
                    timeout: null,
                  };

    const update = (callback) => this.store.set(key,
                                                value,
                                                { ttl,
                                                  maxRetries: this.maxRetries,
                                                }, callback);
    const loop = () => update((err) => {
      if (entry.destroyed) {
        return;
      }
      entry.timeout = setTimeout(loop, err ? (ttl * 1.5) * 1000 : (ttl / 2) * 1000);
    });


    const onError = (err) => this.leave([entry],
                                        () => {
                                          cb(err);
                                        });

    this.services.push(entry);
    update((err) => {
      if (err) {
        onError(err);
        return;
      }
      if (this.destroyed) {
        onError(new Error('registry destroyed'));
        return;
      }

      entry.timeout = setTimeout(loop, (ttl / 2) * 1000);
      cb(undefined, service);
    });
  }

  lookup(name, cb) {
    if (typeof name === 'function') {
      cb = name;
      name = null;
    }
    this.list(name, (err, list) => cb(err, _.sample(list)));
  }

  monitorContents(name) {
    if (_.isNil(this.activeServiceMonitors[name])) {
      throw new Error(`No active service monitor for ${name}`);
    }

    return _.values(this.monitoredServices[name]);
  }

  monitorStop(name) {
    const m = this.activeServiceMonitors[name];
    if (!_.isNil(m)) {
      m.stop();
      delete this.activeServiceMonitors[name];
    }
  }

  monitorStart(name) {
    if (this.activeServiceMonitors[name]) {
      return;
    }
    // Fake this.
    let shouldCancel = false;
    this.activeServiceMonitors[name] = {
      stop: () => {
        shouldCancel = true;
      },
    };
    this.monitoredServices[name] = {};

    const pullFullList = () => this.list(name, (err, results, rawResult) => {
      // Already got stopped before we got started.
      if (shouldCancel) {
        return;
      }
      this.monitoredServices[name] = _.groupBy(results, 'url');

      let startIndex;
      if (rawResult.error && rawResult.error.index) {
        startIndex = rawResult.error.index;
      } else {
        assert(1 !== 0);
      }
      const w = this.store.watcher(this.prefixKey(name),
                                   startIndex,
                                   { recursive: true });
      this.activeServiceMonitors[name] = w;

      w.on('change', (record) => {
        if (record.action === 'set') {
          const c = safeJSONParse(record.node.value);
          if (!_.isNil(c.url)) {
            this.monitoredServices[name][c.url] = c;
          }
        } else if (record.action === 'delete' || record.action === 'expire') {
          const c = safeJSONParse(record.prevNode.value);
          if (!_.isNil(c.url)) {
            delete this.monitoredServices[name][c.url];
          }
        } else if (record.action === 'reconnect') {
          w.stop();
          pullFullList();
        } else if (record.action === 'resync') {
          w.stop();
          pullFullList();
        }
      });
    });

    pullFullList();
  }

  list(name, cb) {
    if (typeof name === 'function') {
      cb = name;
      name = null;
    }

    if (name) {
      name = this.normalizeKey(name);
    }

    this.store.get(
      this.prefixKey(name || ''),
      { recursive: true,
        maxRetries: this.maxRetries,
      },
      (err, result) => {
        if (err) {
          if (err.errorCode && err.errorCode === 100) {
            // Not found
            cb(undefined, [], err);
            return;
          }
          cb(err);
          return;
        }

        if (!result || !result.node || !result.node.nodes) {
          cb(undefined, [], result);
          return;
        }

        cb(undefined,
           _.filter(_.map(result.node.nodes, ({ value }) => safeJSONParse(value))),
           result);
      });
  }

  leaveList(list, cb) {
    const loop = () => {
      const next = list.shift();

      if (!next) {
        cb();
        return;
      }

      clearTimeout(next.timeout);
      next.destroyed = true;

      const i = this.services.indexOf(next);
      if (i > -1) {
        this.services.splice(next, 1);
      }
      this.store.del(next.key, {
        maxRetries: this.maxRetries,
      },
                     loop);
    };

    loop();
  }

  leave(name, cb) {
    if (typeof name === 'function') {
      this.destroy(name);
      return;
    }

    const list = _.filter(this.services, (e) => e.name === name);
    this.leaveList(list, cb || noop);
  }

  destroy(cb) {
    this.destroyed = true;
    this.leave(this.services, () => {
      if (cb) {
        cb();
        return;
      }
    });
  }
}
