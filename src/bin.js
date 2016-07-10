#!/usr/bin/env node
/* eslint no-console:[0] */
/* eslint no-param-reassign:[0] */
import Registry from './index.js';
import optimist from 'optimist';
import path from 'path';
import chalk from 'chalk';
import freeport from 'freeport';
import tree from 'pretty-tree';
import net from 'net';
import address from 'network-address';

const argv = optimist
        .usage('Usage: $0 [command] [options]')
        .option('e', {
          alias: 'etcd',
          default: '127.0.0.1:4001',
        })
        .option('v', {
          alias: 'verbose',
          default: false,
        })
        .option('p', {
          alias: 'port',
          default: 0,
        })
        .option('h', {
          alias: 'hostname',
          default: address(),
        })
        .option('w', {
          alias: 'wait',
          default: 2000,
        })
        .option('s', {
          alias: 'slack',
          default: 5000,
        })
        .argv;

const services = new Registry(argv.etcd +
                              (argv.etcd.indexOf('?') === -1 ?
                               '?refresh=false' : '&refresh=false'));
const cmds = {};
const _ = argv._;

const help = () => {
  optimist.showHelp();
  console.error('Commands:');
  console.error('  join [name] [index.js]  # Listen on env.PORT to join the registry in index.js');
  console.error('  list                    # List all added services');
  console.error('  lookup [name]           # Lookup a specific service');
  console.error('');
  process.exit(1);
};

const error = (err) => {
  console.error(chalk.red(err.message || err));
  process.exit(2);
};

const usage = (msg) => {
  console.error(`Usage: %{argv.$0} ${msg}`);
  process.exit(2);
};

cmds.join = (name, main) => {
  if (!name || !main) {
    usage('join [name] [main]');
    return;
  }

  const onport = (port) => {
    process.env.PORT = `${port}`;

    const join = () => {
      services.join(
        { name,
          service: {
            port,
            hostname: argv.hostname,
          },
        },
        (err) => {
          if (err) {
            error(err);
            return;
          }

          const pexit = process.exit;

          process.exit = (code) =>
            services.leave(() => {
              pexit(code);
            });


          process.on('SIGTERM', () => {
            const leave = () => {
              services.leave(() => {
                if (!argv.slack) {
                  pexit();
                  return;
                }
                setTimeout(pexit, parseInt(argv.slack, 10));
              });
            };

            if (!argv.wait) {
              leave();
              return;
            }
            setTimeout(leave, parseInt(argv.wait, 10));
          });

          process.on('SIGINT', () => process.exit());
        });
    };

    const listen = net.Server.prototype.listen;
    net.Server.prototype.listen = (p) => {
      if (Number(p) === Number(port)) {
        this.once('listening', join);
      }
      listen.apply(this, arguments);
    };

    /* eslint global-require:[0] */
    require(path.join(process.cwd(), main));
  };

  if (argv.port) {
    onport(parseInt(argv.port, 10));
    return;
  }

  freeport((err, port) => {
    if (err) {
      error(err);
      return;
    }
    onport(port);
  });
};

const onservice = (service) => {
  const name = service.name;
  delete service.name;
  console.log(tree({
    label: name,
    leaf: service,
  }));
};

cmds.list = () => {
  services.list((err, list) => {
    if (err) {
      error(err);
      return;
    }
    if (!list.length) {
      console.log(chalk.grey('(empty)'));
      return;
    }
    list.forEach((service) => {
      if (argv.verbose) {
        onservice(service);
        return;
      }
      console.log(chalk.yellow(service.name));
    });
  });
};

cmds.lookup = (name) => {
  if (name === undefined) {
    usage('lookup [name]');
    return;
  }
  services.lookup(name, (err, service) => {
    if (err) {
      error(err);
      return;
    }
    if (!service) {
      console.log(chalk.grey('(empty)'));
      return;
    }
    onservice(service);
  });
};

(cmds[_[0]] || help).apply(null, _.slice(1));
