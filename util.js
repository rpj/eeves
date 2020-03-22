const chalk = require('chalk');
const readline = require('readline');

const applock = require('./applock');
const { ALERT_CHAR } = require('./style');

const errExit = (msg) => {
  console.log(ALERT_CHAR + ' ' + chalk.bold.bgRed.white(msg));
  applock.releaseAppLock();
  process.exit(-1);
};

class Spinner {
  constructor(opts = {}) {
    const spinners = {
      default: "▉▊▋▌▍▎▏▎▍▌▋▊▉",
      circles: "◐◓◑◒",
      rainbowCircles: [chalk.red("◐"), chalk.cyan("◓"), chalk.green("◑"), chalk.yellow("◒")]
    }

    this.stackBanner = opts.banner || ''
    this.bannerChar = opts.bannerChar || '☰'
    this.spinner = spinners[opts.spinner] || spinners.default
    this.spindex = 0
  }

  spin (final = false) {
    if (process.stdout.isTTY) {
      const sChar = chalk.bold((this.spinner[(this.spindex++ % this.spinner.length)]))
      process.stdout.write(` ${sChar} ${this.stackBanner}`)
      if (final)
        readline.clearLine(process.stdout, -1)
      readline.cursorTo(process.stdout, 0)
    }

    if (final && this.stackBanner) {
      console.log(chalk.bold(chalk.green(` ${this.bannerChar} `)) + this.stackBanner)
    }
  }
}

module.exports = {
  errExit,
  Spinner
};
