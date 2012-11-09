exports.Helpers = function(req, res) {
  var jsIncludes = [];
  this.includeJs = function(path) {
    jsIncludes.push(path);
  }
  this.jsIncludes = function() {
    var soFar = {};
    var out = [];
    jsIncludes.forEach(function(path) {
      if (soFar[path]) return;
      out.push('<script type="text/javascript" src="/js/'+path+'"></script>');
      soFar[path] = true;
    });
    return out.join('\n');
  }

  var cssIncludes = [];
  this.includeCss = function(path) {
    cssIncludes.push(path);
  }
  this.cssIncludes = function() {
    var soFar = {};
    var out = [];
    cssIncludes.forEach(function(path) {
      if (soFar[path]) return;
      out.push('<link type="text/css" href="/css/'+path+'" rel="stylesheet"/>');
      soFar[path] = true;
    });
    return out.join('\n');
  }
  
  var templateIncludes = [];
  this.includeTemplate = function(path) {
    templateIncludes.push(path);
  }
  this.__defineGetter__('templates', function() {
    var out = [];
    templateIncludes.forEach(function(path) {
      res.partial(path, function(err, str) {
        if (err) {
          console.log("error rendering partial!");
        } else {
          out.push(str);
        }
      });
    });
    return out.join("");
  });
  
  var bodyAttributes = [];
  this.addBodyAttribute = function(key, value) {
    bodyAttributes.push(key+'="'+value.replace(/"/g, "\\\"")+'"');
  }
  this.__defineGetter__('bodyAttributes', function() {
    return bodyAttributes.join(" ");
  });

  var headerContent = [];
  this.addHeaderContent = function(h) {
    if (typeof(h) == 'function') {
      headerContent.push(h());
    } else {
      headerContent.push(h);
    }
  }
  this.__defineGetter__('headerContent', function() {
    return headerContent.join('\n');
  });
  
  this.objectToTable = function(obj) {
    var rows = [];
    for (var k in obj) {
      var value = obj[k];
      if (value instanceof Array) {
        value = value.join("; ");
      }
      if (value instanceof Date) {
        value = value.toString();
      }
      if (value && typeof(value) == 'object') {
        value = this.objectToTable(value);
      }
      rows.push("<tr><td>"+k+"</td><td>"+String(value).replace(/\n/g, "<br>\n")+"</td></tr>");
    }
    return "<table><tr><th>key</th><th>value</th></tr>"+rows.join('')+"</table>";
  }
}
