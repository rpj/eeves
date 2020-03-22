const fs = require('fs');
const config = require('config');
const fastify = require('fastify');
const app = fastify();

const cache = fs.existsSync(config.http.cacheFile) ? 
  JSON.parse(fs.readFileSync(config.http.cacheFile, 'utf8')) : {};

const writeCache = (c) => {
  fs.writeFileSync(config.http.cacheFile, JSON.stringify(c, null, 2));
  fs.chmodSync(config.http.cacheFile, 0600);
}
const setInCache = (c, k, v) => { c[k] = v; writeCache(c); };
const rmFromCache = (c, k) => { delete c[k]; writeCache(c); };

const logReq = (req) => {
  let realIps = [req.ip];

  if ('cf-connecting-ip' in req.headers) {
    realIps = [req.headers['cf-connecting-ip']];
  } else if ('forwarded' in req.headers) {
    realIps = req.headers.forwarded.split(/,\s+/)
      .map(x => x.split('=')).filter(x => x[0] === 'for').map(x => x[1]);
  }

  console.log(`${(new Date).toISOString()} ${String(req.id).padStart(5, '0')} ` + 
    `${realIps.join(';')} ${req.raw.method} ${req.raw.url} "${req.raw.headers['user-agent']}"`);
};

const validUuid = (uuid) => {
  // https://stackoverflow.com/a/13653180
  const validUuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-5][0-9a-f]{3}-[089ab][0-9a-f]{3}-[0-9a-f]{12}$/
  return uuid.match(validUuidRegex) !== null
}

app.get('/', async (req, reply) => {
  logReq(req);
  reply.redirect(config.http.indexRedirect);
});

app.get('/:runId', async (req, reply) => {
  let retVal = { error: false };
  logReq(req);

  if (validUuid(req.params.runId)) {
    if (req.query.code && req.query.state === 'auth_init' && req.query.code.length <= 32) {
      setInCache(cache, req.params.runId, req.query);
      reply
        .code(200)
        .header('Content-Type', 'text/html; charset=utf-8')
        .send(fs.readFileSync(config.http.authIndex, 'utf8'));
    } else if (req.query.state === 'auth_get') {
      if (req.params.runId in cache) {
        retVal.token = cache[req.params.runId];
      }
    } else if (req.query.state === 'auth_complete' && req.params.runId in cache) {
      rmFromCache(cache, req.params.runId);
    } else if (req.query.state === 'auth_init_get') {
      const cacheKey = `${req.params.runId}_link`;
      if (cacheKey in cache) {
        reply.redirect(cache[cacheKey]);
        rmFromCache(cache, cacheKey);
      }
    }
  }

  return retVal;
});

app.post('/:runId', async (req, reply) => {
  let retVal = { error: false };
  logReq(req);

  if (validUuid(req.params.runId)) {
    const cacheKey = `${req.params.runId}_link`;
    if (req.query.state === 'auth_init_set') {
      setInCache(cache, cacheKey, req.body);
    }
  }

  return retVal;
});

app.listen(config.http.port, config.http.bind).then(() => {
  console.log(`Listening on ${config.http.bind}:${config.http.port}`);
});
