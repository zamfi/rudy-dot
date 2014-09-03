(function() {  
  var JsRunner = Ember.Object.extend({
    interpreter: null,
    interpreterChange: function() {
      this.get('interpreter').stateStack.addDelegate(this.get('eventDelegate'));
    }.observes('interpreter'),
    eventDelegate: Em.required(),
    evaluationDelayBinding: "eventDelegate.evaluationDelay",
    processing: Em.required(),
    passEvent: function(name, arg1, arg2, etc) {
      var eventHandler = this.get('eventDelegate');
      if (eventHandler && eventHandler[name+"Handler"]) {
        eventHandler[name+"Handler"].apply(eventHandler, Array.prototype.slice.call(arguments, 1));
      }
    },
    stepAndSchedule: function() {
      if (this.get('isFinished')) { return; }
      try {
        var result = this.get('interpreter').step();        
        if (result && ! this.get('isWaiting')) {
          Ember.run.later(this, 'stepAndSchedule', this.get('evaluationDelay'));
        }
        if (! result) {
          this.set('isFinished', true);
          this.get('completionCallback')();
          this.passEvent("stop", this.get('interpreter'));
        }
      } catch (err) {
        console.log(err);
        this.get('processing').noLoop();
        var interpreter = this.get('interpreter');
        var topFrame = interpreter.stateStack[0];
        this.passEvent("runtimeError", err, topFrame, interpreter.stateStack);
        // {
        //   line: 0, char: 0,
        //   msg: "Runtime error: "+(err && err.getMessage ? err.getMessage() : "(unknown)")
        // }, this.get('interpreter'));
        this.passEvent("stop", this.get('interpreter'));
      }
    },
    run: function(cb) {
      this.set('completionCallback', cb);
      this.stepAndSchedule();
    },
    stop: function() {
      this.set('isFinished', true);
      this.passEvent("stop", this.get('interpreter'));
    }
  });
  
  function sketchProc(userCode, startLevel, eventHandler) {
    function passEvent(name, arg1, arg2, etc) {
      if (eventHandler && eventHandler[name+"Handler"]) {
        eventHandler[name+"Handler"].apply(eventHandler, Array.prototype.slice.call(arguments, 1));
      }
    }
    return function(processing) {
      with (processing) {
        function runUserCode(cb) {
          if (userCode == "") { return cb(); }
          
          var runner = JsRunner.create({
            eventDelegate: eventHandler,
            processing: processing
          });
          
          function postScopeInit(interpreter, scope) {
            function processArgs(args) {
              return args.map(function(arg) {
                if (arg.isPrimitive) {
                  return arg.data;
                } else {
                  throw 'Unknown arg type: '+JSON.stringify(arg);
                }
              });
            }
            function wrapNativeFunction(f) {
              return function(var_arg) {
                return interpreter.createPrimitive(f.apply(null, processArgs(Array.prototype.slice.call(arguments))));                
              }
            }
            function wrapAsyncFunction(f) {
              return function(var_arg) {
                runner.set('isWaiting', true);
                var realArgs = processArgs(Array.prototype.slice.call(arguments));
                realArgs.unshift(function(value) {
                  interpreter.stateStack[0].value = value;
                  runner.set('isWaiting', false);
                  runner.stepAndSchedule();
                });
                f.apply(null, realArgs);
                return interpreter.createPrimitive(undefined);                
              }
            }
            var asyncs = {right: right, down: down, up: up, left: left};
            var syncs = {coloring: coloring, remainingDots: remainingDots, log: function(arg1, arg2, etc) {
              console.log.apply(console, Array.prototype.slice.call(arguments));
            }};
            Object.keys(asyncs).forEach(function(key) {
              if (this.hasOwnProperty(key)) {
                interpreter.setProperty(scope, key, 
                  interpreter.createNativeFunction(wrapAsyncFunction(this[key])));
              }
            }, asyncs);
            Object.keys(syncs).forEach(function(key) {
              if (this.hasOwnProperty(key)) {
                interpreter.setProperty(scope, key,
                  interpreter.createNativeFunction(wrapNativeFunction(this[key])));
              }
            }, syncs);
          }
          
          runner.set('interpreter', new Interpreter(userCode, postScopeInit));
          runner.passEvent('start', runner);
          runner.run(cb);
          // passEvent("start", interpreter);
          // interpreter.interpret(userCode, null, null, function(err, val) {
          //   if (err) {
          //     if (err.errorType == "timeout") {
          //       processing.noLoop();
          //       passEvent("runtimeError", {
          //         line: err.startPos.line+1, char: err.startPos.col,
          //         msg: "Execution timed out."
          //       });
          //     } else if (err.errorType == "stopped") {
          //       processing.noLoop();
          //       // passEvent("runtimeError", {
          //       //   line: err.startPos.line+1, char: err.startPos.col,
          //       //   msg: "Interpreter stopped."
          //       // });
          //     } else {
          //       console.log(err);
          //       processing.noLoop();
          //       passEvent("runtimeError", {
          //         line: 0, char: 0,
          //         msg: "Runtime error: "+(err && err.getMessage ? err.getMessage() : "(unknown)")
          //       });
          //     }
          //   } else {
          //     cb();
          //   }
          //   passEvent("stop");
          // });
        }

        // ROBOT CODE
        setup = function() {
          size(340, 340);
          background(255);
          setLevel(startLevel);
          runUserCode(function() {});
        }
  
        var position = null;
        var nextPosition = null;
        var levels;
        var levelNum = 0;
        var level;
        var setLevel = function(startLevel) {
          levelNum = (startLevel || 1)-1;
          levels = [
            {dots: new PositionSet([ {x: 5, y: 5}, {x: 7, y: 5} ]),
             obstacles: makeObstacles(2, 0, 1, 7) },
            {dots: new PositionSet([ {x: 9, y: 8 } ]),
             obstacles: makeObstacles(1,0,1,8).concat(makeObstacles(3,2,1,8)).concat(makeObstacles(5,0,1,8)).concat(makeObstacles(7,2,1,8)).concat(makeObstacles(9,0,1,8)) },
            level3(),
            level4(),
            level5()
          ];
          level = levels[levelNum];
          
          position = level.start || {x: 0, y: 0};
        }
 
        var coloring = function() {
          if (! level.colors) { return false; }
          var c = level.colors.contains(position.x, position.y);
          var returnValue = c ? c.hue : false;
          // console.log("coloring(", position.x, ",", position.y, ") = ", returnValue);
          return returnValue;
        }
        var remainingDots = function() {
          return level ? level.dots.list.length - level.dots.count("found", true) : 0;
        }
 
        function level3() {
          var holes = [5];
          for (var i = 1; i <= 3; ++i) {
              holes.push(holes[i-1]+(Math.random()<0.5 ? -1 : 1));
          }
          var start = 1;
          var obstacles = new PositionSet([]);
          var colors = new PositionSet([]);
          for (var i = 0; i < holes.length; ++i) {
              obstacles = obstacles
                  .concat(makeObstacles(start+i*2, 0, 1, holes[i]))
                  .concat(makeObstacles(start+i*2, holes[i]+1, 1, (9-holes[i])));
              if (i > 0) {
                  colors.push({x: (start-1)+i*2, y: holes[i-1], hue: holes[i] < holes[i-1] ? "red" : "blue"});
              }
          }
          var ret = {
              start: { x: 0, y: 5 },
              dots: new PositionSet([ { x:9, y: holes[holes.length-1] } ]),
              obstacles: obstacles,
              colors: colors
          };
          return ret;    
        }
 
        function level4() {
          var holes = [
              Math.floor(Math.random()*5+5),
              Math.floor(Math.random()*5),
              Math.floor(Math.random()*5+5),
              Math.floor(Math.random()*5) 
          ];
          var start = 1;
          var obstacles = new PositionSet([]);
          var colors = new PositionSet([{x:8, y:9, hue:"red"}]);
          for (var i = 0; i < holes.length; ++i) {
              obstacles = obstacles
                  .concat(makeObstacles(start+i*2, 0, 1, holes[i]))
                  .concat(makeObstacles(start+i*2, holes[i]+1, 1, (9-holes[i])));
              colors.push({x: (start-1)+i*2, y: holes[i], hue: "red"});
          }
          var ret = {
              start: { x: 0, y: 0 },
              dots: new PositionSet([ { x:9, y: 9 } ]),
              obstacles: obstacles,
              colors: colors
          };
          return ret;
        }
    
        function level5() {
          function sum(p1, p2) {
            return {x: p1.x + p2.x, y: p1.y + p2.y};
          }
          function s(p) { return "("+p.x+","+p.y+")"; }
          var obstacles = new PositionSet([]);
          var pos = {x: 0, y: 0};
          var attempts = 40;
          var colors = new PositionSet([]);
          var passedOver = new PositionSet([pos]);
          var lastNextPos = {x: 9, y: 9};
          var lastDirection;
          while (attempts-- > 0) {
            var dIndex = Math.floor(Math.random()*4);
            var direction = [{x: -1, y: 0}, {x: 0, y: -1}, {x: 1, y: 0}, {x: 0, y: 1}][dIndex];
            if (dIndex == lastDirection) {
              continue;
            }
            var nextPos = sum(pos, direction);
            if (nextPos.x < 0 || nextPos.x > 9 || nextPos.y < 0 || nextPos.y > 9) {
              continue;
            }
            if (passedOver.contains(nextPos.x, nextPos.y)) {
              continue;
            }
            passedOver.push(nextPos);
            lastNextPos = nextPos;
            for (var i = 0; i < Math.floor(Math.random()*9); ++i) {
              nextPos = sum(nextPos, direction);
              if (nextPos.x < 0 || nextPos.x > 9 || nextPos.y < 0 || nextPos.y > 9) {
                break;
              }
              if (passedOver.contains(nextPos.x, nextPos.y)) {
                break;
              }
              if (Math.random() < 0.25) {
                // obstacles.push(nextPos);
                // passedOver.push(nextPos);
                break;
              }
              passedOver.push(nextPos);
              lastNextPos = nextPos;
            }
            var c = {x: pos.x, y: pos.y, hue: ['red', 'blue', 'green', 'yellow'][dIndex]};
            colors.push(c);
            pos = lastNextPos;
            lastDirection = dIndex;
          }
          for (var i = 0; i < 10; ++i) {
            for (var j = 0; j < 10; ++j) {
              if (Math.random() < .75 && 
                  ! passedOver.contains(i, j) && (
                  passedOver.contains(i-1, j) ||
                  passedOver.contains(i, j-1) ||
                  passedOver.contains(i+1, j) ||
                  passedOver.contains(i, j+1))) {
                obstacles.push({x: i, y: j});
              }
            }
          }
          return {
            start: {x: 0, y: 0},
            dots: new PositionSet([lastNextPos]),
            obstacles: obstacles,
            colors: colors
          };
        }
 
        var MOVETIME = 200;
        var moveFinishedCb;
        var overlayText = null;
        var moveStart = -MOVETIME;
        var runCommand = function(op, cb) {
          // console.log("running command:", op);
          var newPos = applyCommand(op);
          if (newPos) {
            nextPosition = newPos;
            moveStart = millis();
            moveFinishedCb = function() {
              position = nextPosition;
              nextPosition = null;
              var dot = level.dots.contains(position.x, position.y);
              if (dot) {
                dot.found = true;
              }
              if (remainingDots() == 0) {
                if (levelNum < levels.length) {
                  passEvent("levelCompleted", levelNum+1);                  
                }
                overlayText = "LEVEL "+(levelNum+1)+"\nCLEARED";
              }
              moveFinishedCb = null;
              cb();
            }
            // sim.position = newPos;
            // sim.simulation.push({type: "move", pos: sim.position});
            // var trash = sim.levels[sim.level].trash.contains(sim.position.x, sim.position.y);
            // if (trash) {
            //   trash.found = true;
            //   sim.simulation.push({type: "found-trash", pos: sim.position});
            // }
            // if (sim.levels[sim.level].trash.count("found", true) == sim.levels[sim.level].trash.list.length) {
            //   // advance level
            //   // sim.level++;
            //   if (sim.level < sim.levels.length) {
            //       // sim.position = sim.levels[sim.level].start || {x: 0, y: 0};
            //       sim.simulation.push({type: "level", level: sim.level+2}); // 2 because sim.level is one less than the real level.
            //   }
            // }
          } else {
            setTimeout(cb, MOVETIME);
            // sim.simulation.push({type: "move", pos: sim.position});
          }
        }
        var left = function(cb) {
          runCommand('left', cb);
        }
        var right = function(cb) {
          runCommand('right', cb);
        }
        var up = function(cb) {
          runCommand('up', cb);
        }
        var down = function(cb) {
          runCommand('down', cb);
        }
 
        var GRIDWIDTH=30;
        var MARGIN=20;
        var CELLROWS = 10;
        var CELLCOLS = 10;
        var applyCommand = function(command) {
          var np = null;
          switch(command) {
            case 'right':
              np = {x: position.x+1, y: position.y};
              break;
            case 'left':
              np = {x: position.x-1, y: position.y};
              break;
            case 'up':
              np = {x: position.x, y: position.y-1};
              break;
            case 'down':
              np = {x: position.x, y: position.y+1};
              break;
            default:
              println("unknown command: "+command);
          }
          if (! np) { return false; }
          if (level.obstacles.contains(np.x, np.y) ||
              np.x < 0 || np.y < 0 || np.x > (CELLCOLS-1) || np.y > (CELLROWS-1)) {
            return false;
          }
          return np;
        }
 
        var makeObstacles = function(x, y, width, height) {
            var out = [];
            for (var i = 0; i < width; ++i) {
                for (var j = 0; j < height; ++j) {
                    out.push({x: x+i, y: y+j});
                }
            }
            return new PositionSet(out);
        }
 
        var ellipseAtLoc = function(loc) {
            ellipse(MARGIN+(loc.x+0.5)*GRIDWIDTH, MARGIN+(loc.y+0.5)*GRIDWIDTH, GRIDWIDTH/2, GRIDWIDTH/2);
        }
 
        // var nextPosition;
        // var programCounter = 0;
 
        var moveStart = -MOVETIME;
        var drawCurrentPosition = function() {
          var p = position;
          fill(238, 0, 0); // red
          if (nextPosition) {
            var np = nextPosition;
            ellipseAtLoc({ 
                x: p.x+(np.x-p.x)*Math.min(MOVETIME, millis()-moveStart)/MOVETIME,
                y: p.y+(np.y-p.y)*Math.min(MOVETIME, millis()-moveStart)/MOVETIME
            });
          } else {
            ellipseAtLoc(position);
          }
        }
        var updatePosition = function() {
            if (millis()-moveStart > MOVETIME && moveFinishedCb) {
              moveFinishedCb();
                // if (programCounter >= sim.simulation.length) {
                //     noLoop();
                //     return;
                // }
                // sim.position = nextPosition;
                // var resume = false;
                // while (! resume && programCounter < sim.simulation.length) {
                //     var cmd = sim.simulation[programCounter++];
                //     switch (cmd.type) {
                //         case 'level':
                //             levelUnlockHandler(cmd.level);
                //             sim.overlayText = "LEVEL "+(cmd.level-1)+"\nCLEARED";
                //             break;
                //         case 'found-trash':
                //             sim.levels[sim.level].trash.contains(cmd.pos.x, cmd.pos.y).hide = true;
                //             break;
                //         case 'start-position':
                //             nextPosition = sim.position = cmd.pos;
                //             break;
                //         case 'move':
                //             // console.log("moving to", cmd.pos.x+","+cmd.pos.y);
                //             nextPosition = cmd.pos;
                //             resume = true;
                //             break;
                //         default:
                //             break;
                //     }
                // }
                // moveStart = millis();
            }
        }
 
        function PositionSet(list, grid) {
            var posRegex = new RegExp("(\\d+),(\\d)");
            if (list && ! grid) {
                grid = {};
                list.forEach(function(pos) {
                    grid[pos.x+","+pos.y] = pos;
                });
            }
            if (grid && ! list) {
                list = [];
                for (var k in grid) {
                    var obj = grid[k];
                    var parts = posRegex.exec(k);
                    if (parts) {
                        obj.x = parts[1];
                        obj.y = parts[2];
                        list.push(obj);
                    }
                }
            }
            if (! grid || ! list) {
                return null;
            }
            this.list = list;
            this.grid = grid;
            this.contains = function(x, y) {
                return this.grid[x+","+y];
            }
            this.count = function(property, value) {
                return this.list.filter(function(x) { return x[property] == value; }).length;
            }
            this.push = function(pos) {
                this.list.push(pos);
                this.grid[pos.x+","+pos.y] = pos;
            }
            this.concat = function(positionSet) {
                return new PositionSet(this.list.concat(positionSet.list));
            }
            this.forEach = function(f) {
                return this.list.forEach(f);
            }
        }
 
        var setFill = function(hue) {
            switch (hue) {
                case "red":
                    fill(255, 220, 220);
                    break;
                case "blue":
                    fill(150, 200, 255);
                    break;
                case "green":
                    fill(200, 255, 200);
                    break;
                case "yellow":
                    fill(255, 255, 200);
                    break;
                default:
                    break;
            }
        }
 
        var drawColors = function() {
            if (level.colors) {
                level.colors.forEach(function(c) {
                    setFill(c.hue);
                    rect(MARGIN+c.x*GRIDWIDTH+1,
                         MARGIN+c.y*GRIDWIDTH+1,
                         GRIDWIDTH-1, GRIDWIDTH-1);
                });
            }
        }
 
        var drawObstacles = function() {
            fill(154);
            level.obstacles.forEach(function(o) {
                rect(MARGIN+o.x*GRIDWIDTH,
                     MARGIN+o.y*GRIDWIDTH,
                     GRIDWIDTH, GRIDWIDTH);
            });
        }
 
        var simRedraw = function() {
            background(255);
 
            var fontA = loadFont("Courier New");
            textFont(fontA, 12);
            textAlign(LEFT);
            // var dotsRemaining = level.dots.list.length - level.dots.count("hide", true);
            text("Green dots remaining: "+remainingDots(), 20, 10);
 
            stroke(204);
            for (var i = 0; i <= CELLCOLS+1; ++i) {
                line(MARGIN+i*GRIDWIDTH, MARGIN, MARGIN+i*GRIDWIDTH, height-MARGIN);
            }
            for (var i = 0; i <= CELLROWS+1; ++i) {
                line(MARGIN, MARGIN+i*GRIDWIDTH, width-MARGIN, i*GRIDWIDTH+MARGIN);
            }
            noStroke();
            drawColors();
            drawObstacles();
            fill(0, 238, 0); // green
            level.dots.list.filter(function(x) { return ! x.found; }).forEach(ellipseAtLoc);
            drawCurrentPosition();
            if (overlayText) {
              fill(255,128);
              rect(0,0,width,height);
              fill(238,0,0);
              textFont(fontA, 48);
              textAlign(CENTER);
              text(overlayText, width/2, 150);
            }
        }
 
        draw = function() {
            // if (runningUserCode) { return; }
            updatePosition();
            simRedraw();
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
    processingInstance = new Processing(canvas, sketchProc(userCode, controller.get('level'), controller));
  }

  window.ProcessingWrapper = {
    executeCode: executeCode
  }
})()
