var express = require('express'),
    connect = require('connect');

// var db = require('./db');
// var display = require('./display');
// var edit = require('./edit');

var port = process.env.PORT || 8080;

var app = express.createServer();

app.configure(function() {
  this.set('views', __dirname + '/templates');
  this.set('view engine', 'ejs');
  this.register('.html', require('ejs'));
  // this.use(express.logger({
  //   buffer: true,
  //   // stream: logStream,
  //   format: ':remote-addr - - [:date] ":method :url HTTP/:http-version" :status :res[content-length] ":referrer" ":user-agent" :response-time ms'
  // }));
  this.use(express.cookieParser());
  this.use(express.bodyParser());
  this.use(connect.static(__dirname + '/static'));
});

// var auth = express.basicAuth('littlemaggie', 'maggie123');

// app.get('/m/:id', auth, display.handle_display);
// app.get('/e/:id', auth, edit.handle_edit);
// app.post('/e/:id/:action', edit.handle_edit_action);
// app.get('/new', auth, edit.new_maggie);
var savedCode = {};

app.get('/', function(req, res, next) {
  res.render('main.html');
  // db.all(function(err, docs) {
  //   console.log("docs", docs);
  //   res.render('index.html', {title: "Maggie", docs: docs.filter(function(doc) { return ! doc.hidden; })});
  // })
});

app.post('/save', function(req, res, next) {
  var id = req.param('id');
  if (savedCode[id]) {
    savedCode[id](req.param('code'))
  }
  savedCode[id] = req.param('code');

  res.contentType('application/json');
  res.end(JSON.stringify({status: 'ok'}));
});

app.get('/run/:id', function(req, res, next) {
  var id = req.params.id;
  var renderFunction = function() {
    res.render('view.html', {layout: false, code: savedCode[id]});
  };
  if (savedCode[id]) {
    renderFunction();
  } else {
    savedCode[id] = renderFunction;
  }
});

app.all('*', function(req, res){
  res.send('what???', 404);
});

process.on('uncaughtException', function(err) {
  console.log('Caught unhandled exception.');
  console.log(err.stack);
});

// db.init(function(err) {
//   if (err) {
//     console.log("Failed to connect to DB", err);
//     process.exit(1);
//   }
  app.listen(port);
  console.log("Listening on port", port);  
// });
