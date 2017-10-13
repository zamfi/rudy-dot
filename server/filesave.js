var files = require("./files");

var loggers = {};

exports.named = function(flowname) {
  if (! loggers[flowname]) {
    loggers[flowname] = files.objectLogger(new files.DatedFileStream('logs/'+flowname+'-%y-%m-%d.log'));
  }
  return { save: loggers[flowname] };
}
