const fs = require('fs');

const SRC_DIR = __dirname + '/src';
const DST_DIR = __dirname + '/dist';

require('zcompile')({
  source: SRC_DIR,
  destination: DST_DIR,

  minifySelectors: false,
  minifyJS: false,
  files: [
    'app.css', 'index.html', 'app.js'
  ],
  copy: [].concat(
    fs.readdirSync(SRC_DIR + '/lib/').map(file => `lib/${file}`),
    fs.readdirSync(SRC_DIR + '/assets/').map(file => `assets/${file}`)
  )
});
