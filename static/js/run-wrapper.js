(function() {  
  function sketchProc(userCode, runtimeErrorHandler, updateWidth) {
    return function(processing) {
      var TIMEOUT = 5*1000;
      if (! window.__ck) {
        window.__ck = function(line, char) {
          if (! window.__ck_lastrun) {
            clearTimeout(window.__ck_timeout);
            window.__ck_timeout = setTimeout(function() {
              delete window.__ck_lastrun;
            }, 0);
            window.__ck_lastrun = +new Date();
          }
          var now = +new Date();
          if (now - window.__ck_lastrun > TIMEOUT) {
            // processing.println("Line "+line+", character "+char+": Execution exceeded "+Math.round(TIMEOUT/1000)+" seconds...perhaps you have an infinite loop?");
            runtimeErrorHandler({
              line: line,
              char: char,
              msg: "Execution timed out."
            });
            throw new Error("Execution timed out.");
          }
        }
      }

      with (processing) {
        var _size = size;
        size = function(x,y) {
          _size(x,y);
          updateWidth(x);
        }
        try {
          eval(userCode);          
        } catch (e) {
          console.log(userCode, e);
        }
      }
    };
  }
  var processingInstance;
  function executeCode(userCode, controller) {
    if (processingInstance) {
      processingInstance.noLoop();
      // console.log(processingInstance);
    }
    var canvas = document.getElementById('pjs');
    processingInstance = new Processing(canvas, sketchProc(userCode,
      function(arg) {controller.runtimeErrorHandler(arg);},
      function(arg) {controller.updateWidth(arg);}));
  }

  window.ProcessingWrapper = {
    executeCode: executeCode
  }
})()
