(function() {  
  function sketchProc(userCode, runtimeErrorHandler, updateWidth, eventHandler) {
    return function(processing) {
      var TIMEOUT = 5*1000;
      if (! window.__ck) {
        window.__ck = function(line, char) {
          if (window.__ck_kill) {
            delete window.__ck_kill;
            throw new Error("Exection stopped.");
          }
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
        var _draw = draw;
        size = function(x,y) {
          _size(x,y);
          updateWidth(x);
        }
        eventHandler.start({ stop: function() { 
          window.__ck_kill = true;
          if (processingInstance) {
            processingInstance.noLoop();
          }
          eventHandler.stop();
        }});
        try {
          eval(userCode);
          if (draw == _draw) {
            // draw wasn't set, so...nothing will loop.
            eventHandler.stop();
          }
        } catch (e) {
          if (processingInstance) {
            processingInstance.noLoop();
          }
          eventHandler.stop();
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
