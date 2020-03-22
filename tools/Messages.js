const moment = require('moment');
const chalk = require('chalk');
const cache = require('../cache');
const logger = require('../logger');
const { DOWN_CHAR, hilite, lolite, subItem } = require('../style');

let msgQueue = [];
cache.onLoad(() => { 
  msgQueue = cache.messages() || []; 
  logger.info(`loaded ${msgQueue.length} messages from cache`);
});

const submitMsg = (msg) => {
  const newLen = msgQueue.unshift({ msg: msg, ts: moment() });
  cache.setInCache('msgQueue', msgQueue);
  process.stdout.write(`${DOWN_CHAR} ${lolite(String(newLen).padStart(3, ' '))} ${hilite('unread messages')}\r`);
};

const readAllMsgs = () => {
  const rv = msgQueue.splice(0);
  cache.setInCache('msgQueue', msgQueue);
  return rv;
};

const getNumUnread = () => msgQueue.length;

const displayName = () => 'Messages' + (msgQueue.length > 0 ? ` (${chalk.bold(msgQueue.length)})` : '');

const runTool = async () => {
  subItem(`${hilite(msgQueue.length)} new messages:`);
  const spacer = chalk.bgGrey(`-----------------------------\n`);
  readAllMsgs().forEach(x => console.log(`${chalk.bgBlue(spacer)}${chalk.bold(x.ts.toLocaleString())}\n${spacer}${x.msg}\n${spacer}`));
};

module.exports = { submitMsg, readAllMsgs, getNumUnread, runTool, displayName };