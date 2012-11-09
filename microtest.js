var fs = require('fs');
var JSLINT = require('./static/js/jslint').JSLINT;

var sampleCode = {
  run: fs.readFileSync('code/run.js', 'utf8'),
  jslint: fs.readFileSync('static/js/jslint.js', 'utf8')
};

var key = 'run';
var n = 1;

console.log("timing JSLINT against");
console.log(sampleCode[key]);
var d = new Date();
for (var i = 0; i < n; ++i) {
  JSLINT(sampleCode[key], {
    predef: {
      size: false,
      background: false,
      stroke: false,
      setup: true,
      draw: true,
      random: false,
      width: false,
      line: false,
      height: false
    },
    anon: true,
    eqeq: true,
    plusplus: true,
    newcap: true,
    unparam: true,
    sloppy: true,
    vars: true,
    white: true,
    regexp: true,
    forin: true
  });
}
console.log('JSLINT', n, 'iterations:', new Date() - d, "ms");
console.log(JSLINT.errors);