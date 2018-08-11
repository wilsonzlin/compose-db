const fs = require('fs');
const https = require('https');
const Express = require('express');
const BodyParser = require('body-parser');

let privateKey = fs.readFileSync('https-cert.key');
let certificate = fs.readFileSync('https-cert.crt');

const server = new Express();

server.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, PUT");
  res.header("Access-Control-Allow-Headers", "Origin, Content-Type, Accept");
  next();
});

server.use('/app', Express.static(__dirname + '/dist'));

server.get('/', (req, res) => {
  res.redirect('/app');
});

server.get('/schemas', (req, res) => {
  fs.readdir(__dirname + '/../schemas/', (err, files) => {
    if (err) {
      console.error(err);
      res.sendStatus(500);
      return;
    }

    res.send(JSON.stringify(files.filter(f => /\.json$/.test(f)).map(f => f.slice(0, -5))));
  });
});

server.get('/schema/:name', (req, res) => {
  let name = req.params.name;
  if (!name || !/^[a-z0-9-_.]{1,100}$/.test(name)) {
    res.sendStatus(400);
    return;
  }

  fs.readFile(__dirname + '/../schemas/' + name + '.json', 'utf8', (err, schema) => {
    if (err) {
      if (err.code != 'ENOENT') {
        console.error(err);
        res.sendStatus(500);
        return;
      }
      res.sendStatus(404);
      return;
    }
    res.send(schema);
  });
});

server.put('/schema/:name', BodyParser.json(), (req, res) => {
  let name = req.params.name;
  if (!name || !/^[a-z0-9-_.]{1,100}$/.test(name)) {
    res.sendStatus(400);
    return;
  }

  fs.writeFile(__dirname + '/../schemas/' + name + '.json', JSON.stringify(req.body, null, 4), err => {
    if (err) {
      console.error(err);
      res.sendStatus(500);
      return;
    }

    res.sendStatus(200);
  });
});

https.createServer({
  key: privateKey,
  cert: certificate,
}, server).listen(4096);
