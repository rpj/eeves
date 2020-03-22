const fs = require('fs');
const config = require('config');
const inq = require('inquirer');
const fetch = require('node-fetch');
const chalk = require('chalk');
const numeral = require('numeral');

const { univReq, solSys, onlineSearch, esiReq, userAgent, selMultiples }  = require('../esireq');
const Character = require('./Character');

const {
  OK_CHAR,
  NOPE_CHAR,
  ALERT_CHAR,
  hilite,
  lolite
} = require('../style');

const runTool = async () => {
  let char = await Character.currentCharacterInfo();
  console.log(chalk.bold(`${chalk.bold.green('⍜')} Currently in system ${hilite(char.systemInfo.name)}, ` + 
    ('name' in char.stationInfo ? `${lolite('docked')}` : chalk.bold.red('undocked'))));
  let subChoice = await inq.prompt({ type: 'list', name: 'choice',
    message: `Routing tool - current security preference is ${lolite(config.app.route.securityPreference)}:`,
    choices: ['Change security preference', 'Change super-danger threshold', 'Plot route', 'Main menu']});

  if (subChoice.choice.search('security') !== -1) {
    let secChoice = await inq.prompt({ type: 'list', name: 'choice', 
      message: `Current value: ${hilite(config.app.route.securityPreference)}`,
      choices: ['secure', 'insecure', 'shortest']
    });
    config.app.route.securityPreference = secChoice.choice;
    fs.writeFileSync('config/local.json', JSON.stringify(config, null, 2));
  }
  else if (subChoice.choice.search('super') !== -1) {
    let sdThresh = await inq.prompt({ type: 'input', name: 'choice', 
      message: `Number of pod kills in a system; currently ${hilite(config.app.route.superDangerThreshold)}:`
    });
    config.app.route.superDangerThreshold = sdThresh.choice;
    fs.writeFileSync('config/local.json', JSON.stringify(config, null, 2));
  }
  else if (subChoice.choice.search('Main') !== -1) {
    return;
  }
  else {
    console.log(chalk.grey(`(use empty string to indicate current location)`));
    const sKills = await univReq('system_kills');
    const dangerZones = sKills.filter(x => x.pod_kills > 0 || x.ship_kills > 0);

    const sXform = (inp, _, opts) => (opts.isFinal && inp.length === 0 ? char.systemInfo.name : inp);
    const destChoice = async (msg, emptyValFunc) => {
      let thisChoice = await inq.prompt({ type: 'input', name: 'choice', message: msg, transformer: sXform });
      if (!thisChoice.choice || !thisChoice.choice.length) {
        thisChoice.choice = emptyValFunc();
      } else {
        let thisId = await onlineSearch('solar_system', thisChoice.choice);
        if (!Object.keys(thisId).length) {
          console.log(`${NOPE_CHAR} Nothing found for '${hilite(thisChoice.choice)}'`);
          return { choice: null };
        }
        if (!thisId.solar_system.length) errExit(`Bad destChoice '${msg}'`);
        if (thisId.solar_system.length > 1) {
          thisChoice.choice = await selMultiples(thisId.solar_system, thisChoice.choice);
        } else {
          thisChoice.choice = thisId.solar_system[0];
        }
      }
      return thisChoice;
    };

    let from = await destChoice('From?', () => char.charLoc.solar_system_id);
    if (!from) return;
    let to = await destChoice('To?', () => char.charLoc.solar_system_id);
    if (!to) return;
    let toWasNotCurrent = to.choice === char.charLoc.solar_system_id;
    let fromInfo = await solSys(from.choice);
    let toInfo = await solSys(to.choice);

    const route = await (await esiReq(`route/${from.choice}/${to.choice}?flag=${config.app.route.securityPreference}`)).json();
    let spCopy = config.app.route.securityPreference;
    console.log(`${OK_CHAR} ${lolite(spCopy.substr(0, 1).toUpperCase() + spCopy.substr(1))} ` + 
      `route from ${hilite(fromInfo.name)} to ${hilite(toInfo.name)} is ${chalk.bold.green(route.length - 1)} jumps:`);

    for (sysId of route) {
      let sys = await solSys(sysId);
      const dangerSys = dangerZones.find(x => x.system_id === sysId);
      const color = dangerSys ?
        (dangerSys.pod_kills > 0 ?
          (dangerSys.pod_kills >= config.app.route.superDangerThreshold ?
            chalk.bold.bgRed : chalk.bold.red) : chalk.bold.yellow) : chalk.bold.white;

      let zKillStr = '';
      if (config.app.zkb.maintainer) {
        if (dangerSys && dangerSys.pod_kills + dangerSys.ship_kills > 0) {
          let zKill = [];
          let zKillHdrs = { headers: { 'User-Agent': `${userAgent()}; (for zkillboard.com: maintainer ${config.app.zkb.maintainer})` } };
          try {
            zKill = await (await fetch(`https://zkillboard.com/api/kills/solarSystemID/${sysId}` + 
              `/pastSeconds/${config.app.zkb.lookbackWindow * 3600}/`, zKillHdrs)).json();
            await new Promise((r) => setTimeout(r, config.app.zkb.rlDelay)); // zKill docs say no RL, but there clearly is one
          } catch (e) { 
            logger.verbose(`zkill failed: ${JSON.stringify(e)}`); 
            zKillStr = '?!?';
          }
          if (zKill.length) {
            const iskNonNPC = zKill.reduce((a, x) => a += x.zkb.npc ? 0 : x.zkb.totalValue, 0);
            zKillStr = `[${hilite(zKill.length)}` + (iskNonNPC > 0 ? 
              ` ${chalk.bold.green(numeral(iskNonNPC).format('0.0a'))}` +
                (zKill.length > 1 ? ` ${chalk.bold.red(numeral(iskNonNPC / zKill.length).format('0.0a'))}` : 
              '') : '') + ']';
          }
        }
      } else {
        logger.info(`zkb no maintainer spec'ed, skipping!`);
      }

      const secColors = {
        '1.0': chalk.bold.green,
        '0.9': chalk.green,
        '0.8': chalk.cyan,
        '0.7': chalk.blue,
        '0.6': chalk.bold.yellow,
        '0.5': chalk.yellow
      };

      const secVal = numeral(sys.security_status).format('0.0');
      const secColor = secVal in secColors ? secColors[secVal] : chalk.red;
      console.log(secColor(` • ${secVal.padStart(4, ' ')}   `) + color(sys.name) + 
        (dangerSys ? ` (${(dangerSys.pod_kills > 0 ? `${chalk.red(dangerSys.pod_kills)}` : '')}` +
        `${(dangerSys.ship_kills > 0 ? `${dangerSys.pod_kills > 0 ? ' ' : ''}${chalk.yellow(dangerSys.ship_kills)}` : 
        '')})` : '') + ` ${zKillStr}`);
    }

    if (toWasNotCurrent && (await charReq('online')).online) {
      let plot = await inq.prompt({ type: 'confirm', name: 'choice', 
        default: false, message: 'Set destination system as waypoint?' });
      if (plot.choice) {
        let clear = await inq.prompt({ type: 'confirm', name: 'choice', 
          message: 'Clear current route?' });
        let addBegin = { choice: false };
        if (!clear.choice) {
          addBegin = await inq.prompt({ type: 'confirm', name: 'choice', 
            message: 'Add waypoint to beginning of route?' });
        }

        let wpAddResp = await esiReq('ui/autopilot/waypoint/?' +
          `add_to_beginning=${addBegin.choice}&` + 
          `clear_other_waypoints=${clear.choice}&` +
          `destination_id=${to.choice}`, { method: 'POST' });

        if (wpAddResp.ok) {
          console.log(`${OK_CHAR} Waypoint set successfully`);
        } else {
          console.log(`${ALERT_CHAR} Failed to set waypoint!`);
        }
      }
    }
  }
}

module.exports = {
  runTool
};
