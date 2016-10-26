// @flow
import crypto from 'crypto';
import address from 'network-address';
import Etcd from 'node-etcd';
import _ from 'lodash';
import assert from 'assert';

require('source-map-support').install();
/* eslint no-param-reassign:[0] */
/* eslint arrow-parens:[0] */

const sha1 = (val: string) => crypto.createHash('sha1').update(val).digest('hex');

type ServiceEntry = {
  name: string,
  key: string,
  destroyed: boolean,
  timeout: ?number
};

type ServiceParameters = {
  name?: string,
  hostname?: string,
  port?: number,
  protocol?: string,
  host?: string,
  url?: string
};

type ParsedServiceParameters = {
  name: string,
  hostname: string,
  port?: number,
  protocol?: string,
  host: string,
  url: string
};

type Logger = {
    debug: (message: ?string, data?: { [name: string]: any }) => void,
};

type ListCallback = (error: ?any,
                            result: ?Array<ParsedServiceParameters>,
                            fullError: ?any) => void;
type LookupCallback = (error: ?any, entry: ?ParsedServiceParameters) => void;
type EmptyCallback = () => void;

const safeJSONParse = (c: string): ?ParsedServiceParameters => {
  let r;
  try {
    r = JSON.parse(c);
  } catch (e) {
    r = null;
  }
  return r;
};

const normalizeKey = (key: string) => key.replace(/[^a-zA-Z0-9\-]/g, '-');

const parseConnectionString = (url: string): {
  namespace?: string,
  protocol?: string,
  maxRetries?: number,
  logger?: Logger,
  hosts?: Array<string>
} => {
  const opts = {};

  const hosts = url;
  if (/^https:\/\/discovery.etcd.io\//.test(hosts)) {
    opts.token = hosts;
  }

  if (hosts == null) {
    throw new Error('Invalid connection string');
  }

  if (typeof hosts === 'string') {
    const parsed = hosts.match(/^([^:]+:\/\/)?([^\/]+)(?:\/([^\?]+))?(?:\?(.+))?$/);

    if (parsed != null) {
      const protocol = parsed[1] || 'http:';
      if (parsed[1]) {
        opts.protocol = protocol.replace('//', '');
      } else {
        opts.protocol = 'http:';
      }
      opts.namespace = parsed[3] || '';
      opts.hosts = parsed[2].split(/,\s*/).map((hostsPart) => `${protocol}//${hostsPart}`);
    }
  }

  return opts;
};

export default class Registry {
  store: Etcd;
  destroyed: boolean;
  services: Array<ServiceEntry>;
  logger: Logger;
  maxRetries: number;
  monitoredServices: {
    [key: string]: {
      [url: string]: ParsedServiceParameters
    }
  };
  activeServiceMonitors: {
    [name: string]: {
      stop: () => void
    }
  };
  ns: string;

  constructor(opts: string | {
    hosts?: Array<string>,
    logger?: Logger,
    maxRetries?: number,
    protocol?: string,
    namespace?: string,
  }) {
    if (typeof opts === 'string') {
      opts = parseConnectionString(opts);
    }
    this.store = new Etcd(opts.hosts, opts);
    this.destroyed = false;
    this.services = [];

    if (opts.logger != null) {
      this.logger = opts.logger;
    }

    if (opts.maxRetries != null) {
      this.maxRetries = opts.maxRetries;
    }

    this.monitoredServices = {};
    this.activeServiceMonitors = {};
    this.ns = (opts.namespace || '').replace(/^\//, '').replace(/([^\/])$/, '$1/');

    if (!this.logger) {
      this.logger = {
        debug: () => {},
      };
    }
  }

  prefixKey(key: string) {
    return `services/${this.ns}${key}`;
  }

  join({ name,
         service,
         ttl = 15,
       }: {
         name: string,
         service?: ServiceParameters,
         ttl?: number
       }, cb: ?EmptyCallback): string {
    assert(!_.isNil(name), 'Name should be defined');
    assert(cb == null || _.isFunction(cb), 'Callback should be a function');
    if (ttl != null) {
      assert(ttl > 0,
             'ttl should be an integer greater than zero');
    }

    if (service == null) {
      service = ({ name }: ServiceParameters);
    }

    service.name = name;
    service.hostname = service.hostname || address();

    if (!service.host) {
      if (service.port != null) {
        service.host = `${service.hostname}:${service.port}`;
      } else {
        service.host = service.hostname;
      }
    }

    service.url = service.url || `${service.protocol || 'http'}://${service.host}`;

    const nameAndUrl = `${name}-${service.url}`;
    const key = this.prefixKey(`${normalizeKey(name)}/${sha1(nameAndUrl)}`);

    const value = JSON.stringify(service);
    const entry: ServiceEntry = { name,
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


    const onError = (err) => this.leaveList([entry],
                                            () => {
                                              if (cb) {
                                                cb(err);
                                              }
                                            });
    this.logger.debug('Service join', { entry });
    this.services.push(entry);
    update((err) => {
      this.logger.debug('Successfully, joined service', { entry });
      if (err) {
        onError(err);
        return;
      }
      if (this.destroyed) {
        onError(new Error('registry destroyed'));
        return;
      }

      entry.timeout = setTimeout(loop, (ttl / 2) * 1000);
      if (cb) {
        cb(undefined, service);
      }
    });
    return key;
  }

  lookup(name: ?string | LookupCallback, cb: LookupCallback): void {
    if (typeof name === 'function') {
      cb = name;
      name = null;
    }
    this.logger.debug('Retrieving service entries', { name });
    this.list(name, (err, list) => {
      if (err) {
        cb(err);
        return;
      }
      cb(err, _.sample(list));
    });
  }

  monitorContents(name: string): Array<ParsedServiceParameters> {
    assert(!_.isNil(name));
    if (_.isNil(this.activeServiceMonitors[name])) {
      return [];
    }
    const results = _.values(this.monitoredServices[name]);
    this.logger.debug('Monitor contents for',
                      { name, results });
    return results;
  }

  monitorStop(name: string): void {
    assert(!_.isNil(name));
    const m = this.activeServiceMonitors[name];
    if (!_.isNil(m)) {
      this.logger.debug('Stoppping monitoring', { name });
      m.stop();
      delete this.activeServiceMonitors[name];
    }
  }

  monitorStart(name: string, callback: ?(error: ?any) => void): void {
    assert(!_.isNil(name));
    if (!_.isNil(this.activeServiceMonitors[name])) {
      if (callback) {
        callback();
      }
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

    this.logger.debug('Starting service monitor', { name });

    const pullFullList = () => this.list(name, (err, results, rawResult) => {
      // Already got stopped before we got started.
      if (shouldCancel) {
        if (callback) {
          callback();
        }
        return;
      }

      if (err && !rawResult) {
        this.logger.debug('Error getting list of service entries', { err });
        if (callback) {
          callback(`Error obtaining list of monitored services ${err}`);
        }
        return;
      }

      this.logger.debug('Retrieved service list for monitor',
                        { name, results });

      this.monitoredServices[name] = _.mapValues(_.groupBy(results, 'url'), (i) => i[0]);
      let startIndex;
      if (rawResult && rawResult.error && rawResult.error.index) {
        startIndex = rawResult.error.index;
      } else if (rawResult && rawResult.node) {
        if (rawResult.node.nodes) {
          startIndex = _.max(_.map(rawResult.node.nodes, 'modifiedIndex')) + 1;
        } else {
          startIndex = rawResult.node.modifiedIndex + 1;
        }
      } else {
        assert(1 !== 0);
      }
      assert(!_.isNil(startIndex));
      this.logger.debug('Starting monitor for service', { name, startIndex });
      const w = this.store.watcher(this.prefixKey(name),
                                   startIndex,
                                   { recursive: true });
      this.activeServiceMonitors[name] = w;


      w.on('change', (record) => {
        if (record.action === 'set') {
          const c = safeJSONParse(record.node.value);
          if (c != null) {
            this.monitoredServices[name][c.url] = c;
          }
          this.logger.debug('Monitor set event', { name, c });
        } else if (record.action === 'delete' || record.action === 'expire') {
          const c = safeJSONParse(record.prevNode.value);
          if (c != null) {
            this.logger.debug('Monitor delete or expire event', { url: c.url, name });
            delete this.monitoredServices[name][c.url];
          }
        } else if (record.action === 'reconnect') {
          this.logger.debug('Monitor reconnect event');
          w.stop();
          pullFullList();
        } else if (record.action === 'resync') {
          this.logger.debug('Monitor resync event');
          w.stop();
          pullFullList();
        }
      });
      if (callback) {
        callback();
      }
    });

    pullFullList();
  }

  list(name: ?string | ListCallback, cb: ListCallback): void {
    if (typeof name === 'function') {
      cb = name;
      name = null;
    }

    if (name) {
      name = normalizeKey(name);
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

  leaveList(list: Array<ServiceEntry>, cb: ?EmptyCallback): void {
    const loop = () => {
      const next = list.shift();

      if (!next) {
        if (cb) {
          cb();
        }
        return;
      }

      clearTimeout(next.timeout);
      next.destroyed = true;

      const i = this.services.indexOf(next);
      if (i > -1) {
        this.services.splice(i, 1);
      }
      this.logger.debug('Removing key', { key: next.key });
      this.store.del(next.key, {
        maxRetries: this.maxRetries,
      },
                     loop);
    };

    loop();
  }

  leave(name: EmptyCallback | string, cb: ?EmptyCallback): void {
    if (typeof name === 'function') {
      this.destroy(name);
      return;
    }

    const list = _.filter(this.services, (e) => e.name === name);
    this.logger.debug('Unregistering services', { list });
    this.leaveList(list, cb);
  }

  leaveKey(key: EmptyCallback | string, cb: ?EmptyCallback): void {
    if (typeof key === 'function') {
      this.destroy(key);
      return;
    }

    const list = _.filter(this.services, (e) => e.key === key);
    this.logger.debug('Unregistering services with key', { key });
    this.leaveList(list, cb);
  }

  destroy(cb: ?EmptyCallback): void {
    this.destroyed = true;
    this.leaveList(this.services, () => {
      if (cb) {
        cb();
        return;
      }
    });
  }
}
