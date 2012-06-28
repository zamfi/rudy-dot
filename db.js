var mongodb = require('mongodb');
var client = new mongodb.Db('rudy', new mongodb.Server("127.0.0.1", 27017, {auto_reconnect: true}));

var debug = false;
var log = debug ? function() { log.apply(log, arguments); } : function() {};

exports.init = function(cb) {
  client.open(function(err, p_client) {
    cb(err);
  });
}

exports.update = function(id, obj, cb) {
  client.collection('sketches', function(err, collection) {
    if (err) {
      log("failed to update", err);
      return cb(err);
    }
    collection.update({_id: new mongodb.ObjectID(id)}, obj, {upsert: true}, function(err, docs) {
      if (err) {
        log("failed to update (2)", err);
        return cb(err);
      }
      log("saved.");
      cb(null, docs);
    });
  })
}

exports.create = function(obj, cb) {
  client.collection('sketches', function(err, collection) {
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

exports.get = function(id, cb) {
  client.collection('sketches', function(err, collection) {
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

exports.all = function(cb) {
  client.collection('sketches', function(err, collection) {
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
