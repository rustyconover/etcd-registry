/* eslint no-console: [0] */
import Registry from './index.js';
require('source-map-support').install();

const client = new Registry('127.0.0.1:4001,127.0.0.1:4002,127.0.0.1:4003');

client.join({ name: 'test',
              service: {
                port: 8080,
                inserted: Date.now(),
              },
            }, () => {
  setTimeout(() => {
    client.lookup('test', (err, service) => {
      console.log('error:', err);
      console.log('service:', service);
      client.leave();
    });
  }, 100);
});
