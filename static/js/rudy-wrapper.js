(function() {  
  function sketchProc(userCode, startLevel, runtimeErrorHandler, levelUnlockHandler) {
    return function(processing) {
      with (processing) {
        function runUserCode(cb) {
          var interpreter = window.JSEvaluator.Interpreter.create({
            builtIns: {
              right: right,
              down: down,
              up: up,
              left: left,
              coloring: coloring,
              remainingDots: remainingDots
            }
          });
          interpreter.interpret(userCode, null, null, function(err, val) {
            if (err) {
              if (err.errorType == "timeout") {
                runtimeErrorHandler({
                  line: err.startPos.line+1, char: err.startPos.col,
                  msg: "Execution timed out."
                });
              } else {
                console.log(err);
                runtimeErrorHandler({
                  line: 0, char: 0,
                  msg: "Runtime error: "+(err && err.getMessage ? err.getMessage() : "(unknown)")
                });
              }                
            } else {
              cb();
            }
          });
        }

        var runningUserCode = false;
        // ROBOT CODE
        setup = function() {
          size(340, 340);
          background(255);
          // try {
            // console.log("setting initial level", startLevel);
            setLevel(startLevel);
            runningUserCode = true;
            runUserCode(function() {
              runningUserCode = false;
            });
          // } catch (e) {
            // threw an error. continue partial execution anyway.
            // console.log(userCode, e);
          // }
        }
 
        var MOVETIME = 200;
 
        var position = null;
        var sim;
        var setLevel = function(startLevel) {
            sim = {
                levels: [
                    {trash: new PositionSet([ {x: 5, y: 5}, {x: 7, y: 5} ]),
                     obstacles: makeObstacles(2, 0, 1, 7) },
                    {trash: new PositionSet([ {x: 9, y: 8 } ]),
                     obstacles: makeObstacles(1,0,1,8).concat(makeObstacles(3,2,1,8)).concat(makeObstacles(5,0,1,8)).concat(makeObstacles(7,2,1,8)).concat(makeObstacles(9,0,1,8)) },
                    level3(),
                    level4(),
                    level5()
                  ],
                simulation: [],
                level: (startLevel || 1)-1
            };
            sim.position = sim.levels[sim.level].start || {x: 0, y: 0};
            sim.simulation.push({type: "start-position", pos: sim.position});
        }
 
        var coloring = function() {
            if (! sim.levels[sim.level].colors) { return false; }
            var c = sim.levels[sim.level].colors.contains(sim.position.x, sim.position.y);
            return c ? c.hue : false;
        }
        var remainingDots = function() {
            return sim.levels[sim.level] ? sim.levels[sim.level].trash.list.length - sim.levels[sim.level].trash.count("found", true) : 0;
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
                trash: new PositionSet([ { x:9, y: holes[holes.length-1] } ]),
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
                trash: new PositionSet([ { x:9, y: 9 } ]),
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
            trash: new PositionSet([lastNextPos]),
            obstacles: obstacles,
            colors: colors
          };
        }
 
        var addCommand = function(op) {
          console.log("adding command:", op);
            var newPos = applyCommand(op);
            if (newPos) {
                sim.position = newPos;
                sim.simulation.push({type: "move", pos: sim.position});
                var trash = sim.levels[sim.level].trash.contains(sim.position.x, sim.position.y);
                if (trash) {
                    trash.found = true;
                    sim.simulation.push({type: "found-trash", pos: sim.position});
                }
                if (sim.levels[sim.level].trash.count("found", true) == sim.levels[sim.level].trash.list.length) {
                    // advance level
                    // sim.level++;
                    if (sim.level < sim.levels.length) {
                        // sim.position = sim.levels[sim.level].start || {x: 0, y: 0};
                        sim.simulation.push({type: "level", level: sim.level+2}); // 2 because sim.level is one less than the real level.
                    }
                }
            } else {
                sim.simulation.push({type: "move", pos: sim.position});
            }
        }
        var left = function() {
            addCommand('left');
        }
        var right = function() {
            addCommand('right');
        }
        var up = function() {
            addCommand('up');
        }
        var down = function() {
            addCommand('down');
        }
 
        var GRIDWIDTH=30;
        var MARGIN=20;
        var CELLROWS = 10;
        var CELLCOLS = 10;
        var applyCommand = function(command) {
            var np = null;
            switch(command) {
                case 'right':
                    np = {x: sim.position.x+1, y: sim.position.y};
                    break;
                case 'left':
                    np = {x: sim.position.x-1, y: sim.position.y};
                    break;
                case 'up':
                    np = {x: sim.position.x, y: sim.position.y-1};
                    break;
                case 'down':
                    np = {x: sim.position.x, y: sim.position.y+1};
                    break;
                default:
                    println("unknown command: "+command);
            }
            if ((! np) || 
                sim.levels[sim.level].obstacles.contains(np.x, np.y) ||
                np.x < 0 || np.y < 0 || np.x > (CELLCOLS-1) || np.y > (CELLROWS-1)) {
                return false;
            } else {
                return np;
            }
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
 
        var obstacleGrid;
        var nextPosition;
        var programCounter = 0;
 
        var moveStart = -MOVETIME;
        var drawCurrentPosition = function() {
            var p = sim.position;
            var np = nextPosition;
            fill(238, 0, 0); // red
            ellipseAtLoc({ 
                x: p.x+(np.x-p.x)*Math.min(MOVETIME, millis()-moveStart)/MOVETIME,
                y: p.y+(np.y-p.y)*Math.min(MOVETIME, millis()-moveStart)/MOVETIME
            });
        }
        var updatePosition = function() {
            if (millis()-moveStart > MOVETIME) {
                if (programCounter >= sim.simulation.length) {
                    noLoop();
                    return;
                }
                sim.position = nextPosition;
                var resume = false;
                while (! resume && programCounter < sim.simulation.length) {
                    var cmd = sim.simulation[programCounter++];
                    switch (cmd.type) {
                        case 'level':
                            levelUnlockHandler(cmd.level);
                            sim.overlayText = "LEVEL "+(cmd.level-1)+"\nCLEARED";
                            break;
                        case 'found-trash':
                            sim.levels[sim.level].trash.contains(cmd.pos.x, cmd.pos.y).hide = true;
                            break;
                        case 'start-position':
                            nextPosition = sim.position = cmd.pos;
                            break;
                        case 'move':
                            // console.log("moving to", cmd.pos.x+","+cmd.pos.y);
                            nextPosition = cmd.pos;
                            resume = true;
                            break;
                        default:
                            break;
                    }
                }
                moveStart = millis();
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
            if (sim.levels[sim.level].colors) {
                sim.levels[sim.level].colors.forEach(function(c) {
                    setFill(c.hue);
                    rect(MARGIN+c.x*GRIDWIDTH+1,
                         MARGIN+c.y*GRIDWIDTH+1,
                         GRIDWIDTH-1, GRIDWIDTH-1);
                });
            }
        }
 
        var drawObstacles = function() {
            fill(154);
            sim.levels[sim.level].obstacles.forEach(function(o) {
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
            trashFound = sim.levels[sim.level].trash.list.length - sim.levels[sim.level].trash.count("hide", true);
            text("Green dots remaining: "+trashFound, 20, 10);
 
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
            sim.levels[sim.level].trash.list.filter(function(x) { return ! x.hide; }).forEach(ellipseAtLoc);
            drawCurrentPosition();
            if (sim.overlayText) {
              fill(255,128);
              rect(0,0,width,height);
              fill(238,0,0);
              textFont(fontA, 48);
              textAlign(CENTER);
              text(sim.overlayText, width/2, 150);
            }
        }
 
        draw = function() {
            if (runningUserCode) { return; }
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
    processingInstance = new Processing(canvas, sketchProc(userCode, controller.get('level'), 
      function(arg) {controller.runtimeErrorHandler(arg);}, 
      function(arg) {controller.levelUnlockHandler(arg);}));
  }

  window.ProcessingWrapper = {
    executeCode: executeCode
  }
})()
