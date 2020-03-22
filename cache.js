const fs = require('fs');
const path = require('path');
const yaml = require('yaml');
const chalk = require('chalk');
const fetch = require('node-fetch');
const config = require('config');
const crypto = require('crypto');
const moment = require('moment');
const numeral = require('numeral');
const { spawnSync } = require('child_process');

const auth = require('./auth');
const logger = require('./logger');
const applock = require('./applock');
const { Spinner } = require('./util');
const {
  INFO_CHAR,
  OK_CHAR,
  ALERT_CHAR,
  WARN_CHAR,
  DOWN_CHAR,
  WORKING_CHAR,
  hilite,
  lolite
} = require('./style');

let cache = {};
let staticCache;

const writeCache = () => fs.writeFileSync(config.app.cacheFile, JSON.stringify(cache, null, 2));
const setInCache = (k, v) => { cache[k] = v; writeCache(); };

const ourCache = `${config.eveData.sde.cache}/ours`;
const ourCacheName = `${ourCache}/cache.json`;
const ourCacheVerifyName = `${ourCache}/.cache.json`;

const calcChecksum = (checkStr) => 
  crypto.createHmac('sha256', applock.getAppId()).update(checkStr).digest('hex');

const calcShasum = (checkStr) =>
  crypto.createHash('sha256').update(checkStr).digest('hex');

const persistStaticCache = () => {
  if (!staticCache) {
    logger.warn('#persistStaticCache undefined!');
    return false;
  }

  if (!staticCache.__dirty) {
    return false;
  }

  logger.info(`#persistStaticCache saving to disk`);
  if (fs.existsSync(ourCacheVerifyName)) {
    logger.verbose(`#persistStaticCache current: ${fs.readFileSync(ourCacheVerifyName)}`);
  }

  console.log(`${DOWN_CHAR} Saving cache`);
  staticCache.__dirty = false;

  let _pscwStart = Date.now();
  const cacheStr = JSON.stringify(staticCache);
  fs.writeFileSync(ourCacheName, cacheStr);
  logger.info(`#persistStaticCache to disk took ${Date.now() - _pscwStart}`);

  const cacheVerify = {
    expectLengths: Object.keys(staticCache).reduce((a, x) => {
      a[x] = Object.keys(staticCache[x]).length;
      return a;
    }, {}),
    checksum: calcChecksum(cacheStr),
    shasum: calcShasum(cacheStr),
    size: fs.statSync(ourCacheName).size
  };

  const verStr = JSON.stringify(cacheVerify);
  fs.writeFileSync(ourCacheVerifyName, verStr);
  logger.verbose(`#persistStaticCache new: ${verStr}`);
  return true;
};

const refreshStaticDataCache = async () => {
  if (!config.app.useStaticDataCache) {
    return undefined;
  }

  console.log(`${WORKING_CHAR} Verifying data cache…`);
  config.eveData.sde.cache = path.resolve(config.eveData.sde.cache);
  const unpackDir = `${config.eveData.sde.cache}/sde`;
  const zipFile = `${config.eveData.sde.cache}/.zip`;

  if (!fs.existsSync(config.eveData.sde.cache)) {
    fs.mkdirSync(config.eveData.sde.cache);
  }

  const fetchAndUnpackSDE = async () => {
    const _fauStart = Date.now();
    if (!fs.existsSync(zipFile)) {
      // TODO: checksum!!
      const getResp = await fetch(config.eveData.sde.uri);
      if (!getResp.ok) {
        throw new Error('unable to fetch SDE');
      }
      const toMBs = (x) => numeral(Number(x) / 1024 / 1024).format('0,0');
      console.log(`${DOWN_CHAR} Downloading ${hilite(toMBs(getResp.headers.get('Content-Length')))} megabytes` +
        ` of EVE static data (one-time setup)…`);
      const getData = await getResp.buffer();
      console.log(`${OK_CHAR} Downloaded ${hilite(toMBs(getData.length))} megabytes of static data`);
      fs.writeFileSync(`${config.eveData.sde.cache}/.zip`, getData);
    }

    if (!fs.existsSync(zipFile)) {
      throw new Error(`EVE data download failed`);
    }

    if (!fs.existsSync(unpackDir)) {
      console.log(`${WORKING_CHAR} Unpacking…`);
      const unzipScript = `pushd ${config.eveData.sde.cache}; unzip .zip; popd`;
      const scriptName = `${config.eveData.sde.cache}/.script`;
      fs.writeFileSync(scriptName, unzipScript);
      spawnSync('/bin/bash', [scriptName]);

      if (fs.existsSync(unpackDir)) {
        const dirStat = fs.statSync(unpackDir);
        if (!dirStat.isDirectory()) {
          throw new Error(`Unpacking failed: not-a-directory`);
        }
      } else {
        throw new Error(`Unpacking failed: output directory missing`);
      }
    }
    logger.info(`#fetchAndUnpackSDE took ${Date.now() - _fauStart}`);
  };

  if (!fs.existsSync(ourCache)) {
    fs.mkdirSync(ourCache);
  }
  
  const loadFromSDE = async () => {
    let _lfsSpin = new Spinner({spinner:'circles'});
    const loadFromSDE_start = Date.now();
    await fetchAndUnpackSDE();

    console.log(`${INFO_CHAR} Must build our cache, which will take a few minutes`);
    const invFileName = `${config.eveData.sde.cache}/sde/bsd/invNames.yaml`;
    const allInv = yaml.parse(fs.readFileSync(invFileName, 'utf8'));
    console.log(`${OK_CHAR} ${hilite(allInv.length)} names discovered`);

    idsToNames = allInv.reduce((a, x) => {
      a[x.itemID] = x.itemName;
      _lfsSpin.spin();
      return a;
    }, {});

    allNamesToIds = allInv.reduce((a, x) => {
      _lfsSpin.spin();
      if (!(x.itemName in a)) {
        a[x.itemName] = [];
      }
      a[x.itemName].push(x.itemID);
      return a;
    }, {});

    const uniqinvFileName = `${config.eveData.sde.cache}/sde/bsd/invUniqueNames.yaml`;
    uniqInv = yaml.parse(fs.readFileSync(uniqinvFileName, 'utf8'));
    console.log(`${OK_CHAR} ${hilite(uniqInv.length)} unique names discovered`);

    uniqNamesToIds = uniqInv.reduce((a, x) => {
      _lfsSpin.spin();
      if (!(x.itemName in a)) {
        a[x.itemName] = [];
      }
      a[x.itemName].push(x.itemID);
      return a;
    }, {});

    let lookup = { 
      all: allNamesToIds, 
      uniq: uniqNamesToIds, 
      fromId: idsToNames,
      items: {},
      __dirty: true
    };

    const invItemsName = `${config.eveData.sde.cache}/sde/bsd/invItems.yaml`;
    const allItems = yaml.parse(fs.readFileSync(invItemsName, 'utf8'));
    console.log(`${OK_CHAR} ${hilite(allItems.length)} items discovered`);
    itemLookup = allItems.reduce((a, x) => {
      _lfsSpin.spin();
      if (!(x.itemID in a)) {
        a[x.itemID] = []
      }

      a[x.itemID].push(x.locationID);
      return a;
    }, {});

    const addLocationsToIdRanges = (groupName, idRange) => {
      if (!Array.isArray(idRange) || idRange.length !== 2) {
        throw new Error("arg error");
      }

      const group = allInv.filter(x => { 
        _lfsSpin.spin();
        return x.itemID >= idRange[0] && x.itemID <= idRange[1];
      });
      group.forEach((x) => {
        _lfsSpin.spin();
        lookup.fromId[x.itemID] = {
          name: x.itemName,
          in: itemLookup[x.itemID]
        };
      });

      console.log(`${OK_CHAR} ${hilite(group.length)} ${groupName} discovered`);
      return group.length;
    };

    addLocationsToIdRanges('regions', [10000000, 13000000]);
    addLocationsToIdRanges('constellations', [20000000, 23000000]);
    let systemsCount = addLocationsToIdRanges('systems', [30000000, 33000000]);
    _lfsSpin.spin(true);

    console.log(`${WORKING_CHAR} Building system lookup table…`);
    let buildCount = 0;
    let timeMark = Date.now();
    let buildSpin = new Spinner({ spinner: 'rainbowCircles' });
    Object.keys(lookup.fromId).forEach((sysId) => {
      try {
        const sysFile = `${config.eveData.sde.cache}/sde/fsd/universe/eve/` +
          lookup.fromId[lookup.fromId[lookup.fromId[sysId].in[0]].in[0]].name.replace(/\s+/g, '') + '/' +
          lookup.fromId[lookup.fromId[sysId].in[0]].name.replace(/\s+/g, '').replace('Tranquility', 'Tranquillity') + '/' + 
          lookup.fromId[sysId].name.replace(/\s+/g, '') + '/solarsystem.staticdata';

        if (fs.existsSync(sysFile)) {
          lookup.fromId[sysId].info = yaml.parse(fs.readFileSync(sysFile, 'utf8'));
        }

        if (!(++buildCount % 2000)) {
          const bt = Math.round((Date.now() - timeMark) / 1000);
          logger.verbose(`${buildCount} systems took ${bt}`);
          console.log(`${OK_CHAR} ${chalk.bold(buildCount)} systems processed in ${lolite(bt)}s`);
        }
        buildSpin.spin();
      } catch (err) { }
    });
    buildSpin.spin(true);

    if (buildCount !== systemsCount) {
      console.log(`${ALERT_CHAR} Missed ${systemsCount - buildCount} system(s)`);
    }

    spawnSync('/bin/rm', ['-fr', unpackDir]);
    const procTimeRaw = Date.now() - loadFromSDE_start;
    const procTime = moment.duration(procTimeRaw).humanize();
    logger.info(`static data processing took ${procTimeRaw}`);
    console.log(`${INFO_CHAR} Static data processing took ${lolite(procTime)}`);
    return lookup;
  }; // loadFromSDE

  let cache;
  
  if (fs.existsSync(ourCacheName)) {
    try {
      const verifyStart = Date.now();

      if (!fs.existsSync(ourCacheVerifyName)) {
        throw new Error('verify DNE');
      }
    
      verify = JSON.parse(fs.readFileSync(ourCacheVerifyName));

      if (verify.size !== fs.statSync(ourCacheName).size) {
        throw new Error('size');
      }
    
      let _crpStart = Date.now();
      const readStr = fs.readFileSync(ourCacheName);
      cache = JSON.parse(readStr);
      logger.verbose(`cache read-and-parse took ${Date.now() - _crpStart}`);

      if (cache.__dirty === true) {
        logger.warn(`loaded a dirty cache!`);
      }

      if (verify.checksum !== calcChecksum(readStr)) {
        throw new Error('checksum');
      }

      let lengthsOk = Object.keys(verify.expectLengths)
        .every(vK => vK in cache && Object.keys(cache[vK]).length === verify.expectLengths[vK])

      if (!lengthsOk) {
        throw new Error('lengths');
      }
    
      logger.info(`cache verification took ${Date.now() - verifyStart}`);
      // xxx temp fixup, remove!
      if (!('items' in cache)) { cache.items = {}; cache.__dirty = true; }
    }
    catch (verifyError) {
      logger.error(`cache verify: ${verifyError}`);
      applock.resetApp();
      console.log(`${ALERT_CHAR} Cache verification failure on ` + 
        `${chalk.bold.red(verifyError.message)}: resetting app as required`);
      applock.checkAppIdFile();
      cache = null;
    }
  }
  
  if (!cache) {
    cache = await loadFromSDE();
    persistStaticCache();
  }

  return cache;
}; // refreshStaticDataCache

const onLoadCallbacks = [];

// returns cached auth token if available
const initialize = async () => {
  let token;

  if (config.app.cacheFile && fs.existsSync(config.app.cacheFile)) {
    cache = JSON.parse(fs.readFileSync(config.app.cacheFile));
    token = await auth.checkCachedAuth(cache);
  }

  if (config.app.useStaticDataCache) {
    if ((staticCache = await refreshStaticDataCache())) {
      console.log(`${OK_CHAR} Data cache verified`);
    } else {
      errExit('Static cache load');
    }
  } else {
    console.log(`${WARN_CHAR} EVE static data cache ${chalk.bold('disabled')}` +
      '; most operations will be slowed');
  }

  onLoadCallbacks.forEach((olCb) => olCb());

  return token;
};

const getStaticCache = () => staticCache;

const messages = () => cache.msgQueue;

const onLoad = (olCb) => onLoadCallbacks.push(olCb);

module.exports = {
  initialize,
  writeCache,
  setInCache,
  persistStaticCache,
  getStaticCache,
  messages,
  onLoad
};
