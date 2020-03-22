let config = require('config');
const fs = require('fs');
const path = require('path');
const uuid = require('uuid').v4;
const chalk = require('chalk');

const logger = require('./logger');
const style = require('./style');

let appId;
const appIdFile = path.resolve(`${config.app.cacheFile}.appid`);
const lockFile = `${appIdFile}.lock`;

const acquireAppLock = () => {
  if (fs.existsSync(lockFile)) {
    return false;
  }

  fs.writeFileSync(lockFile, `${process.pid}`);
  return true;
}

const releaseAppLock = () => {
  try {
    fs.unlinkSync(lockFile);
  } catch {}
}

const checkAppIdFile = () => {
  if (!fs.existsSync(appIdFile)) {
    logger.info('app reset!');
    console.log(`${style.INFO_CHAR} ${chalk.bgBlue('Application reset: all configuration to defaults')}`)
    const savedCfg = Object.assign({}, { 
      app: { zkb: { maintainer: config.app.zkb.maintainer } }, 
      credentials: config.credentials 
    });

    [config.app.cacheFile, 
    `${config.eveData.sde.cache}/ours/cache.json`,
    `${config.eveData.sde.cache}/ours/.cache.json`,
    'config/local.json']
      .forEach(kill => {
        try { fs.unlinkSync(kill); } 
        catch (e) { logger.info(e.message.replace('Error', '')); }
      });

    fs.writeFileSync(appIdFile, (appId = uuid()));
    fs.writeFileSync('config/local.json', JSON.stringify(savedCfg, null, 2));
    delete require.cache[require.resolve('config')];
    config = require('config');
  } else {
    appId = fs.readFileSync(appIdFile);
  }

  return appId;
};

const resetApp = () => {
  try {
    fs.unlinkSync(appIdFile);
  } catch {}
}

const getAppId = () => appId;

module.exports = {
  checkAppIdFile,
  resetApp,
  acquireAppLock,
  releaseAppLock,
  getAppId
};
