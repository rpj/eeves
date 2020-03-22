const inq = require('inquirer');
const chalk = require('chalk');
const esireq = require('../esireq');
const { OK_CHAR, WORKING_CHAR } = require('../style');

module.exports.runTool = async () => {
  let lookupBy = await inq.prompt({ type: 'list', name: 'choice', 
    message: 'By?', choices: ['Name', 'ID', 'Type', 'Raw ESI Request']});
  if (lookupBy.choice === 'Name') {
    let result = await esireq.allCatProperSearch((await inq.prompt({ type: 'input', name: 'choice', message: 'Item name:' })).choice);
    console.log(result);
  }
  else if (lookupBy.choice === 'ID') {
    let search = await inq.prompt({ type: 'input', name: 'choice', message: 'Item ID:' });
    let searchRes = cache.getStaticCache().fromId[search.choice];
    if (!searchRes) {
      searchRes = await esireq.allCatOnlineSearch(search.choice, true);
    }
    console.log(searchRes);
  }
  else if (lookupBy.choice === 'Type') {
    let search = await inq.prompt({ type: 'input', name: 'choice', message: 'Type ID:' });
    let item = await esireq.itemFromId(search.choice);
    console.log(item);
  }
  else if (lookupBy.choice === 'Raw ESI Request') {
    const urlPost = (await inq.prompt({ type: 'input', name: 'choice', message: 'URL postfix:' })).choice;
    console.log(`${WORKING_CHAR} Fetching ${chalk.bold(esireq.esiUrl(urlPost))}`);
    const _fst = Date.now();
    const resp = await (await esireq.esiReq(urlPost)).json();
    console.log(`${OK_CHAR} Request took ${chalk.bold(Date.now() - _fst)}ms`);
    console.log(resp);
  }
};