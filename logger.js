const fs = require('fs');
const path = require('path');
const config = require('config');
const winston = require('winston');

const pJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const APP_NAMEVER = `${pJson.name}/${pJson.version}`;

const logger = winston.createLogger({
  level: config.app.log.level,
  defaultMeta: { service: APP_NAMEVER },
  transports: [ new winston.transports.File({ 
    filename: path.resolve(config.app.log.file)
  })],
  format: winston.format.combine(
    winston.format.label({ label: `${APP_NAMEVER}` }),
    winston.format.splat(),
    winston.format.timestamp(),
    winston.format.printf((info) => {
      return `${info.timestamp} [${info.label}] ${info.level}: ${info.message}`
    })
  )
});

logger.APP_NAMEVER = APP_NAMEVER;

module.exports = logger;
