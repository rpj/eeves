const fs = require('fs');
const os = require('os');
const inq = require('inquirer');
const url = require('url');
const uuid = require('uuid').v4;
const fetch = require('node-fetch');
const chalk = require('chalk');
const config = require('config');
const moment = require('moment');
const { spawnSync } = require('child_process');
const { Issuer, generators } = require('openid-client');

const logger = require('./logger');
const {
  INFO_CHAR,
  OK_CHAR,
  NOPE_CHAR,
  ALERT_CHAR,
  WARN_CHAR,
  QUES_CHAR,
  hilite
} = require('./style');

const newEveClient = async (authId) => {
  if (!authId) {
    throw new Error('newEveClient.authId');
  }

  const discIssuer = await Issuer.discover(config.eveApi.issuer);
  const ourCreds = Object.assign({}, config.credentials, { 
    redirect_uris: [`${config.credentials.redirect_uris[0]}/${authId}`]
  });

  return new discIssuer.Client(ourCreds);
};

const newAuth = async (userAgent) => {
  const authId = uuid();
  const eveAuthClient = await newEveClient(authId);
  const verif = generators.codeVerifier();
  const challenge = generators.codeChallenge(verif);
  const authUrl = eveAuthClient.authorizationUrl(Object.assign({}, config.authOpts, {
    challenge,
    code_challenge_method: 'S256'
  }));

  const prefix = `http://eve.rpjios.link/${authId}?state=auth_init`;
  const authOpenUrl = `${prefix}_get`;
  let shortenReq = await fetch(`${prefix}_set`, {
    method: 'POST',
    body: JSON.stringify(authUrl),
    headers: { 
      'Content-type': 'application/json',
      'User-Agent': userAgent
    }
  });

  if (!shortenReq.ok) {
    console.log(shortenReq);
    throw new Error(shortenReq);
  }

  if (config.app.useSystemOpen) {
    const tDir = fs.mkdtempSync('.evetmp.');
    let scriptStr
    if (os.platform() === 'darwin') {
      scriptStr = `/usr/bin/open '${authOpenUrl}'`;
    } else if (os.platform() === 'linux') {
      scriptStr = `nohup /usr/bin/xdg-open '${authOpenUrl}' &`;
    }
    if (!scriptStr) {
      throw new Error('Unrecognized platform! Set config.app.useSystemOpen to false!');
    }
    fs.writeFileSync(`${tDir}/script`, scriptStr);
    console.log(INFO_CHAR + ' ' + chalk.bgBlue.bold('The login page has been opened in your default browser')); 
    if (os.platform() === 'linux') {
      console.log(ALERT_CHAR + ' ' + chalk.bold.yellow('You must close the browser when authorization is complete to continue!'));
    }
    spawnSync('/bin/bash', [`${tDir}/script`]);
    fs.unlinkSync(`${tDir}/script`);
    fs.rmdirSync(tDir);
  } else {
    console.log(INFO_CHAR + ' ' + chalk.bold.bgBlue('Visit this URL in a logged-in browser:') + 
      '\n    ' + chalk.underline.bold.cyan(authOpenUrl) + '\n');
  }

  const waitForCode = async () => {
    const reqOpts = { headers: { 'User-Agent': userAgent } };
    if (config.app.useSimpleAuthResponse) {
      return (await inq.prompt({ type: 'input', name: 'authCode',
        message: `Paste the ${chalk.black.bgYellow('entire')} URL you are directed to after login:` })).authCode;
    }
    else {
      const preUri = `${config.credentials.redirect_uris[0]}/${authId}`;
      let toCountdown = (config.app.authTimeout * 60) / config.app.http.pollFreq;
      let codeTry;

      while (toCountdown-- > 0 && (!codeTry || !('token' in codeTry))) {
        await new Promise((r) => setTimeout(r, config.app.http.pollFreq * 1000));
        codeTry = await (await fetch(`${preUri}?state=auth_get`, reqOpts)).json();
      }

      if (toCountdown <= 0) {
        logger.info('auth timeout');
        errExit(`Timed out waiting for authorization response!` +
          `\n${chalk.reset('\t(try setting config.app.useSimpleAuthResponse to true)')}`);
      }

      if (!(await fetch(`${preUri}?state=auth_complete`, reqOpts)).ok) {
        console.log(`${ALERT_CHAR} Failed to clear auth tokens from server!`);
      }

      return `${preUri}?state=${codeTry.token.state}&code=${codeTry.token.code}`;
    }
  };

  let _startWait = Date.now();
  const authCode = await waitForCode();
  logger.info(`waiting for auth code took ${Date.now() - _startWait}`);

  if (!config.app.useSimpleAuthResponse) {
    console.log(`${OK_CHAR} Authorization tokens received, validating…`);
  }

  const authParams = eveAuthClient.callbackParams(authCode);
  const urlParsed = url.parse(authCode);
  return eveAuthClient.oauthCallback(`${urlParsed.protocol}\/\/${urlParsed.host}`, 
    authParams, { code_verifier: verif, ...authParams });
};

const renewAuth = async (token, quiet = false) => {
  const expiresIn = Math.floor(token.expires_at - Date.now() / 1000);
  logger.info(`#renewAuth current token expiry ${expiresIn}s`);
  if (expiresIn > 0 && token.refresh_token) {
    if (!quiet) console.log(`${QUES_CHAR} Authorization is renewable, attempting…`);
    logger.verbose('auth renewing...');
    const client = await newEveClient(uuid());
    const refreshRes = await client.refresh(token.refresh_token);
    if (refreshRes.access_token) {
      if (!quiet) console.log(`${OK_CHAR} Authorization renewed successfully`);
      logger.verbose('auth renewed');
      return refreshRes;
    } else {
      if (!quiet) console.log(`${NOPE_CHAR} Failed to renew authorization! Must re-login`);
      logger.error('auth renew failed');
      logger.verbose(JSON.stringify(refreshRes));
    }
  } else {
    if (!quiet) console.log(`${WARN_CHAR} Authorization is ` +
      `${chalk.red('not')} renewable; must re-login`);
    logger.verbose('auth not renewable ' + expiresIn + ' ' + token.refresh_token);
  }
};

const checkCachedAuth = async (cache) => {
  let retVal;

  if (cache.token) {
    const expiresIn = Math.floor(cache.token.expires_at - Date.now() / 1000);
    const stale = !(expiresIn > (config.app.minTokenExpiry * 60));
    console.log((stale ? WARN_CHAR : INFO_CHAR) + ' ' +
      `Found ${stale ? chalk.yellow('stale ') : ''}cached authorization ` + 
      `${cache.character ? `for ${hilite(cache.character.CharacterName)}` : ''}`);

    if (!stale) {
      let answer = { use: config.app.alwaysUseCachedAuth };
      if (!answer.use) {
        answer = await inq.prompt({ type: 'confirm', message: 'Use this authorization?', name: 'use'});
      }

      if (answer.use) {
        retVal = cache.token;
      } else {
        fs.unlinkSync(config.app.cacheFile);
        console.log(chalk.bold(`${ALERT_CHAR} Removing cached authorization and requesting anew!`));
      }
    } else {
      retVal = await renewAuth(cache.token);
    }
  }

  return retVal;
};

let renewTimeout;
const scheduleTokenRenewal = async (token, onRenew) => {
  clearTimeout(renewTimeout);
  // TODO: should use minTokenExpiry here!
  const renewTime = Math.floor(((token.expires_at * 1000) - Date.now()) * 0.90);
  logger.verbose(`expiry ${moment(token.expires_at * 1000).toISOString()}, renewTime is ` + 
    `${moment.duration(renewTime).humanize()} (${renewTime})`);
  renewTimeout = setTimeout(async () => {
    logger.verbose('renew timer fired');
    token = await renewAuth(token, true);
    if (onRenew) {
      onRenew(token);
    }
    await scheduleTokenRenewal(token);
  }, renewTime);
};

module.exports = {
  checkCachedAuth,
  newAuth,
  scheduleTokenRenewal
};
