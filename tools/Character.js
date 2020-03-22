const config = require('config');
const chalk = require('chalk');
const moment = require('moment');
const numeral = require('numeral');

const logger = require('../logger');
const { esiReq, charReq, univReq, objFromId, esiCharacter } = require('../esireq');
const { subItem, hilite, lolite } = require('../style');

let charLoc;
let systemInfo;
let stationInfo;
let constInfo;
let regionInfo;

let refreshCharLoc_last = 0;
const refreshCharLoc = async () => {
  const _st = Date.now();
  if (refreshCharLoc_last && _st - refreshCharLoc_last < ((config.app.character.minimumCharacterRefresh * 60) * 1000)) {
    logger.verbose(`#refreshCharLoc SKIP! ${refreshCharLoc_last} ${_st}`);
    return;
  }
  charLoc = await charReq('location');
  systemInfo = await univReq('systems', charLoc.solar_system_id);
  stationInfo = await univReq('stations', charLoc.station_id);
  constInfo = await objFromId(systemInfo.constellation_id);
  regionInfo = await objFromId(constInfo.in[0]);
  regionInfo.region_id = constInfo.in[0];
  logger.info(`#refreshCharLoc took ${Date.now() - _st}`);
  refreshCharLoc_last = _st;
};

const showCharacterCard = async () => {
  await refreshCharLoc();
  const _sccTime = Date.now();
  const serverStats = await (await esiReq('status')).json();

  console.log(`${hilite(serverStats.players)} online, ` + 
    `last downtime ${lolite(moment().to(serverStats.start_time))}`);

  const charOnline = await charReq('online');
  const charSkills = await charReq('skills');
  const charWallet = await charReq('wallet');
  const onlineDot = (charOnline.online ? chalk.green : chalk.red).bold('•');
  const alphaOmega = chalk.bold(esiCharacter().ExpiresOn ? chalk.yellow('Ω') : chalk.red('α'));
  console.log(chalk.bold(
    `${onlineDot} ${chalk.bold.bgBlue(esiCharacter().CharacterName)} ${alphaOmega}` +
    ` - ${chalk.green(numeral(charWallet).format('0.00a'))} ISK` + 
    ` - ${lolite(numeral(charSkills.total_sp).format('0.00a'))} SP`
  ));
  if (!charOnline.online) {
    subItem(`Last logged in ${hilite(moment().to(charOnline.last_logout))} (${lolite(charOnline.logins)} logins)`);
  }
  
  const charShip = await charReq('ship');
  const shipInfo = await univReq('types', charShip.ship_type_id);
  subItem(`Piloting a ${lolite(shipInfo.name)} named "${hilite(charShip.ship_name)}"`);
  
  const constInfo = await objFromId(systemInfo.constellation_id);
  const regionInfo = await objFromId(constInfo.in[0]);
  subItem(`In ${hilite(systemInfo.name)} / ${chalk.blue(constInfo.name)} / ${lolite(regionInfo.name)} ` + 
    ('name' in stationInfo ? `at\n    ${lolite(JSON.stringify(stationInfo.name))}` : chalk.bold.red('undocked')));
  logger.info(`#showCharacterCard took ${Date.now() - _sccTime}`);
}

const currentCharacterInfo = async () => {
  await refreshCharLoc();
  return {
    charLoc,
    systemInfo,
    stationInfo,
    constInfo,
    regionInfo
  };
};

const runTool = async () => showCharacterCard();

module.exports = {
  currentCharacterInfo,
  showCharacterCard,
  runTool
};
