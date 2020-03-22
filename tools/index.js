const fs = require('fs');
const logger = require('../logger');

let _exports = {};

fs.readdirSync(__dirname).forEach(dirent => {
  if (dirent !== 'index.js' && dirent.endsWith('.js')) {
    const modName = dirent.replace('.js', '').replace('-', '');
    try {
      let module = require(`./${modName}`);
      if (typeof module === 'object' && 'runTool' in module) {
        _exports[modName] = module;
      }
    } catch (err) {
      logger.warn(`unable to register '${modName}': ${err}`)
    }
  }
});

module.exports = _exports;
