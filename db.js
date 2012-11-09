var mongodb = require('mongodb');
var client = new mongodb.Db('rudy', new mongodb.Server("127.0.0.1", 27017, {auto_reconnect: true}));

var debug = false;
var log = debug ? function() { log.apply(log, arguments); } : function() {};

exports.init = function(cb) {
  client.open(function(err, p_client) {
    cb(err);
  });
}

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
}

exports.update = function(collectionName, id, obj, cb) {
  client.collection(collectionName, function(err, collection) {
    if (err) {
      log("failed to update", err);
      return cb(err);
    }
    collection.update({_id: new mongodb.ObjectID(id)}, obj, {upsert: true}, function(err, count) {
      if (err) {
        log("failed to update (2)", err);
        return cb(err);
      }
      log("saved.");
      cb(null, count);
    });
  })
}

exports.create = function(collectionName, obj, cb) {
  client.collection(collectionName, function(err, collection) {
    if (err) {
      log("failed to create", err);
      return cb(err);
    }    
    collection.save(obj, function(err, doc) {
      if (err) {
        log("failed to create (2)", err);
        return cb(err);
      }
      log("created.");
      cb(null, doc);
    });
  });
}

exports.get = function(collectionName, id, cb) {
  client.collection(collectionName, function(err, collection) {
    if (err) {
      log("failed to read", err);
      return cb(err);
    }    
    collection.findOne({_id: new mongodb.ObjectID(id)}, function(err, doc) {
      if (err) {
        log("failed to read (2)", err);
        return cb(err);
      }
      log("read", doc);
      cb(null, doc);
    });
  });
}

exports.all = function(collectionName, cb) {
  client.collection(collectionName, function(err, collection) {
    if (err) {
      log("failed to read", err);
      return cb(err);
    }
    collection.find({}, {}).toArray(function(err, docs) {
      if (err) {
        cosnole.log("failed to read (2)", err);
        return cb(err);
      }
      log("read many", docs);
      cb(null, docs);
    });
  })
}
