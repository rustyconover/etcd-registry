// @flow
/* eslint-env node, mocha */
/* eslint no-unused-expressions:[0] */
import { expect } from 'chai';
import randomstring from 'randomstring';
import _ from 'lodash';
import address from 'network-address';
import async from 'async';
import Registry from './index';

require('source-map-support').install();

const etcdConnectionString = '127.0.0.1:2379';

const serviceNamePrefix = randomstring.generate();
let counter = 1;

const generateServiceName = (): string => {
  const r = `${serviceNamePrefix}-${counter}`;
  counter += 1;
  return r;
};

describe('basic operations', () => {
  _.map([
    etcdConnectionString,
    `http://${etcdConnectionString}`,
    `http://${etcdConnectionString}?refresh=30`,
    `http://${etcdConnectionString}?refresh=true`,
    `http://${etcdConnectionString}?refresh=false`,
    `http://${etcdConnectionString}?refresh=abc`,
    'https://discovery.etcd.io/foobar',
    { url: etcdConnectionString },
  ],
        (connection) => {
          it(`should able be able to use ${JSON.stringify(connection)}`, (done) => {
            const s = new Registry(connection);
            s.leave(done);
          });
        });

  it('should be able to handle etcd that is down', (done) => {
    const reg = new Registry({
      url: 'http://127.0.0.1:1',
      maxRetries: 0,
    });
    const serviceName = generateServiceName();
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
        expect(err, 'join error').to.be.defined;
        setTimeout(() => {
          reg.lookup(serviceName, (lookupErr) => {
            expect(lookupErr, 'lookup error').to.be.defined;
            reg.leave(() => done());
          });
        }, 1000);
      });
  });


  it('should be able to renew service registrations', (done) => {
    const reg = new Registry(etcdConnectionString);
    const serviceName = generateServiceName();
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
        expect(err, 'join error').to.not.be.ok;
        setTimeout(() => {
          reg.lookup(serviceName, (lookupErr, s) => {
            expect(lookupErr, 'lookup error').to.not.be.ok;
            expect(s, 'lookup result').to.be.defined;
            expect(s, 'lookup result').to.deep.equal({
              name: serviceName,
              port: 1000,
              hostname: '127.0.0.1',
              host: '127.0.0.1:1000',
              url: 'http://127.0.0.1:1000',
              version: 0,
            });
            reg.leave(() => done());
          });
        }, 3000);
      });
  });

  it('should be persist additional service information', (done) => {
    const reg = new Registry(etcdConnectionString);
    const serviceName = generateServiceName();
    reg.join(
      {
        name: serviceName,
        service: {
          port: 1000,
          hostname: '127.0.0.1',
          datacenter: 'test123',
        },
        ttl: 2,
      },
      (err) => {
        expect(err, 'join error').to.not.be.ok;
        setTimeout(() => {
          reg.lookup(serviceName, (lookupErr, s) => {
            expect(lookupErr, 'lookup error').to.not.be.ok;
            expect(s, 'lookup result').to.be.defined;
            expect(s, 'lookup result').to.deep.equal({
              datacenter: 'test123',
              name: serviceName,
              port: 1000,
              hostname: '127.0.0.1',
              host: '127.0.0.1:1000',
              url: 'http://127.0.0.1:1000',
              version: 0,
            });
            reg.leave(() => done());
          });
        }, 3000);
      });
  });


  it('should be able to do registrations without callbacks', (done) => {
    const reg = new Registry(etcdConnectionString);
    const serviceName = generateServiceName();
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
        expect(lookupErr, 'lookup error').to.not.be.ok;
        expect(s, 'lookup result').to.be.defined;
        expect(s, 'lookup result').to.deep.equal({
          name: serviceName,
          port: 1000,
          hostname: '127.0.0.1',
          host: '127.0.0.1:1000',
          url: 'http://127.0.0.1:1000',
          version: 0,
        });
        reg.leave(() => done());
      });
    }, 1500);
  });


  it('expired registrations should not be returned', (done) => {
    const reg = new Registry(etcdConnectionString);
    const serviceName = generateServiceName();
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
        expect(err, 'join error').to.not.be.ok;
        setTimeout(() => {
          reg.lookup(serviceName, (lookupErr, s) => {
            expect(lookupErr, 'lookup error').to.not.be.ok;
            expect(s, 'lookup result').to.be.defined;
            expect(s, 'lookup result').to.deep.equal({
              name: serviceName,
              port: 1000,
              hostname: '127.0.0.1',
              host: '127.0.0.1:1000',
              url: 'http://127.0.0.1:1000',
              version: 0,
            });

            setTimeout(() => {
              reg.leave(serviceName);
              setTimeout(() => {
                reg.lookup(serviceName, (lastLookupErr, emptyResult) => {
                  expect(lastLookupErr, 'last lookup error').to.not.be.ok;
                  expect(emptyResult, 'last lookup result').to.not.be.ok;
                  reg.leave(() => done());
                });
              }, 3000);
            }, 500);
          });
        }, 2500);
      });
  });

  it('should able to add a service', (done) => {
    const reg = new Registry(etcdConnectionString);
    const serviceName = generateServiceName();
    reg.join(
      {
        name: serviceName,
        service: {
          port: 1000,
          hostname: '127.0.0.1',
        },
      },
      (err) => {
        expect(err, 'join error').to.not.be.ok;
        setTimeout(() => {
          reg.lookup(serviceName, (lookupErr, s) => {
            expect(lookupErr, 'lookup error').to.not.be.ok;
            expect(s, 'lookup result').to.be.defined;
            expect(s, 'lookup result').to.deep.equal({
              name: serviceName,
              port: 1000,
              hostname: '127.0.0.1',
              host: '127.0.0.1:1000',
              url: 'http://127.0.0.1:1000',
              version: 0,
            });
            reg.leave(() => done());
          });
        }, 100);
      });
  });

  it('should able to add a service using only the port number', (done) => {
    const reg = new Registry(etcdConnectionString);
    const serviceName = generateServiceName();
    reg.join(
      {
        name: serviceName,
        service: {
          port: 1000,
        },
      },
      (err) => {
        expect(err, 'join error').to.not.be.ok;
        setTimeout(() => {
          reg.lookup(serviceName, (lookupErr, s) => {
            expect(lookupErr, 'lookup error').to.not.be.ok;
            expect(s, 'lookup result').to.be.defined;
            expect(s, 'lookup result').to.deep.equal({
              name: serviceName,
              port: 1000,
              hostname: address(),
              host: `${address()}:1000`,
              url: `http://${address()}:1000`,
              version: 0,
            });
            reg.leave(() => done());
          });
        }, 100);
      });
  });

  it('should able to add a service without a port number', (done) => {
    const reg = new Registry(etcdConnectionString);
    const serviceName = generateServiceName();
    reg.join(
      {
        name: serviceName,
      },
      (err) => {
        expect(err, 'join error').to.not.be.ok;
        setTimeout(() => {
          reg.lookup(serviceName, (lookupErr, s) => {
            expect(lookupErr, 'lookup error').to.not.be.ok;
            expect(s, 'lookup result').to.be.defined;
            expect(s, 'lookup result').to.deep.equal({
              name: serviceName,
              hostname: address(),
              host: `${address()}`,
              url: `http://${address()}`,
              version: 0,
            });
            reg.leave(() => done());
          });
        }, 100);
      });
  });


  it('should be able to list services', (done) => {
    const reg = new Registry(etcdConnectionString);
    const serviceName = generateServiceName();
    reg.join({ name: serviceName, service: { port: 1000 } }, (err) => {
      expect(err, 'error on join').to.not.be.ok;
      reg.join({ name: serviceName, service: { port: 1001 } }, (secondErr) => {
        expect(secondErr, 'second error on join').to.not.be.ok;
        setTimeout(() => {
          reg.list(serviceName, (listErr, list) => {
            expect(listErr, 'error on list').to.not.be.ok;
            if (list != null) {
              expect(list.length, 'number of services').to.equal(2);
            }
            reg.leave(done);
          });
        }, 100);
      });
    });
  });

  it('should be able to join and list services with a version', (done) => {
    const reg = new Registry(etcdConnectionString);
    const serviceName = generateServiceName();
    reg.join({ name: serviceName, service: { port: 1000 }, version: 13 }, (err) => {
      expect(err, 'error on join').to.not.be.ok;
      reg.join({ name: serviceName, service: { port: 1001 }, version: 14 }, (secondErr) => {
        expect(secondErr, 'second error on join').to.not.be.ok;
        setTimeout(() => {
          reg.list(serviceName, (listErr, list) => {
            expect(listErr, 'error on list').to.not.be.ok;
            if (list != null) {
              expect(list.length, 'number of services').to.equal(2);
              expect(_.filter(list, l => l.version === 13).length, 'number of services with version 13').to.equal(1);
              expect(_.filter(list, l => l.version === 14).length, 'number of services with version 14').to.equal(1);
              expect(list.length, 'number of services').to.equal(2);
            }
            reg.leave(done);
          });
        }, 100);
      });
    });
  });

  it('should be able to list unknown services', (done) => {
    const reg = new Registry(etcdConnectionString);
    const serviceName = generateServiceName();
    reg.list(serviceName, (listErr, list) => {
      expect(listErr, 'error on list').to.not.be.ok;
      if (list != null) {
        expect(list.length, 'number of services').to.equal(0);
      }
      reg.leave(done);
    });
  });

  it('should be able to remove services', (done) => {
    const reg = new Registry(etcdConnectionString);
    const serviceName = generateServiceName();
    reg.join({ name: serviceName, service: { port: 1000 } }, (err) => {
      expect(err).to.not.be.ok;
      reg.leave(serviceName, (leaveErr) => {
        expect(leaveErr).to.not.be.ok;
        setTimeout(() => {
          reg.lookup(serviceName, (lookupErr, s) => {
            expect(lookupErr).to.not.be.ok;
            expect(s).to.be.undefined;
            reg.leave(done);
          });
        });
      }, 2000);
    });
  });

  it('should be able to monitor a single service instance', (done) => {
    const reg = new Registry(etcdConnectionString);
    const serviceName = generateServiceName();
    reg.monitorStart(serviceName);
    reg.join({ name: serviceName, service: { port: 1000 } }, (err) => {
      setTimeout(() => {
        expect(reg.monitorContents(serviceName).length).to.equal(1);
        expect(err).to.not.be.ok;
        reg.leave(serviceName, (leaveErr) => {
          expect(leaveErr).to.not.be.ok;
          setTimeout(() => {
            expect(reg.monitorContents(serviceName).length).to.equal(0);
            reg.lookup(serviceName, (lookupErr, s) => {
              expect(reg.monitorContents(serviceName).length).to.equal(0);
              expect(lookupErr).to.not.be.ok;
              expect(s).to.be.undefined;
              reg.leave(done);
            });
          }, 1000);
        });
      }, 1000);
    });
  });

  it('should be able to monitor a single service instance periodically', (done) => {
    const reg = new Registry(etcdConnectionString);
    const serviceName = generateServiceName();
    reg.periodicMonitorStart(serviceName, 1000);
    reg.join({ name: serviceName, service: { port: 1000 } }, (err) => {
      setTimeout(() => {
        expect(reg.monitorContents(serviceName).length).to.equal(1);
        expect(err).to.not.be.ok;
        reg.leave(serviceName, (leaveErr) => {
          expect(leaveErr).to.not.be.ok;
          setTimeout(() => {
            expect(reg.monitorContents(serviceName).length).to.equal(0);
            reg.lookup(serviceName, (lookupErr, s) => {
              expect(reg.monitorContents(serviceName).length).to.equal(0);
              expect(lookupErr).to.not.be.ok;
              expect(s).to.be.undefined;
              reg.leave(done);
            });
          }, 2000);
        });
      }, 2000);
    });
  });

  it('should be able to monitor a single service instance over renewals', (done) => {
    const reg = new Registry(etcdConnectionString);
    const serviceName = generateServiceName();
    reg.monitorStart(serviceName);
    reg.join({ name: serviceName, service: { port: 1000 }, ttl: 1 }, (err) => {
      setTimeout(() => {
        expect(reg.monitorContents(serviceName).length).to.equal(1);
        expect(err).to.not.be.ok;
        reg.leave(serviceName, (leaveErr) => {
          expect(leaveErr).to.not.be.ok;
          setTimeout(() => {
            expect(reg.monitorContents(serviceName).length).to.equal(0);
            setTimeout(() => {
              reg.lookup(serviceName, (lookupErr, s) => {
                reg.monitorStop(serviceName);
                expect(lookupErr).to.not.be.ok;
                expect(s).to.be.undefined;
                reg.leave(done);
              });
            }, 1500);
          }, 1500);
        });
      }, 3000);
    });
  });

  it('should be able to monitor a single service instance periodically over renewals', (done) => {
    const reg = new Registry(etcdConnectionString);
    const serviceName = generateServiceName();
    reg.periodicMonitorStart(serviceName, 1000);
    reg.join({ name: serviceName, service: { port: 1000 }, ttl: 1 }, (err) => {
      setTimeout(() => {
        expect(reg.monitorContents(serviceName).length).to.equal(1);
        expect(err).to.not.be.ok;
        reg.leave(serviceName, (leaveErr) => {
          expect(leaveErr).to.not.be.ok;
          setTimeout(() => {
            expect(reg.monitorContents(serviceName).length).to.equal(0);
            setTimeout(() => {
              reg.lookup(serviceName, (lookupErr, s) => {
                reg.monitorStop(serviceName);
                expect(lookupErr).to.not.be.ok;
                expect(s).to.be.undefined;
                reg.leave(done);
              });
            }, 2500);
          }, 2500);
        });
      }, 3000);
    });
  });

  it('should be able to monitor a multiple service instances', (done) => {
    const reg = new Registry(etcdConnectionString);
    const serviceName = generateServiceName();
    reg.monitorStart(serviceName);

    const instances = _.map(_.range(20), i => i + 2000);

    async.each(instances,
               (i, cb) => reg.join({
                 name: serviceName,
                 service: { port: i },
                 ttl: 10,
               }, cb),
               (err) => {
                 expect(err).to.not.be.ok;
                 setTimeout(() => {
                   expect(reg.monitorContents(serviceName).length).to.equal(instances.length);
                   reg.leave(serviceName, (leaveErr) => {
                     expect(leaveErr).to.not.be.ok;
                     setTimeout(() => {
                       reg.lookup(serviceName, (lookupErr, s) => {
                         expect(reg.monitorContents(serviceName).length).to.equal(0);
                         expect(lookupErr).to.not.be.ok;
                         expect(s).to.be.undefined;
                         done();
                       });
                     }, 1500);
                   }, 1500);
                 }, 3000);
               });
  });

  it('should be able to monitor existing multiple service instances', (done) => {
    const reg = new Registry(etcdConnectionString);
    const serviceName = generateServiceName();
    const instances = _.map(_.range(20), i => i + 2000);

    async.each(instances,
               (i, cb) => reg.join({
                 name: serviceName,
                 service: { port: i },
                 ttl: 10,
               }, cb),
               (err) => {
                 expect(err).to.not.be.ok;
                 reg.monitorStart(serviceName);
                 setTimeout(() => {
                   expect(reg.monitorContents(serviceName).length).to.equal(instances.length);
                   reg.join({
                     name: serviceName,
                     service: { port: 3000 },
                     ttl: 10,
                   });

                   setTimeout(() => {
                     expect(reg.monitorContents(serviceName).length).to.equal(instances.length + 1);
                     reg.leave(serviceName, (leaveErr) => {
                       expect(leaveErr).to.not.be.ok;
                       setTimeout(() => {
                         reg.lookup(serviceName, (lookupErr, s) => {
                           expect(reg.monitorContents(serviceName).length).to.equal(0);
                           expect(lookupErr).to.not.be.ok;
                           expect(s).to.be.undefined;
                           done();
                         });
                       }, 1000);
                     }, 1500);
                   }, 1500);
                 }, 3000);
               });
  });
});
