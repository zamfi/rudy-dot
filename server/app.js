// let express = require('express'),
//     connect = require('connect');
let fs = require('fs');
let url = require('url');
let util = require('util');
let mime = require('mime');
// let ejs = require('ejs');

let files = require("./files");
let db = require('./db');

let port = process.env.PORT || 8787;

// let app = express.createServer();
// let io = require('socket.io').listen(app, {'log level': 1});

var logStream;
try {
  logStream = new files.DatedFileStream('logs/access-%y-%m-%d.log');
} catch (e) {
  process.exit(1);
}
let errorSave = require('./filesave').named("lint-errors");
let userActionLog = require('./filesave').named("user-actions");

const template500 = fs.readFileSync(__dirname+'/templates/500.html', 'utf8');
function send500(res, err) {
  res.writeHead(500);
  res.end(template500.replace("<%- err %>", String(err)));
}

function sendJson(res, statusCode, object) {
  res.writeHead(statusCode, {'Content-Type': 'application/json'});
  res.end(JSON.stringify(object));
}

let savedCode = {
  // run: {
  //   d: fs.readFileSync('code/run.js', 'utf8'),
  //   i: codeutils.instrumentSync(fs.readFileSync('code/run.js', 'utf8'), "run")
  // },
  rudy: {
    d: fs.readFileSync(__dirname+'/code/robot.js', 'utf8'),
    // i: codeutils.instrumentSync(fs.readFileSync('code/robot.js', 'utf8'), "rudy")
  },
  
  p5: {
    d: fs.readFileSync(__dirname+'/code/p5.js', 'utf8'),
    // i: codeutils.instrumentSync(fs.readFileSync('code/p5.js', 'utf8'), "rudy")
  }
};

async function apiNew(req, res) {
  let params = url.parse(req.url, true);
  let isCloning = 'cloneCode' in params.query;
  let oldSketchId = params.query.cloneCode;

  let parsedExtra = {};
  if (params.query.extra) {
    try {
      parsedExtra = JSON.parse(params.query.extra);
    } catch (err) {
      console.log("malformed JSON for extra", err);
      send500(res, err);
      return;
    }
  }

  const template = parsedExtra.type || 'rudy';  

  let newDoc = {latestCode: savedCode[template].d, versions: [savedCode[template]]};

  if (isCloning) {
    try {
      let oldDoc = await db.in('sketches').get(oldSketchId);

      newDoc.latestCode = oldDoc.latestCode;
      newDoc.versions.push(oldDoc.versions[oldDoc.versions.length-1]);

      if (!newDoc.extra) {
        newDoc.extra = {};
      }
      newDoc.extra.clonedFrom = oldSketchId;
      
    } catch (err) {
      console.log("Failed to clone!", err);
      send500(res, err);
      return;
    }
  }
  try {
    if (params.query.extra) {
      ['level', 'executionSpeed', 'type'].forEach(function(k) {
        if (k in parsedExtra) {
          if (!newDoc.extra) {
            newDoc.extra = {};
          }
          newDoc.extra[k] = parsedExtra[k];
        }
      });
    }
    let doc = (await db.in('sketches').create(newDoc)).ops[0];
    
    console.log("made new doc", doc._id);
    
    if (isCloning) {
      await db.in('sketches').update(oldSketchId, {'$set': {'extra.clonedTo': doc._id}});
      console.log("cloned new doc", oldSketchId, '->', doc._id);
    }
    sendJson(res, 200, {
      status: 'ok',
      sketchId: doc._id, 
      extra: doc.extra, 
      code: doc.latestCode
    });
    console.log("sent new doc");
  } catch (err) {
    console.log("Damn, failed to clone!", err);
    send500(res, err);
  }
}

const MAX_REQUEST_DATA_SIZE = 10e6;

function getRequestData(req) {
  return new Promise((resolve, reject) => {
    let requestData = [];
    req.on('data', (data) => {
      requestData.push(data);
      if (requestData.reduce((sum, value) => sum+value.length, 0) > MAX_REQUEST_DATA_SIZE) {
        requestData = [];
        res.writeHead(413, {'Content-Type': 'text/plain'})
        res.end()
        req.connection.destroy();
        reject('too-much-data');
      }
    });
    req.on('end', () => {
      resolve(requestData.join(''));
    });
  });
}

async function apiSave(req, res) {
  let params = url.parse(req.url, true);
  
  // console.log("Saving!");
  
  let output = {status: 'ok'}; // assume ok status.
  try {
    let {clientId, sketchId, extra} = params.query;
    let saveVersion = params.query.saveVersion == "true";

    // console.log("Getting data...");
    let code = await getRequestData(req);
    
    // console.log("Got data:", params.query, code);
    userActionLog.save({
      type: (saveVersion ? "play" : "save"),
      clientId,
      sketchId,
      code
    });

    let updateParams = {
      $set: { latestCode: code }
    };
    if (params.query.extra) {
      let parsedExtra = JSON.parse(extra);
      for (let k in parsedExtra) {
        if (parsedExtra.hasOwnProperty(k)) {
          updateParams['$set'][`extra.${k}`] = parsedExtra[k];
        }
      }
    }
    if (saveVersion) {
      updateParams['$push'] = { versions: {d: code }};
    }
    let doc = await db.in('sketches').update(sketchId, updateParams);

    if (saveVersion) {
      let doc = await db.in('sketches').get(sketchId);

      let version = doc.versions.length-1;

      // this is slow, but in practice, the latest version should always be the just-saved code.
      while (version > -1) {
        if (doc.versions[version].d === code) {
          break;
        } else {
          version--;
        }
      }
      if (version < 0) {
        version = doc.versions.length-1;
      }
      output = {status: 'ok', savedVersion: version };
      // console.log("saved version", version);
    } else {
      // console.log("saved!", doc);
    }
  } catch (err) {
    console.log("Whoa, failed to save!", err);
    output = {status: err}
  }
  sendJson(res, 200, output);
}

async function apiRead(req, res) {
  let params = url.parse(req.url, true);
  try {
    // console.log("Getting id", params.query.id, "from DB");
    let doc = await db.in('sketches').get(params.query.id);
    // console.log("Got doc", doc);
    if (! doc) {
      sendJson(res, 404, {status: 'not-found'});
    } else {
      sendJson(res, 200, {
        status: 'ok',
        extra: doc.extra, 
        code: doc.latestCode, 
        sketchId: params.query.id
      });
    }
  } catch (err) {
    sendJson(res, 500, {status: 'server-error', err: err});
  }
}

async function apiError(req, res) {
  try {
    let {clientId, sketchId} = url.parse(req.url, true).query
    let {code, errors} = JSON.parse(await getRequestData(req));
  
    errorSave.save({
      clientId,
      sketchId,
      code,
      errors
    });
    userActionLog.save({
      type: "errors",
      clientId,
      sketchId,
      code,
      errors
    });
  } catch (err) {
    console.log("Whoa, failed to save errors?", clientId, sketchId, errors, code);
  }
  sendJson(res, 200, {status: 'ok'});
}


let server = require('http').createServer(async (req, res) => {
  console.log("Got request!", req.method, req.url);
  
  let path = url.parse(req.url, true).pathname
  switch (path) {
  case '/api/new':
    apiNew(req, res);
    return;
  case '/api/read':
    apiRead(req, res);
    return;
  case '/api/save':
    apiSave(req, res);
    return;
  case '/api/error':
    apiError(req, res);
    return;
  default:
    let safePath = path.split('/').filter(e => ! e.startsWith('.')).join('/')
    if (safePath == '/' || safePath.startsWith('/edit/')) {
      safePath = '/index.html';
    }
    try {
      let fullPath = 'build' + safePath;
      if ((await util.promisify(fs.stat)(fullPath)).isFile()) {
        res.writeHead(200, {'Content-Type': mime.lookup(safePath)});
        fs.createReadStream(fullPath).pipe(res);
      } else {
        console.log("unknown request", path);
        res.writeHead(404, {'Content-Type': 'text/html'});
        res.end("Couldn't find your URL...");
      }
    } catch (err) {
      console.log("Error reading static file?", err);
      res.writeHead(500, {'Content-Type': 'text/html'});
      res.end("Failed to load something...try again later?");
    }
  }
});

db.init().then(() => {
  server.listen(port);
  console.log("Listening on", port);
}).catch((err) => {
  console.log("Failed to connect to DB", err);
  process.exit(1);
});
// app.configure(function() {
//   this.set('views', __dirname + '/templates');
//   this.set('view engine', 'ejs');
//   this.register('.html', ejs);
//   this.dynamicHelpers({
//     helpers: function(req, res) { return new helpers.Helpers(req, res); }
//   });
//   this.use(express.logger({
//     buffer: true,
//     stream: logStream,
//     format: ':remote-addr - - [:date] ":method :url HTTP/:http-version" :status :res[content-length] ":referrer" ":user-agent" :response-time ms'
//   }));
//   this.use(express.cookieParser());
//   this.use(express.bodyParser());
//   this.use(connect.static(__dirname + '/static'));
// });
//
//
// app.get('/', function(req, res, next) {
//   res.render('home.html');
// });
//
// let argHandler = {
//   rudy: function(doc, args, cb) {
//     if ('cloneCode' in args) {
//       await db.in('sketches').get(args.cloneCode, defer (let err, oldDoc));
//       if (err) { return cb(err); }
//       doc.latestCode = oldDoc.latestCode;
//       doc.versions.push(oldDoc.versions[oldDoc.versions.length-1]);
//       if (!doc.extra) {doc.extra = {};}
//       doc.extra.clonedFrom = args.cloneCode;
//     }
//     ['level', 'evaluationDelay'].forEach(function(k) {
//       if (k in args) {
//         if (!doc.extra) {doc.extra = {};}
//         doc.extra[k] = args[k];
//       }
//     });
//     cb(null, ('cloneCode' in args) ? function(doc, cb) {
//       db.in('sketches').update(args.cloneCode, {'$set': {'extra.clonedTo': doc._id}}, cb);
//     } : undefined);
//   }
// };
//
// app.get('/new/:template?', function(req, res, next) {
//   let template = req.params.template || 'run';
//   let newDoc = {latestCode: savedCode[template].d, versions: [savedCode[template]]};
//   let err, followup_f;
//   if (template in argHandler) {
//     await argHandler[template](newDoc, req.query, defer (err, followup_f));
//     if (err) {
//       return res.render('500.html', {err: err});
//     }
//   }
//   await db.in('sketches').create(newDoc, defer (let err, doc));
//   if (err) {
//     return res.render('500.html', {err: err});
//   }
//   if (followup_f) {
//     await followup_f(doc, defer (let err));
//     if (err) {
//       return res.render('500.html', {err: err});
//     }
//   }
//   res.redirect('/edit/'+template+'/'+doc._id);
// });
// app.get('/edit/:template/:id', function(req, res, next) {
//   let template = req.params.template || 'run';
//   await db.in('sketches').get(req.params.id, defer (let err, doc));
//   if (err) {
//     return res.render('500.html', {err: err});
//   }
//   if (! doc) {
//     return res.render('404.html');
//   }
//   // await sharejsServer.model.getSnapshot(req.params.id, defer (let err, data));
//   // if (err && err !== 'Document does not exist') {
//   //   return res.render('500.html', {err: err});
//   // }
//   res.render('edit-'+template+'.html', {template: template, extra: doc.extra, initialCode: /*data ? data.snapshot :*/ doc.latestCode, sketchId: req.params.id, clientId: ""+Math.round(Math.random()*1000000000)});
// });
//
// let redirects = {};
// app.post('/save/:sketchId', function(req, res, next) {
//   let code = req.param('code');
//   let saveVersion = req.param('saveVersion') == "true";
//   let instrumentedCode = saveVersion ? codeutils.instrumentSync(code, req.param('template')) : "uncomputed, no version save";
//
//   userActionLog.save({
//     type: (saveVersion ? "play" : "save"),
//     clientId: req.param('clientId'),
//     sketchId: req.params.sketchId,
//     code: code
//   });
//
//   let updateParams = {
//     $set: { latestCode: code }
//   };
//   if (req.param('extra')) {
//     updateParams['$set'].extra = JSON.parse(req.param('extra'));
//   }
//   if (saveVersion) {
//     updateParams['$push'] = { versions: {d: code, i: instrumentedCode }};
//   }
//   await db.in('sketches').update(req.params.sketchId, updateParams, defer (let err));
//
//   let output = {};
//   if (! saveVersion) {
//     output = {status: err ? err : 'ok'};
//     // console.log("saved latest: ", code);
//   } else {
//     await db.in('sketches').get(req.params.sketchId, defer (let err, doc));
//
//     // let id = req.param('id');
//     let version = doc.versions.length-1;
//
//     // this is really suboptimal, but in practice, should almost never be an issue.
//     while (version > -1) {
//       if (doc.versions[version].d == code) {
//         break;
//       } else {
//         version--;
//       }
//     }
//     if (version < 0) {
//       version = doc.versions.length-1;
//     }
//     // if (redirects[id]) {
//     //   redirects[id](version);
//     //   delete redirects[id];
//     // } else {
//     //   redirects[id] = version;
//     // }
//     output = {status: 'ok', savedVersion: version };
//     // console.log("saved version", version);
//   }
//   res.contentType('application/json');
//   res.end(JSON.stringify(output));
// });
//
// app.post('/noteError', function(req, res, next) {
//   let code = req.param('code');
//   let errors = req.param('errors');
//   errorSave.save({
//     clientId: req.param('clientId'),
//     sketchId: req.param('sketchId'),
//     code: code,
//     errors: JSON.parse(errors)
//   });
//   userActionLog.save({
//     type: "errors",
//     clientId: req.param('clientId'),
//     sketchId: req.param('sketchId'),
//     code: code,
//     errors: JSON.parse(errors)
//   });
// });
//
// let templateMap = {
//   run: 'view.html',
//   rudy: 'robot.html'
// };
//
// app.get('/play/:template/:sketch/:client/:id', function(req, res, next) {
//   let id = req.params.id;
//   let f = function(version) {
//     res.cookie("nextclientid", req.params.client, {maxAge: 360000, path: '/' });
//     res.redirect('/play/'+[req.params.template, req.params.sketch, version].join('/'));
//     delete redirects[id];
//   };
//   if (redirects[id]) {
//     f(redirects[id]);
//   } else {
//     redirects[id] = f;
//   }
// });
//
// app.get('/play/:template/:id/:version', function(req, res, next) {
//   let id = req.params.id;
//   let version = Number(req.params.version);
//   if (isNaN(version)) {
//     version = -1;
//   }
//   let clientId = req.cookies.nextclientid;
//
//   await db.in('sketches').get(req.params.id, defer (let err, doc));
//   if (err) {
//     console.log("couldn't get document", err);
//   }
//   if (doc && doc.versions) {
//     res.clearCookie('nextClientId');
//     res.render(templateMap[req.params.template] || 'view.html', {
//       layout: false, code: doc.versions[version < 0 ? doc.versions.length-1 : version].i, sketchId: req.params.sketch, clientId: clientId ? clientId : null
//     });
//   } else {
//     res.render("500.html", {err: "Saved sketch not found!"});
//   }
// });
//
// // set up runtime error handling
// // let socketRegistrations = {};
// // io.sockets.on('connection', function(socket) {
// //   let id;
// //   socket.on('register', function(data) {
// //     socketRegistrations[id = data.id] = socket;
// //   });
// //   socket.on('disconnect', function() {
// //     delete socketRegistrations[id];
// //   });
// // });
// app.post('/runtimeError', function(req, res, next) {
//   let id = req.param('id');
//   if (socketRegistrations[id]) {
//     socketRegistrations[id].emit('runtime error', {line: Number(req.param('line')), char: Number(req.param('char')), msg: req.param("msg")});
//   }
//   res.end(JSON.stringify({status: 'ok'}));
// });
//
// // set up sharejs
// // let sharejs = require('share');
// // let options = {
// //   db: {type: 'mongo'},
// //   browserChannel: {cors: '*'},
// //   auth: function(client, action) {
// //     // This auth handler rejects any ops bound for docs starting with 'readonly'.
// //     if (action.name === 'submit op' && action.docName.match(/^readonly/)) {
// //       action.reject();
// //     } else {
// //       action.accept();
// //     }
// //   }
// // };
// // let sharejsServer = sharejs.server.attach(app, options);
//
// // and now, if nothing hits...
// app.use(function(req, res) {
//   res.render('404.html', 404);
// });
//
// console.log("setup completed.");
//
// // error handling
// process.on('uncaughtException', function(err) {
//   console.log('Caught unhandled exception.');
//   console.log(err.stack);
// });
//
// // db setup
// await db.init(defer (let err));
// if (err) {
//   console.log("Failed to connect to DB", err);
//   process.exit(1);
// }
// app.listen(port);
// console.log("Listening on port", port);
