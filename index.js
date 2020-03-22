const { Issuer, generators } = require('openid-client');
const url = require('url');
const fetch = require('node-fetch');
const config = require('config');
const inq = require('inquirer');
const chalk = require('chalk');

const USER_AGENT = config.app.userAgent;

(async () => {
  const discIssuer = await Issuer.discover('https://login.eveonline.com');
  const eveAuthClient = new discIssuer.Client(config.credentials);
  const verif = generators.codeVerifier();
  const challenge = generators.codeChallenge(verif);
  const authUrl = eveAuthClient.authorizationUrl(Object.assign({}, config.authOpts, {
    challenge,
    code_challenge_method: 'S256'
  }));

  console.log(chalk.bold.green('> ') + chalk.bold('Visit this URL in a logged-in browser: \n') + authUrl + '\n');

  const authCode = (await inq.prompt({ type: 'input', name: 'authCode',
    message: `The ${chalk.black.bgYellow('entire')} URL you are directed to after login:` })).authCode;

  const authParams = eveAuthClient.callbackParams(authCode);
  const urlParsed = url.parse(authCode);
  let cbResp = await eveAuthClient.oauthCallback(`${urlParsed.protocol}\/\/${urlParsed.host}`, 
    authParams, { code_verifier: verif, ...authParams });

  const expiresIn = cbResp.expires_at * 1000 - Date.now();
  console.log(cbResp.access_token);
  console.log(`Received access token that expires in ${expiresIn} seconds; verifying it...`);

  const mainHeaders = { 'X-User-Agent': USER_AGENT, Authorization: `Bearer ${cbResp.access_token}` };
  const mainReqOpts = { headers: mainHeaders};
  const verifResp = await fetch('https://esi.evetech.net/verify/?datasource=tranquility', mainReqOpts);

  if (!verifResp.ok) {
    throw new Error('verify');
  }

  const verifyBody = await verifResp.json();
  console.log(`Verified login as '${verifyBody.CharacterName}' (ID: ${verifyBody.CharacterID})`);

  const charReqPre = `https://esi.evetech.net/latest/characters/${verifyBody.CharacterID}`
  const charReq = async (stubPost) => { return (await fetch(`${charReqPre}/${stubPost}`, mainReqOpts)).json(); };
  const charLoc = await charReq('location');
  const charShip = await charReq('ship');
  console.log(charLoc);
  console.log(charShip);
})()
