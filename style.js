const chalk = require('chalk');

const BRK_CL = chalk.bold.grey;
const O_BRK = BRK_CL('(');
const C_BRK = BRK_CL(')');
const brks = (c) => O_BRK + c + C_BRK;
const INFO_CHAR = brks(chalk.bold.cyan('i'));
const OK_CHAR = brks(chalk.bold.green('✓'));
const NOPE_CHAR = brks(chalk.bold.red('X'));
const ALERT_CHAR = brks(chalk.bgRed.bold('!'));
const WARN_CHAR = brks(chalk.yellow.bold('!'));
const QUES_CHAR = brks(chalk.bold.yellow('?'));
const DOWN_CHAR = brks(chalk.bold.cyan('↓'));
const WORKING_CHAR = brks(chalk.bold.yellow('~'));
const SUBITEM_CHAR = ` ${chalk.bold.grey('✦')}`;

const subItem = (x) => console.log(`${SUBITEM_CHAR} ${x}`);
const hilite = (x) => chalk.cyan.bold(x);
const lolite = (x) => chalk.blue.bold(x);

module.exports = {
  INFO_CHAR,
  OK_CHAR,
  NOPE_CHAR,
  ALERT_CHAR,
  WARN_CHAR,
  QUES_CHAR,
  DOWN_CHAR,
  WORKING_CHAR,
  SUBITEM_CHAR,
  subItem,
  hilite,
  lolite
};
