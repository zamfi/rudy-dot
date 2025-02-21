let util = require('util');

var { MongoClient, ObjectId } = require('mongodb');
// To have launchd start mongodb/brew/mongodb-community now and restart at login:
//   brew services start mongodb/brew/mongodb-community
// Or, if you don't want/need a background service you can just run:
//   mongod --config /opt/homebrew/etc/mongod.conf

const uri = 'mongodb://localhost:27017';
const mongoClient = new MongoClient(uri);
const client = mongoClient.db('rudy') // , new mongodb.Server("127.0.0.1", 27017, {auto_reconnect: true}), {safe: true});

var debug = false;
var log = debug ? function() { log.apply(log, arguments); } : function() {};

exports.init = async function() {
  log("db layer initializing");
  // client.open(function(err, p_client) {
  //   cb(err);
  // });
};

function curry(fn) {
  var args = Array.prototype.slice.call(arguments, 1);
  return function() {
    return fn.apply(this, args.concat(Array.prototype.slice.call(arguments)));
  };
}

exports.in = function(collectionName) {
  return {
    update: curry(exports.update, collectionName),
    create: curry(exports.create, collectionName),
    get: curry(exports.get, collectionName),
    all: curry(exports.all, collectionName)
  }
};

// function promisify(fn) {
//   return (var_args) => {
//     let realArgs = Array.prototype.slice.call(arguments);
//     return new Promise((reject, resolve) => {
//       realArgs.push((err, data) => {
//         if (err) {
//           reject(err);
//         } else {
//           resolve(data);
//         }
//       });
//     });
//   }
// }

exports.update = async function(collectionName, id, obj, cb) {
  const collection = client.collection(collectionName) //, function(err, collection) {
  const result = await collection.updateOne({_id: new ObjectId(id)}, obj, {upsert: false}) //, function(err, result) {
      // if (err) {
      //   log("failed to update (2)", err);
      //   return cb(err);
      // }
      // log("saved.");
  return result.modifiedCount;
};

exports.create = async function(collectionName, obj) {
  let collection = client.collection(collectionName)//, function(err, collection) {
    // if (err) {
    //   log("failed to create", err);
    //   return cb(err);
    // }    
  return await collection.insertOne(obj); 
};

exports.get = async function(collectionName, id) {
  try {
    let collection = client.collection(collectionName) // , function(err, collection) {
    let doc = await collection.findOne({_id: new ObjectId(id)}) 
    log("read", doc);
    return doc;
  } catch (e) {
    console.log("failed to read for id", id, "error", e);
  }
  //.limit(1).next(function(err, doc) {
    //   if (err) {
    //     log("failed to read (2)", err);
    //     return cb(err);
    //   }
    //   log("read", doc);
    //   cb(null, doc);
    // });
  // });
};

exports.all = async function(collectionName, cb) {
  const collection = client.collection(collectionName) //  function(err, collection) {
    // if (err) {
    //   log("failed to read", err);
    //   return cb(err);
    // }
    let docs = await collection.find().toArray() //function(err, docs) {
      // if (err) {
      //   cosnole.log("failed to read (2)", err);
      //   return cb(err);
      // }
      log("read many", docs);
      return docs;
    // });
  // })
};

// ['init', 'create', 'update', 'get', 'all'].forEach(name => exports[name] = util.promisify(exports[name]));