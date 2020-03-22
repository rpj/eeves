const qs = require('querystring');
const inq = require('inquirer');
const chalk = require('chalk');
const fetch = require('node-fetch');
const config = require('config');

const cache = require('./cache');
const logger = require('./logger');
const { Spinner } = require('./util');
const { hilite, lolite, INFO_CHAR } = require('./style');

let USER_AGENT;
let mainHeaders;
let mainReqOpts;
let charReqPre;
let verifyBody;

const API_ROOT = `${config.eveApi.root}/${config.eveApi.version}`;

const esiUrl = (urlPost) => `${API_ROOT}/${urlPost}`;

const esiReq = async (urlPost, opts) => {
  logger.debug(`#esiReq ${esiUrl(urlPost)}`);
  return fetch(esiUrl(urlPost), Object.assign({}, mainReqOpts, opts));
};

const charReq = async (stubPost) => { return (await esiReq(`${charReqPre}/${stubPost}`)).json(); };
const univReq = async (stub, id) => { return (await esiReq(`universe/${stub}` + (id ? `/${id}` : ''))).json(); };

const onlineSearch = async (categories, searchStr, strict = false) => {
  const ssSearch = `${API_ROOT}/search/?categories=` +
    `${Array.isArray(categories) ? categories.join(',') : categories}` +
    `&language=en-us&strict=${strict}`;
  return (await fetch(`${ssSearch}&search=${qs.escape(searchStr)}`)).json()
};

const allCategories = 'agent,alliance,character,constellation,corporation,' +
  'faction,inventory_type,region,solar_system,station';

const allCatOnlineSearch = onlineSearch.bind(null, allCategories);

const solSys = async (sysId) => {
  const staticCache = cache.getStaticCache();
  const static_solSys = (sysId) => {
    if (staticCache && sysId in staticCache.fromId) {
      return staticCache.fromId[sysId];
    }
  };

  let sys;
  if (staticCache) {
    let sSys = static_solSys(sysId);
    sys = { name: sSys.name, security_status: sSys.info.security };
  } else {
    sys = await univReq('systems', sysId);
  }
  return sys;
};

const itemFromId = async (itemId) => {
  const staticCache = cache.getStaticCache();
  if (!(staticCache && itemId in staticCache.items)) {
    let fetchedItem = await univReq('types', itemId);
    if (staticCache) logger.info(`#itemFromId cache miss item #${itemId}: '${fetchedItem.name}'`);
    staticCache.items[itemId] = fetchedItem;
    staticCache.__dirty = true;
  }

  return staticCache.items[itemId];
};

const objFromId = async (itemId) => {
  if (itemId < 500000) {
    return itemFromId(itemId);
  }

  const staticCache = cache.getStaticCache();
  if (staticCache && itemId in staticCache.fromId) {
    let retObj = staticCache.fromId[itemId];
    return retObj;
  }

  if (staticCache) logger.info(`#objFromId cache miss ID ${itemId}`);
  return allCatOnlineSearch(itemId);
};

const nameFromId = async (itemId) => {
  if (!itemId) return;
  let retObj = await objFromId(itemId);
  return typeof retObj === 'string' ? retObj : retObj.name;
};

const updateToken = (newToken) => {
  mainHeaders = { 
    'X-User-Agent': USER_AGENT, 
    'User-Agent': USER_AGENT, 
    Authorization: `Bearer ${newToken.access_token}`
  };

  mainReqOpts = { headers: mainHeaders };
}

const selMultiples = async (multList, sStr) => {
  let _spin = new Spinner();
  let xform = {}
  for (ssId of multList) {
    _spin.spin();
    xform[(await nameFromId(ssId))] = ssId;
  }
  _spin.spin(true);

  let multOpt = await inq.prompt({
    type: 'list',
    name: 'choice',
    message: `${lolite(multList.length)} results were found for '${hilite(sStr)}':`,
    filter: (x) => xform[x],
    choices: Object.keys(xform)
  });
  
  return multOpt.choice;
};

const properSearch = async (searchName, categories = null) => {
  let search = { choice: searchName };
  let searchRes;
  
  const staticCache = cache.getStaticCache();
  if (staticCache) {
    if (search.choice in staticCache.uniq) {
      searchRes = staticCache.uniq[search.choice];
    } else if (search.choice in staticCache.all) {
      searchRes = staticCache.all[search.choice];
    }
  }

  if (!searchRes) {
    searchRes = await (categories !== null ? 
      onlineSearch(categories, search.choice) : 
      onlineSearch('inventory_type', search.choice));
    let select;
    if (categories !== null) {
      let catType = await inq.prompt({ type: 'list', name: 'choice',
        message: `Found results in ${hilite(Object.keys(searchRes).length)} categories:`,
        choices: Object.keys(searchRes)});
      select = searchRes[catType.choice];
      if (select.length > 1) {
        console.log(chalk.bold(`${INFO_CHAR} Found ${lolite(select.length)} results for '${hilite(catType.choice)}':`));
        select = await selMultiples(searchRes[catType.choice], catType.choice);
      }
    }
    else {
      select = await selMultiples(searchRes.inventory_type, searchName);
    }

    searchRes = select;
  }
  else {
    console.log('searchRes:');
    console.log(searchRes);
  }

  return searchRes;
};

const allCatProperSearch = async (searchName) => properSearch(searchName, allCategories);

const initialize = async (ua, token) => {
  USER_AGENT = ua;
  updateToken(token);
  verifyBody = await (await fetch('https://esi.evetech.net/verify', mainReqOpts)).json();
  charReqPre = `characters/${verifyBody.CharacterID}`;
  return verifyBody;
};

const esiCharacter = () => verifyBody;

const userAgent = () => USER_AGENT;

module.exports = {
  initialize,
  esiUrl,
  esiReq,
  updateToken,
  charReq,
  univReq,
  onlineSearch,
  solSys,
  itemFromId,
  objFromId,
  nameFromId,
  properSearch,
  allCatOnlineSearch,
  allCatProperSearch,
  esiCharacter,
  userAgent,
  selMultiples
};
