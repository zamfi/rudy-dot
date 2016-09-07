(function() {  
  var JsRunner = Ember.Object.extend({
    interpreter: null,
    interpreterChange: function() {
      if (this.get('eventDelegate')) {
        this.get('interpreter').stateStack.addDelegate(this.get('eventDelegate'));        
      }
    }.observes('interpreter'),
    eventDelegate: Em.required(),
    evaluationDelayBinding: "eventDelegate.evaluationDelay",
    processing: Em.required(),
    deadline: 0,
    passEvent: function(name, arg1, arg2, etc) {
      var eventHandler = this.get('eventDelegate');
      if (eventHandler && eventHandler[name+"Handler"]) {
        eventHandler[name+"Handler"].apply(eventHandler, Array.prototype.slice.call(arguments, 1));
      }
    },
    stepAndSchedule: function() {
      if (this.get('isFinished')) { return; }
      if (this.get('deadline') && this.get('deadline') < Date.now()) {
        console.log("Execuntion timeout!");
        this.get('processing').noLoop();
        var interpreter = this.get('interpreter');
        var topFrame = interpreter.stateStack[0];        
        this.passEvent("runtimeError", new Error("timeout"), interpreter.stateStack[0], interpreter.stateStack);
        this.passEvent("stop", this.get('interpreter'));
        return;
      }
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
  
  
  function sketchProc(userCode, startLevel, eventHandler, seed, completionCallback) {
    function passEvent(name, arg1, arg2, etc) {
      if (eventHandler && eventHandler[name+"Handler"]) {
        eventHandler[name+"Handler"].apply(eventHandler, Array.prototype.slice.call(arguments, 1));
      }
    }
    var DONTDRAW = (completionCallback !== undefined);
    return function(processing) {
      console.log("DONTDRAW?", DONTDRAW);
      with (processing) {
        function runUserCode(cb) {
          if (userCode == "") { return cb(); }
          
          runner = JsRunner.create({
            eventDelegate: (DONTDRAW ? null : eventHandler),
            evaluationDelay: (DONTDRAW ? 0 : undefined),
            processing: processing,
            deadline: DONTDRAW ? Date.now() + 500 : 0
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
            var syncs = {getColor: getColor, setColor: setColor, remainingDots: remainingDots, log: function(arg1, arg2, etc) {
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
        }

        // ROBOT CODE
        setup = function() {
          if (seed) {
            randomSeed(seed);
          }
          size(340, 340);
          if (! DONTDRAW) {
            background(255);            
          }
          setLevel(startLevel);
          runUserCode(function() {
            if (completionCallback && DONTDRAW)  {
              completionCallback(remainingDots() == 0);
            }
          });
        }
  
        var position = null;
        var nextPosition = null;
        var levels;
        var levelNum = 0;
        var level;
        var setLevel = function(startLevel) {
          levelNum = (startLevel || 1)-1;
          levels = [
            levelRoundTheFence,
            levelAnObstacleCourse,
            levelThroughTheGate,
            levelThroughTwoGates,
            levelUpOrDown,
            levelOutOfTheBox,
            levelRedsTheMark,
            levelDownUpDownUpDown,
            levelGateSequence,
            levelFollowTheColors
            // levelFreePlay
          ];
          level = levels[levelNum]();
          
          position = level.start || {x: 0, y: 0};
        }
        
        var allHues = {
          "red": {r: 255, g: 220, b: 220},
          "blue": {r: 150, g: 200, b: 255},
          "green": {r: 200, g: 255, b: 200},
          "yellow": {r: 255, g: 255, b: 200},
          false: {r: 255, g: 255, b: 255}
        }
 
        var getColor = function() {
          if (! level.colors) { return false; }
          var c = level.colors.contains(position.x, position.y);
          var returnValue = c ? c.hue : false;
          // console.log("coloring(", position.x, ",", position.y, ") = ", returnValue);
          return returnValue;
        }
        var setColor = function(hue) {
          if (hue === undefined || ! allHues[hue]) {
            throw new Error("setColor(color) requires one argument, a color, such as returned by the getColor() function.");
          }
          if (! level.colors) {
            level.colors = new PositionSet([]);
          }
          var pos = level.colors.contains(position.x, position.y);
          if (pos) {
            pos.hue = hue;
          } else {
            level.colors.push({
              x: position.x,
              y: position.y,
              hue: hue
            });
          }
        }
        var remainingDots = function() {
          return level ? level.dots.list.length - level.dots.count("found", true) : 0;
        }
        
        var levelRoundTheFence = function() {
          return { 
            dots: new PositionSet([ {x: 5, y: 5}, {x: 7, y: 5} ]),
            obstacles: makeRectangularPositionSet(2, 0, 1, 7) 
          };
        }
        
        var levelAnObstacleCourse = function() {
          return {
            dots: new PositionSet([ {x: 5, y: 5}, {x: 5, y: 7}]),
            obstacles: makeRectangularPositionSet(2, 0, 1, 6).concat(makeRectangularPositionSet(4, 5, 1, 5))
          };
        }
        
        var levelThroughTheGate = function() {
          var hue = ['red', 'blue', 'green', 'yellow'][Math.floor(random()*4)];
          return {
            dots: new PositionSet([ {x: 4, y: 4 } ]),
            obstacles: makeRectangularPositionSet(3,0,1,5).concat(makeRectangularPositionSet(3,6,1,4)),
            gates: [new GateSet([makeRectangularPositionSet(2, 5, 2, 1)])],
            colors: new PositionSet([ {x: 3, y: 5, hue: hue }, {x: 0, y:2, hue: hue } ])
          };
        }
        
        var levelThroughTwoGates = function() {
          var randomIndex = Math.floor(random()*4);
          var hue1 = ['red', 'blue', 'green', 'yellow'][randomIndex];
          var hue2 = ['blue', 'green', 'yellow', 'red'][randomIndex];
          return {
            dots: new PositionSet([{x: 3, y: 5}, {x: 6, y: 5}]),
            obstacles: makeRectangularPositionSet(2, 3, 7, 1).concat(makeRectangularPositionSet(2, 7, 7, 1)).concat(makeRectangularPositionSet(8, 4, 1, 3))
                       .concat(new PositionSet([{x: 2, y: 4}, {x: 5, y: 4}, {x: 2, y: 6}, {x: 5, y: 6}])),
            gates: [new GateSet([makeRectangularPositionSet(1, 5, 2, 1)]), new GateSet([makeRectangularPositionSet(4, 5, 2, 1)])],
            colors: new PositionSet([ {x: 2, y: 5, hue: hue1}, {x: 1, y: 4, hue: hue1}, {x: 5, y: 5, hue: hue2}, {x: 4, y: 4, hue: hue2}])
          };
        }

        var levelGateSequence = function() {
          var hues = [];
          for (var i = 0; i < 8; ++i) {
            hues.push(['red', 'blue', 'green', 'yellow'][Math.floor(random()*4)]);
          }
          var obstacles = makeRectangularPositionSet(1,0,1,9);
          for (var i = 0; i < 7; ++i) {
            obstacles.push({
              x: i+2,
              y: 7-i
            });
            obstacles.push({
              x: i+3,
              y: 9-i
            });
          }
          return {
            dots: new PositionSet([ {x: 9, y: 0 }]),
            obstacles: obstacles,
            gates: hues.map(function(hue, index) {
              return new GateSet([makeRectangularPositionSet(index+1,9-index,2,1)]);
            }),
            colors: new PositionSet(hues.map(function(hue, index) {
              return { x: index+2, y: 9-index, hue: hue }
            })).concat(new PositionSet(hues.map(function(hue, index) {
              return { x: 0, y: index+1, hue: hue }
            })))
          }
        }
        
        var levelDownUpDownUpDown = function() {
          return {
            dots: new PositionSet([ {x: 9, y: 8 } ]),
            obstacles: makeRectangularPositionSet(1,0,1,8).concat(makeRectangularPositionSet(3,2,1,8)).concat(makeRectangularPositionSet(5,0,1,8)).concat(makeRectangularPositionSet(7,2,1,8)).concat(makeRectangularPositionSet(9,0,1,8)) 
          };
        }
 
        var levelUpOrDown = function() {
          var holes = [5];
          for (var i = 1; i <= 3; ++i) {
              holes.push(holes[i-1]+(random()<0.5 ? -1 : 1));
          }
          var start = 1;
          var obstacles = new PositionSet([]);
          var colors = new PositionSet([]);
          for (var i = 0; i < holes.length; ++i) {
              obstacles = obstacles
                  .concat(makeRectangularPositionSet(start+i*2, 0, 1, holes[i]))
                  .concat(makeRectangularPositionSet(start+i*2, holes[i]+1, 1, (9-holes[i])));
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
        
        var levelOutOfTheBox = function() {
          var path = [random() < 0.5, random() < 0.5];
          return {
            start: {x: 3, y: 4},
            dots: new PositionSet([ {x: path[1] ? 3 : 5, y: path[0] ? 0 : 8 }]),
            obstacles: makeRectangularPositionSet(2, 2, 1, 5).concat(makeRectangularPositionSet(6, 2, 1, 5))
                      .concat(makeRectangularPositionSet(0, 4, 2, 1)).concat(makeRectangularPositionSet(7, 4, 3, 1))
                      .concat(new PositionSet([{x: 3, y: 2}, {x: 5, y: 2}, {x: 3, y: 6}, {x: 5, y: 6}, {x: 4, y: 0}, {x: 4, y: 8}, {x: 4, y: 9}])),
            colors: new PositionSet([ {x: 4, y: 4, hue: path[0] ? "red" : "blue" },
                                      {x: 4, y: path[0] ? 1 : 7, hue: path[1] ? "red" : "blue" }])
          }
        }
 
        var levelRedsTheMark = function() {
          var holes = [
              Math.floor(random()*5+5),
              Math.floor(random()*5),
              Math.floor(random()*5+5),
              Math.floor(random()*5) 
          ];
          var start = 1;
          var obstacles = new PositionSet([]);
          var colors = new PositionSet([{x:8, y:9, hue:"red"}]);
          for (var i = 0; i < holes.length; ++i) {
              obstacles = obstacles
                  .concat(makeRectangularPositionSet(start+i*2, 0, 1, holes[i]))
                  .concat(makeRectangularPositionSet(start+i*2, holes[i]+1, 1, (9-holes[i])));
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
    
        var levelFollowTheColors = function() {
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
            var dIndex = Math.floor(random()*4);
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
            for (var i = 0; i < Math.floor(random()*9); ++i) {
              nextPos = sum(nextPos, direction);
              if (nextPos.x < 0 || nextPos.x > 9 || nextPos.y < 0 || nextPos.y > 9) {
                break;
              }
              if (passedOver.contains(nextPos.x, nextPos.y)) {
                break;
              }
              if (random() < 0.25) {
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
              if (random() < .75 && 
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
              if (nextPosition && ! nextPosition.failed) {
                position = nextPosition;
                var dot = level.dots.contains(position.x, position.y);
                if (dot) {
                  dot.found = true;
                }
                if (remainingDots() == 0) {
                  if (completionCallback) {
                    completionCallback(true);
                    completionCallback = null;
                  }
                  if ((! DONTDRAW) && levelNum < levels.length) {
                    passEvent("levelCompleted", levelNum+1);                  
                  }
                  overlayText = "LEVEL "+(levelNum+1)+"\nCLEARED";
                }
              }
              nextPosition = null;
              moveFinishedCb = null;
              cb();
            }
            if (DONTDRAW) {
              moveFinishedCb();
            }
          } else {
            if (DONTDRAW) {
              cb();
            } else {
              setTimeout(cb, MOVETIME);              
            }
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
              np.x < 0 || np.y < 0 || np.x > (CELLCOLS-1) || np.y > (CELLROWS-1) ||
              (level.gates && level.gates.some(function(gate) {
                if (! level.colors) { return false; }
                return (gate.gatesAt(position.x, position.y) || []).contains(np.x, np.y) &&
                  (level.colors.contains(position.x, position.y) || {}).hue != (level.colors.contains(np.x, np.y) || {}).hue;
              }))) {
            np.failed = true;
          }
          return np;
        }
 
        var makeRectangularPositionSet = function(x, y, width, height) {
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
  
        var moveStart = -MOVETIME;
        var drawCurrentPosition = function() {
          var p = position;
          fill(238, 0, 0); // red
          var stepFraction = Math.min(MOVETIME, millis()-moveStart)/MOVETIME
          if (nextPosition && ! nextPosition.failed) {
            var np = nextPosition;
            ellipseAtLoc({ 
              x: p.x+(np.x-p.x)*stepFraction,
              y: p.y+(np.y-p.y)*stepFraction
            });
          } else if (nextPosition && nextPosition.failed) {
            var np = nextPosition;
            if (stepFraction < 0.25) { // at the point where the circle touches the grid edge
              ellipseAtLoc({
                x: p.x+(np.x-p.x)*stepFraction,
                y: p.y+(np.y-p.y)*stepFraction
              });
            } else if (stepFraction < 0.30) {
              ellipseAtLoc({
                x: p.x+(np.x-p.x)*(0.5-stepFraction),
                y: p.y+(np.y-p.y)*(0.5-stepFraction)
              });
            } else if (stepFraction < 0.80) {
              ellipseAtLoc({
                x: p.x+(np.x-p.x)*0.20,
                y: p.y+(np.y-p.y)*0.20                
              });
            } else {
              ellipseAtLoc({
                x: p.x+(np.x-p.x)*(1-stepFraction),
                y: p.y+(np.y-p.y)*(1-stepFraction)
              });
            }
          } else {
            ellipseAtLoc(position);
          }
        }
        var updatePosition = function() {
          if (millis()-moveStart > MOVETIME && moveFinishedCb) {
            moveFinishedCb();
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
        }
        PositionSet.prototype = {
          contains: function(x, y) {
            return this.grid[x+","+y];
          },
          count: function(property, value) {
            return this.list.filter(function(x) { return x[property] == value; }).length;
          },
          push: function(pos) {
            this.list.push(pos);
            this.grid[pos.x+","+pos.y] = pos;
          },
          concat: function(positionSet) {
            return new PositionSet(this.list.concat(positionSet.list));
          },
          forEach: function(f) {
            return this.list.forEach(f, this);
          },
          borders: function() {
            if (! this._borders) {
              this._borders = [];
              this.forEach(function(pos) {
                if (this.contains(pos.x+1, pos.y)) {
                  this._borders.push({from: pos, to: {x: pos.x+1, y: pos.y} });
                } else if (this.contains(pos.x, pos.y+1)) {
                  this._borders.push({from: pos, to: {x: pos.x, y: pos.y+1} });
                }
              });
            }
            return this._borders;
          }
        };
        function GateSet(list) {
          var grid = {};
          list.forEach(function(posSet) {
            posSet.forEach(function(pos) {
              var key = pos.x+","+pos.y;
              posSet.forEach(function(otherPos) {
                if (pos != otherPos) {
                  if (grid[key]) {
                    grid[key] = grid[key].push(otherPos);
                  } else {
                    grid[key] = new PositionSet([otherPos]);
                  }
                }
              });
            });
          });
          this.grid = grid;
          this.list = list;
        }
        GateSet.prototype = {
          gatesAt: function(x, y) {
            return this.grid[x+","+y];
          },
          concat: function(gateSet) {
            return new GateSet(this.list.concat(gateSet.list));
          },
          forEach: function(f) {
            return this.list.forEach(f);
          }
        };

        var setFill = function(hue) {
          var c = allHues[hue];
          if (c) {
            fill(c.r, c.g, c.b);
          }
        };
 
        var drawColors = function() {
          if (level.colors) {
            level.colors.forEach(function(c) {
              setFill(c.hue);
              rect(MARGIN+c.x*GRIDWIDTH+1,
                   MARGIN+c.y*GRIDWIDTH+1,
                   GRIDWIDTH-1, GRIDWIDTH-1);
            });
          }
        };
 
        var drawObstacles = function() {
          fill(154);
          level.obstacles.forEach(function(o) {
            rect(MARGIN+o.x*GRIDWIDTH,
                 MARGIN+o.y*GRIDWIDTH,
                 GRIDWIDTH, GRIDWIDTH);
          });
        };
 
        var drawGates = function() {
          if (level.gates) {
            level.gates.forEach(function(gate) {
              gate.forEach(function(set) {
                set.borders().forEach(function(border) {
                  fill(154);
                  if ((level.colors.contains(border.from.x, border.from.y) || {}).hue !=
                      (level.colors.contains(border.to.x, border.to.y) || {}).hue) {
                    // gate is closed!
                    if (border.to.x > border.from.x) {
                      // vertical gate
                      rect(MARGIN+border.to.x*GRIDWIDTH-GRIDWIDTH/20,
                           MARGIN+border.to.y*GRIDWIDTH,
                           GRIDWIDTH/10, GRIDWIDTH);
                    } else {
                      // horizontal gate
                      rect(MARGIN+border.to.x*GRIDWIDTH,
                           MARGIN+border.yo.y*GRIDWIDTH-GRIDWIDTH/20,
                           GRIDWIDTH, GRIDWIDTH/10);
                    }
                  } else {
                    // gate is open!
                    if (border.to.x > border.from.x) {
                      // vertical gate
                      rect(MARGIN+border.to.x*GRIDWIDTH-GRIDWIDTH/20,
                           MARGIN+border.to.y*GRIDWIDTH,
                           GRIDWIDTH/10, GRIDWIDTH/6);
                      rect(MARGIN+border.to.x*GRIDWIDTH-GRIDWIDTH/20,
                           MARGIN+border.to.y*GRIDWIDTH+5*GRIDWIDTH/6,
                           GRIDWIDTH/10, GRIDWIDTH/6);
                    } else {
                      // horizontal gate
                      rect(MARGIN+border.to.x*GRIDWIDTH,
                           MARGIN+bor6der.yo.y*GRIDWIDTH-GRIDWIDTH/20,
                           GRIDWIDTH/6, GRIDWIDTH/10);
                      rect(MARGIN+border.to.x*GRIDWIDTH+5*GRIDWIDTH/6,
                           MARGIN+border.yo.y*GRIDWIDTH-GRIDWIDTH/20,
                           GRIDWIDTH/6, GRIDWIDTH/10);
                    }
                  }
                });
              });
            });
          }
        };
 
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
            drawGates();
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
            if (! DONTDRAW) {
              updatePosition();
              simRedraw();              
            }
        }
      }
    };
  }
  var processingInstance;
  var sampleInstance;
  var lastSeed;
  var doneRunningSamples = false;
  function sampleExecution(userCode, controller, cb) {
    if (sampleInstance) {
      sampleInstance.noLoop();
      // console.log(processingInstance);
    }
    var canvas = document.getElementById('sample');

    lastSeed = Date.now() + Math.floor(Math.random() * 10000000000);
    console.log("running sample with seed", lastSeed);
    var start = Date.now();
    sampleInstance = new Processing(canvas, sketchProc(userCode, controller.get('level'), controller, lastSeed, function(success) {
      if (! success) {
        cb();
      } else {
        setTimeout(function() {
          if (! doneRunningSamples) {
            sampleExecution(userCode, controller, cb);
          }
        }, 0);
      }
    }));
  }
  
  function executeCode(userCode, controller) {
    var canvas = document.getElementById('pjs');
    var expiredTimeout;
    function doRealExecution(seed) {
      doneRunningSamples = true;
      if (expiredTimeout) {
        clearTimeout(expiredTimeout);
        expiredTimeout = null;
      }
      if (processingInstance) {
        processingInstance.noLoop();
        // console.log(processingInstance);
      }
      if (sampleInstance) {
        sampleInstance.noLoop();
      }
      processingInstance = new Processing(canvas, sketchProc(userCode, controller.get('level'), controller, seed, undefined));      
    }
    expiredTimeout = setTimeout(function() { 
      expiredTimeout = null;
      doRealExecution(lastSeed);
    }, 500);
    doneRunningSamples = false;
    sampleExecution(userCode, controller, function() {
      doRealExecution(lastSeed);
    });
  }

  window.ProcessingWrapper = {
    executeCode: executeCode
  }
})()
