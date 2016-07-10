/* eslint-env node, mocha */
/* eslint no-unused-expressions:[0] */
import Registry from './index.js';
import { expect } from 'chai';
import randomstring from 'randomstring';
import _ from 'lodash';
import address from 'network-address';
require('source-map-support').install();

const etcdConnectionString = '127.0.0.1:2379';

describe('basic operations', () => {
  _.map([etcdConnectionString,
         `http://${etcdConnectionString}`,
         `http://${etcdConnectionString}?refresh=30`,
         `http://${etcdConnectionString}?refresh=true`,
         `http://${etcdConnectionString}?refresh=false`,
         `http://${etcdConnectionString}?refresh=abc`,
         'https://discovery.etcd.io/foobar',
         { url: etcdConnectionString },
        ], (connection) => {
    it(`should able be able to use ${connection}`, (done) => {
      const s = new Registry(connection);
      s.leave(done);
    });
  });

  it('should be able to renew service registrations', (done) => {
    const reg = new Registry(etcdConnectionString);
    const serviceName = randomstring.generate();
    reg.join(
      {
        name: serviceName,
        service: {
          port: 1000,
          hostname: '127.0.0.1',
        },
        ttl: 2,
      },
      (err) => {
        expect(err, 'join error').to.be.undefined;
        setTimeout(() => {
          reg.lookup(serviceName, (lookupErr, s) => {
            expect(lookupErr, 'lookup error').to.be.undefined;
            expect(s, 'lookup result').to.be.defined;
            expect(s, 'lookup result').to.deep.equal({
              name: serviceName,
              port: 1000,
              hostname: '127.0.0.1',
              host: '127.0.0.1:1000',
              url: 'http://127.0.0.1:1000',
            });
            reg.leave(() => done());
          });
        }, 3000);
      });
  });

  it('should be able to do registrations without callbacks', (done) => {
    const reg = new Registry(etcdConnectionString);
    const serviceName = randomstring.generate();
    reg.join(
      {
        name: serviceName,
        service: {
          port: 1000,
          hostname: '127.0.0.1',
        },
        ttl: 3,
      });

    setTimeout(() => {
      reg.lookup(serviceName, (lookupErr, s) => {
        expect(lookupErr, 'lookup error').to.be.undefined;
        expect(s, 'lookup result').to.be.defined;
        expect(s, 'lookup result').to.deep.equal({
          name: serviceName,
          port: 1000,
          hostname: '127.0.0.1',
          host: '127.0.0.1:1000',
          url: 'http://127.0.0.1:1000',
        });
        reg.leave(() => done());
      });
    }, 1500);
  });


  it('expired registrations should not be returned', (done) => {
    const reg = new Registry(etcdConnectionString);
    const serviceName = randomstring.generate();
    reg.join(
      {
        name: serviceName,
        service: {
          port: 1000,
          hostname: '127.0.0.1',
        },
        ttl: 2,
      },
      (err) => {
        expect(err, 'join error').to.be.undefined;
        setTimeout(() => {
          reg.lookup(serviceName, (lookupErr, s) => {
            expect(lookupErr, 'lookup error').to.be.undefined;
            expect(s, 'lookup result').to.be.defined;
            expect(s, 'lookup result').to.deep.equal({
              name: serviceName,
              port: 1000,
              hostname: '127.0.0.1',
              host: '127.0.0.1:1000',
              url: 'http://127.0.0.1:1000',
            });

            setTimeout(() => {
              reg.leave(serviceName);
              setTimeout(() => {
                reg.lookup(serviceName, (lastLookupErr, emptyResult) => {
                  expect(lastLookupErr, 'last lookup error').to.be.undefined;
                  expect(emptyResult, 'last lookup result').to.be.undefined;
                  reg.leave(() => done());
                });
              }, 3000);
            }, 500);
          });
        }, 2500);
      });
  });

  it('should be able to cache services');
  it('the cache should expire');

  it('should able to add a service', (done) => {
    const reg = new Registry(etcdConnectionString);
    const serviceName = randomstring.generate();
    reg.join(
      {
        name: serviceName,
        service: {
          port: 1000,
          hostname: '127.0.0.1',
        },
      },
      (err) => {
        expect(err, 'join error').to.be.undefined;
        setTimeout(() => {
          reg.lookup(serviceName, (lookupErr, s) => {
            expect(lookupErr, 'lookup error').to.be.undefined;
            expect(s, 'lookup result').to.be.defined;
            expect(s, 'lookup result').to.deep.equal({
              name: serviceName,
              port: 1000,
              hostname: '127.0.0.1',
              host: '127.0.0.1:1000',
              url: 'http://127.0.0.1:1000',
            });
            reg.leave(() => done());
          });
        }, 100);
      });
  });

  it('should able to add a service using only the port number', (done) => {
    const reg = new Registry(etcdConnectionString);
    const serviceName = randomstring.generate();
    reg.join(
      {
        name: serviceName,
        service: 1000,
      },
      (err) => {
        expect(err, 'join error').to.be.undefined;
        setTimeout(() => {
          reg.lookup(serviceName, (lookupErr, s) => {
            expect(lookupErr, 'lookup error').to.be.undefined;
            expect(s, 'lookup result').to.be.defined;
            expect(s, 'lookup result').to.deep.equal({
              name: serviceName,
              port: 1000,
              hostname: address(),
              host: `${address()}:1000`,
              url: `http://${address()}:1000`,
            });
            reg.leave(() => done());
          });
        }, 100);
      });
  });

  it('should able to add a service without a port number', (done) => {
    const reg = new Registry(etcdConnectionString);
    const serviceName = randomstring.generate();
    reg.join(
      {
        name: serviceName,
      },
      (err) => {
        expect(err, 'join error').to.be.undefined;
        setTimeout(() => {
          reg.lookup(serviceName, (lookupErr, s) => {
            expect(lookupErr, 'lookup error').to.be.undefined;
            expect(s, 'lookup result').to.be.defined;
            expect(s, 'lookup result').to.deep.equal({
              name: serviceName,
              hostname: address(),
              host: `${address()}`,
              url: `http://${address()}`,
            });
            reg.leave(() => done());
          });
        }, 100);
      });
  });


  it('should be able to list services', (done) => {
    const reg = new Registry(etcdConnectionString);
    const serviceName = randomstring.generate();
    reg.join({ name: serviceName, service: { port: 1000 } }, (err) => {
      expect(err, 'error on join').to.be.undefined;
      reg.join({ name: serviceName, service: { port: 1001 } }, (secondErr) => {
        expect(secondErr, 'second error on join').to.be.undefined;
        setTimeout(() => {
          reg.list(serviceName, (listErr, list) => {
            expect(listErr, 'error on list').to.be.undefined;
            expect(list.length, 'number of services').to.equal(2);
            reg.leave(done);
          });
        }, 100);
      });
    });
  });

  it('should be able to list unknown services', (done) => {
    const reg = new Registry(etcdConnectionString);
    const serviceName = randomstring.generate();
    reg.list(serviceName, (listErr, list) => {
      expect(listErr, 'error on list').to.be.undefined;
      expect(list.length, 'number of services').to.equal(0);
      reg.leave(done);
    });
  });

  it('should be able to remove services', (done) => {
    const reg = new Registry(etcdConnectionString);
    const serviceName = randomstring.generate();
    reg.join({ name: serviceName, service: { port: 1000 } }, (err) => {
      expect(err).to.be.undefined;
      reg.leave(serviceName, (leaveErr) => {
        expect(leaveErr).to.be.undefined;
        setTimeout(() => {
          reg.lookup(serviceName, (lookupErr, s) => {
            expect(lookupErr).to.be.undefined;
            expect(s).to.be.undefined;
            reg.leave(done);
          });
        });
      }, 100);
    });
  });
});
