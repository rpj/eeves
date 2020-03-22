const config = require('config');
const os = require('os');
const inq = require('inquirer');
const chalk = require('chalk');
const moment = require('moment');
const readline = require('readline');

const auth = require('./auth');
const cache = require('./cache');
const tools = require('./tools');
const esireq = require('./esireq');
const logger = require('./logger');
const applock = require('./applock');
const { errExit } = require('./util');
const { INFO_CHAR, OK_CHAR, ALERT_CHAR, lolite } = require('./style');

const USER_AGENT = `${logger.APP_NAMEVER} (${os.platform()}; ${os.arch()} ${os.release()})`;

if (!applock.checkAppIdFile()) {
  throw new Error('checkAppIdFile');
}

const banner = `${chalk.bold(logger.APP_NAMEVER)} started ${moment().toLocaleString()}`;
logger.info(banner);
logger.info(`${applock.getAppId()} config: ${JSON.stringify(config.app, null, 2)}`);
logger.verbose(`user-agent: "${USER_AGENT}"`);
console.log(`${INFO_CHAR} ${banner}`);

let _mainStart;

const appCleanup = () => {
  console.log();
  let cacheWritten = cache.persistStaticCache();
  cache.writeCache();
  applock.releaseAppLock();
  const ranTime = Date.now() - _mainStart;
  logger.info(`SIGINT - ran for ${moment.duration(ranTime).humanize()} (${ranTime})`);
  // winston is annoying sometimes
  let delay = cacheWritten ? 100 : 0;
  setTimeout(() => {
    console.log(chalk.bold(`${OK_CHAR} Done!`));
    process.exit(0);
  }, delay);
};


const menuBanner = () => console.log(INFO_CHAR + chalk.bold(' [' + chalk.bgBlue('ESC') + 
  `] toggles ${chalk.green('the menu')}, ` + `[${chalk.yellow('CTRL+C')}] exits`));

let theFullMenu_promptHandle;
let autohideHandle;
let fullMenuUp = false;

const menuReset = (forced = false) => {
  clearTimeout(autohideHandle);
  if (forced) {
    if (!theFullMenu_promptHandle) {
      throw new Error('forced close without handle');
    }
    theFullMenu_promptHandle.ui.close();
    theFullMenu_promptHandle = undefined;
  }
  process.stdin.setRawMode(true);
  process.stdin.resume();
  fullMenuUp = false;
  console.log('\n');
  menuBanner();
};

const autohideTimer = (reset = true) => {
  if (config.app.menuAutohideDelay) {
    clearTimeout(autohideHandle);
    if (reset) {
      autohideHandle = setTimeout(() => menuReset(true), (config.app.menuAutohideDelay * 1000));
    }
  }
};

const startAutohideTimer = autohideTimer.bind(null, true);
const resetAutohideTimer = autohideTimer.bind(null, true);
const stopAutohideTimer = autohideTimer.bind(null, false);

const theFullMenu = async () => {
  let loopCount = 0;
  if (fullMenuUp) {
    throw new Error('nope');
  }
  fullMenuUp = true;
  while (true) {
    try {
      let fullMap = Object.keys(tools).filter(x => 'runTool' in tools[x]).reduce((a, x) => {
        let tKey = x;
        if ('displayName' in tools[x]) {
          tKey = tools[x].displayName();
        }

        a[tKey] = tools[x];
        return a;
      }, {});

      startAutohideTimer();
      theFullMenu_promptHandle = inq.prompt({
        type: 'list',
        name: 'choice',
        message: `Main menu${(loopCount++ > 1 ? `; [${chalk.bgBlue('ESC')}] hides` : '')}:`,
        choices: Object.keys(fullMap).sort()
      });

      let opt = await Promise.resolve(theFullMenu_promptHandle);
      stopAutohideTimer();

      await fullMap[opt.choice].runTool();
      console.log();
    } catch (ilErr) {
      console.log(`${ALERT_CHAR} unknown error '${chalk.yellow(ilErr.message)}':`);
      console.log(ilErr);
      logger.error(`inner loop exception: ${ilErr.message}\n${ilErr}`);
    }
  }
}

const main = async () => {
  _mainStart = Date.now();
  if (!config.credentials.client_id || !config.credentials.client_secret) {
    errExit('Bad EVE client credentials!');
  }

  if (!applock.acquireAppLock()) {
    const errmsg = `Another instance is already running!`;
    logger.error(errmsg);
    console.log(chalk.bold.bgRed(errmsg));
    process.exit(-2);
  }

  process.on('SIGINT', appCleanup);

  let token = await cache.initialize();

  const setNewToken = (newToken) => {
    token = newToken;
    esireq.updateToken(token);
    cache.setInCache('token', token);
  };

  let wasNewAuth = false;
  if (!token) {
    token = await auth.newAuth(USER_AGENT);
    setNewToken(token);
    wasNewAuth = true;
  }

  const verifyBody = await esireq.initialize(USER_AGENT, token);

  console.log(`${INFO_CHAR} Have valid authentication, expiring ` + 
    `${lolite(moment().to(moment.unix(token.expires_at)))}`);

  console.log();

  await auth.scheduleTokenRenewal(token, setNewToken);

  if (wasNewAuth || config.app.character.autoloadCard) {
    await tools.Character.showCharacterCard();
    console.log();
  }

  tools.Market.startMarketRefresh();
  tools.Market.startMarketPriceRefresher();

  logger.info(`startup took ${Date.now() - _mainStart}`);

  process.stdin.setRawMode(true);
  readline.emitKeypressEvents(process.stdin);

  menuBanner();
  theFullMenu().then(menuReset);

  process.stdin.on('keypress', (str, key) => {
    resetAutohideTimer();

    if (!fullMenuUp && key.name === 'escape' && key.meta) {
      if (theFullMenu_promptHandle) {
        throw new Error('no theFullMenu_promptHandle here!');
      }
      theFullMenu().then(menuReset);
    }
    else if (fullMenuUp && key.name === 'escape' && key.meta && theFullMenu_promptHandle) {
      if (theFullMenu_promptHandle.ui.activePrompt.status === 'pending') {
        menuReset(true);
      }
    }
    else if (key.name === 'c' && key.ctrl === true) {
      appCleanup();
    }
  });
};

(async () => {
  try { 
    await main(); 
  } catch (e) { 
    logger.error(`UNCAUGHT ${e}`);
    applock.releaseAppLock();
    throw e;
  }
})();
