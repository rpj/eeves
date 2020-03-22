const config = require('config');
const inq = require('inquirer');
const chalk = require('chalk');
const moment = require('moment');
const numeral = require('numeral');

const Character = require('./Character');
const Messages = require('./Messages');
const logger = require('../logger');
const { charReq, esiReq, itemFromId, nameFromId, properSearch } = require('../esireq');
const { Spinner } = require('../util');

const {
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
} = require('../style');

const marketWork = [];
let marketHandle;
let marketRefresherRunning = false;
let localMarketCache = {};
let lmcStats = {};

const submitMarketWorkItem = (item) => {
  if ('name' in item && 'exec' in item) {
    marketWork.push(item);
  }
};

const marketWorkerFetch = async (uri, opts) => {
  if (!(uri in localMarketCache)) {
    logger.verbose(`#marketWorkerFetch ${chalk.red('miss')} for ${uri}`);
    localMarketCache[uri] = await (await esiReq(uri, opts)).json();
    lmcStats.miss++;
  } else {
    logger.verbose(`#marketWorkerFetch ${chalk.green('hit')} for ${uri}`);
    lmcStats.hit++;
  }

  return localMarketCache[uri];
};

const startMarketRefresh = () => {
  const actualRefresh = async () => {
    clearTimeout(marketHandle);
    logger.verbose(`#actualRefresh ${marketWork.length}`);
    const rescheduleList = []
    localMarketCache = {};
    lmcStats = { hit: 0, miss: 0 };

    const ourWorkCopy = marketWork.splice(0);
    const origLen = ourWorkCopy.length;
    const _workStart = Date.now();
    while (ourWorkCopy.length > 0) {
      const workItem = ourWorkCopy.shift();
      if (workItem.name && workItem.exec) {
        logger.info(`#actualRefresh exec work item '${workItem.name}'`);
        const _wiStart = Date.now();
        try {
          let reschedule = await workItem.exec();
          logger.verbose(`#actualRefresh work item '${workItem.name}' ` + 
            `(resch: ${reschedule}) took ${Date.now() - _wiStart}`);
          if (reschedule) {
            rescheduleList.push(workItem);
          }
        } catch (wiErr) {
          logger.error(`work item failed: ${wiErr}`);

          if (config.app.market.rescheduleFailedWork) {
            rescheduleList.push(workItem);
          }

          if (workItem.onFail) {
            workItem.onFail(wiErr);
          }
        }
      }
    }

    logger.info(`processing ${origLen} work items took ${Date.now() - _workStart} `+
      `(${chalk.red(lmcStats.miss)}, ${chalk.green(lmcStats.hit)})`);

    marketWork.push(...rescheduleList);
    setTimeout(actualRefresh, config.app.market.refresh * 60 * 1000);
  }

  if (!marketRefresherRunning) {
    marketRefresherRunning = true;
    actualRefresh();
  }
};

let marketById;
let priceRefresherRunning = false;
const startMarketPriceRefresher = () => {
  const _refresher = async () => {
    logger.verbose('refresh market prices:');
    try {
      let market = await (await esiReq('markets/prices/')).json();
      marketById = market.reduce((a, x) => {
        if (!(x.type_id in a)) {
          a[x.type_id] = [];
        }
        let toPush = {};
        if ('adjusted_price' in x) toPush.adjusted_price = x.adjusted_price;
        if ('average_price' in x) toPush.average_price = x.average_price;
        a[x.type_id].push(toPush);
        return a;
      }, {});
      logger.verbose(`found prices for ${Object.keys(marketById).length} distinct items`);
      return true;
    } catch (err) {
      logger.error(`market price refresh failed: ${err}`);
    }
  }

  if (!priceRefresherRunning) {
    priceRefresherRunning = true;
    submitMarketWorkItem({ name: 'refresh market prices', exec: _refresher });
    _refresher();
  }
}

const renderOrder = async (order, short = false) => {
  let issued = moment(order.issued);
  let expires = issued.add(order.duration, 'days');
  let itemType = await itemFromId(order.type_id);
  let typeStr = order.is_buy_order ? 'Buy' : 'Sell';
  let quantNameStr = `${typeStr} ${lolite(order.volume_remain)}x ${hilite(itemType.name)}`;

  if (short) {
    return `#${chalk.bold(order.order_id)}: ${quantNameStr} @${chalk.bold.green(numeral(order.price).format('0.0a'))}`;
  } else {
    return `${SUBITEM_CHAR} Order #${chalk.bold(order.order_id)} for ${chalk.bold.green(numeral(order.price).format('0.00a'))} ISK:\n` +
      `   ${quantNameStr} (${chalk.bold(itemType.volume)}㎥/unit)\n` +
      `   Issued ${lolite(issued.to(moment()))}, expires ${chalk.bold(moment(expires).toLocaleString())}\n` +
      `   At ${hilite((await nameFromId(order.location_id)))} / ${lolite((await nameFromId(order.region_id)))}`;
  }
};

const watchOrder = async (order, regionInfo) => {
  if (!order) {
    logger.error(`watchOrder no order!`);
    return;
  }

  if (!order.__rendered) {
    order.__rendered = {};
  }
  
  if (!order.__rendered.full) {
    order.__rendered.full = await renderOrder(order);
  }
  
  if (!order.__rendered.short) {
    order.__rendered.short = await renderOrder(order, true);
  }

  let orderCopy = Object.assign({}, order);
  if (!('region_id' in orderCopy)) {
    orderCopy.region_id = regionInfo.region_id;
  }

  logger.info(`watching order #${orderCopy.order_id} (in ${orderCopy.region_id})`);

  submitMarketWorkItem({ name: `watch ${orderCopy.__rendered.short}`, 
    exec: async () => {
      logger.info(`refreshing order #${orderCopy.order_id} (in ${orderCopy.region_id})`);
      const fetchRes = await marketWorkerFetch(`markets/${orderCopy.region_id}/orders/?type_id=${orderCopy.type_id}`);
      let newOrder = fetchRes.find(x => x.order_id === orderCopy.order_id);
      const importantKeys = ['duration', 'price', 'volume_remain', 'volume_total'];
      let unchanged = newOrder && importantKeys.every((oKey) => {
        logger.verbose(`\t${oKey} -> ${newOrder[oKey]} === ${orderCopy[oKey]}`);
        return oKey in orderCopy && oKey in newOrder && newOrder[oKey] === orderCopy[oKey];
      });
      
      logger.verbose(`unchanged ${unchanged}`);

      if (!unchanged) {
        let diffs = importantKeys.reduce((dfs, ik) => {
          if (ik in orderCopy && ik in newOrder && orderCopy[ik] !== newOrder[ik]) {
            let diff = newOrder[ik] - orderCopy[ik];
            let dclr = diff < 0 ? chalk.red : chalk.green;
            dfs.push(`   '${ik}': ${orderCopy[ik]} -> ${newOrder[ik]} (${dclr(diff)})`);
          }
          return dfs;
        }, []);

        Messages.submitMsg(`Order #${orderCopy.order_id} changed!\n` + chalk.yellow('Old order') + ':\n' + 
          orderCopy.__rendered.full + '\n' + hilite('New order') + ':\n' + 
          (newOrder ? (await renderOrder(newOrder)) : 'sold!') + 
          '\n' + chalk.green('Diffs') + ':\n' + diffs.join('\n'));

        if (newOrder) {
          await watchOrder(newOrder, regionInfo);
        }
      }

      return unchanged;
    },
    onFail: (err) => {
      Messages.submitMsg(`Unable to refresh data for '${orderCopy.__rendered.short}':\n\t${chalk.yellow(err)}`);
    }
  });
}

const runTool = async () => {
  let inopt = await inq.prompt({
    type: 'list',
    name: 'choice',
    message: `Market tool:`,
    choices: ['Orders', 'Price Watch', 'Show Watch List' + (marketWork.length > 0 ? ` (${marketWork.length})` : '')].sort()
  });

  if (inopt.choice === 'Orders') {
    let orders = await charReq('orders');
    if (!orders.length) {
      return;
    }

    let orderOpts = []
    for (order of orders) {
      order.__rendered = {
        short: await renderOrder(order, true),
        full: await renderOrder(order)
      };
      orderOpts.push({ value: order, name: order.__rendered.short });
    }

    let ininopt = await inq.prompt({
      type: 'list',
      name: 'choice',
      message: `${hilite(orders.length)} market orders found`,
      choices: ['Examine', 'Watch All'].sort()
    });

    if (ininopt.choice === 'Examine') {
      let orderChoice = (await inq.prompt({ type: 'list', name: 'choice', 
        message: 'Order?', choices: orderOpts })).choice;
      console.log(orderChoice.__rendered.full);
    } else {
      const charInf = await Character.currentCharacterInfo();
      orders.forEach(oc => watchOrder(oc, charInf.regionInfo));
      console.log(`${hilite(orders.length)} orders added to watch list`);
    }
  } else if (inopt.choice.match(/Show\s+Watch\s+List/)) {
    subItem(`Market watch watch has ${hilite(marketWork.length)} items:`);
    marketWork.forEach((work) => console.log(`  ${lolite('*')} ${work.name}`));
  } else if (inopt.choice === 'Price Watch') {
    let search = await inq.prompt({ type: 'input', name: 'choice', message: 'Item name or type ID:' });
    let result;
    let foundItem = { name: search.choice };
    let byId = !Number.isNaN(Number.parseInt(search.choice));
    if (byId) {
      foundItem = await itemFromId(search.choice);
      if (foundItem) {
        result = search.choice;
      }
    }

    if (!result) {
      result = await properSearch(search.choice);
      foundItem = await itemFromId(result);
    }

    if (!result) {
      console.log(`${ALERT_CHAR} nothing found`);
    } else {
      const charInf = await Character.currentCharacterInfo();
      let regionOrders = await (await esiReq(`markets/${charInf.regionInfo.region_id}/orders/?type_id=${result}`)).json();
      console.log(`Found item '${hilite(foundItem.name)}' #${result} (Avg: ${chalk.green(marketById[result][0].average_price)} ` + 
        `/ Adj: ${chalk.green(marketById[result][0].adjusted_price)})`);

      let orderChoices = []
      let _obSpin = new Spinner();
      for (let ri = 0; ri < regionOrders.length; ri++) {
        regionOrders[ri].__rendered = {
          short: await renderOrder(regionOrders[ri], true)
        };
        _obSpin.spin();
      }
      _obSpin.spin(true);

      let selectedorders = (await inq.prompt({ type: 'checkbox', name: 'choice', message: 'Orders:', 
        choices: regionOrders.map((x, i) => { return { name: x.__rendered.short, value: i }; })
      })).choice;

      selectedorders.map(ri => regionOrders[ri]).forEach(order => watchOrder(order, charInf.regionInfo));
      console.log(`${hilite(selectedorders.length)} orders added to watch list`);
    }
  }
}

module.exports = {
  runTool,
  submitMarketWorkItem,
  startMarketPriceRefresher,
  startMarketRefresh
};
