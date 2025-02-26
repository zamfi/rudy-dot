import Interpreter from 'js-interpreter'
import acorn from 'js-interpreter/acorn'
import p5 from 'p5'
import {extra} from './util'
import {Scope} from './editor'
import {ExpressionDemonstrator} from './views'

class CodeRunner {
  constructor(code, evaluationDelay, parentElement, editor, stackView) {
    this.parentElement = parentElement;
    this.code = code;
    this.evaluationDelay = evaluationDelay;
    this.editor = editor;
    this.stackView = stackView;
    
    this.visibleScopes = [];
  }
    
  newSessionRunner(code, evaluationDelay, seed, eventHandler, parentElement) {
    return new SessionRunner(code, evaluationDelay, seed, eventHandler, parentElement);
  }
  
  //////////////////////////////
  //
  // Before & After Steps
  //
  //////////////////////////////
  preStepHandler() {
    if (this._beforeStepCallbacks) {
      let cbs = Array.from(this._beforeStepCallbacks);
      delete this._beforeStepCallbacks;
      cbs.forEach(cb => cb());
    }
  }
  
  postStepHandler() {
    if (this.activeExpressionDemonstrator) {
      this.activeExpressionDemonstrator.stepComplete();
    }
    if (this.stackView) {
      this.stackView.forceUpdate();
    }

    if (this._afterStepCallbacks) {
      let cbs = Array.from(this._afterStepCallbacks);
      delete this._afterStepCallbacks;
      cbs.forEach(cb => cb());
    }
  }
  
  runAfterStep(cb) {
    if (! this._afterStepCallbacks) {
      this._afterStepCallbacks = [];
    }
    this._afterStepCallbacks.push(cb);
  }
  runBeforeStep(cb) {
    if (! this._beforeStepCallbacks) {
      this._beforeStepCallbacks = [];
    }
    this._beforeStepCallbacks.push(cb);
  }
  
  //////////////////////////////
  //
  // Nodes being pushed and popped from the stack
  //
  //////////////////////////////
  
  static shouldTriggerExpressionDemonstrator(node) {
    let type = node.type;
    return ('start' in node) && (
      type === "BinaryExpression" || 
      type === "CallExpression" || 
      type === "UnaryExpression" || 
      type === "LogicalExpression" || 
      type === "UpdateExpression" ||
      type === "ConditionalExpression" ||
      type === "Identifier");
  }
  
  // static shouldMaintainExpressionDemonstrator(node) {
  //   return CodeRunner.shouldTriggerExpressionDemonstrator(node) || node.type === "Literal";
  // }
  
  static shouldPauseExpressionDemonstrator(node) {
    return node.type === "BlockStatement";
  }
  

  nodeEvaluationHandler(frame, stack) {
    // frame is not yet on the stack
    if (this.editor && this.editor.props.showExecution) {
      this.editor.highlightNode(frame, stack);
      let previousFrame = stack[stack.length-1];
      if (frame.node.type === "BlockStatement" && 
          ('start' in frame.node) && // i.e., is the block itself actually present in the code?
          previousFrame.node.type === "CallExpression") {
        // console.log("I think this is a call where we should check stuff", frame, previousFrame);
        // show the parent scope
        this.visibleScopes.push([this.editor.showFrameScope(frame)]);
      }
      if (CodeRunner.shouldTriggerExpressionDemonstrator(frame.node) && ! this.activeExpressionDemonstrator) {
        this.runAfterStep(() => {
          // frame will be on the stack already
          let elt = this.editor.createExpressionDemonstratorCallout(frame.node.start);
          this.activeExpressionDemonstrator = new ExpressionDemonstrator(this.code, stack, frame, elt);
          // console.log("Creating demonstrator", frame, this.activeExpressionDemonstrator);
          extra(frame).expressionDemonstrator = this.activeExpressionDemonstrator;
        });
      } else if (this.activeExpressionDemonstrator) {
        if (CodeRunner.shouldPauseExpressionDemonstrator(frame.node)) {
          // console.log("Pausing demonstrator", frame, this.activeExpressionDemonstrator);
          let demonstrator = this.activeExpressionDemonstrator;
          this.runAfterStep(() => {
            demonstrator.stepComplete();
          });
          delete this.activeExpressionDemonstrator;
        } else {
          extra(frame).expressionDemonstrator = this.activeExpressionDemonstrator;
          this.runAfterStep(() => {
            extra(frame).expressionDemonstrator.pushedFrame(frame);
          });
        }
      }
    }
    if (this.stackView) {
      this.stackView.addNode(frame);
    }
  }
  nodeEvaluationDoneHandler(frame, stack) {
    // frame is still on the stack
    if (this.editor && this.editor.props.showExecution) {
      this.editor.unhighlightNode(frame, stack);
      let previousFrame = stack[stack.length-2]; // frame is top of stack
      if (frame.node.type === "BlockStatement" && previousFrame.node.type === "CallExpression") {
        // call is done, remove it.
        this.visibleScopes.pop().forEach(s => s.remove());
      } else {
        this.visibleScopes.forEach(list => list.forEach(scope => scope.update()));
      }
      if (frame.node.type === "VariableDeclaration") {
        if (frame.scope.parentScope === null) {
          // global variable -- add a viewer for just this/these variable(s)!
          this.visibleScopes.push(this.editor.showGlobalVariables(frame));
        } else {
          this.visibleScopes[this.visibleScopes.length-1].push(...this.editor.showLocalVariables(frame));
        }
      }
      if (this.activeExpressionDemonstrator) {
        let demonstrator = this.activeExpressionDemonstrator;
        if (frame === demonstrator.rootFrame) {
          // console.log("Removing demonstrator", frame, this.activeExpressionDemonstrator);
          delete this.activeExpressionDemonstrator;
        }
        demonstrator.poppedFrame(frame); // frame is still on stack!
        this.runAfterStep(() => {
          if (frame === demonstrator.rootFrame) {
            // we're done. after the next step completes, update it. after that, remove it.
            demonstrator.stepComplete();
            this.runAfterStep(() => { // XXX: ugh. how many steps should it really wait for???
              this.runAfterStep(() => {
                demonstrator.remove();
                // console.log("demonstrator removed");
              });
            });
          }
        });
      }
      if (! this.activeExpressionDemonstrator && previousFrame && extra(previousFrame).expressionDemonstrator) {
        // console.log("recalling demonstrator", extra(previousFrame).expressionDemonstrator);
        this.activeExpressionDemonstrator = extra(previousFrame).expressionDemonstrator;
      }
    }
    if (this.stackView) {
      this.stackView.removeNode(frame);
    }
  }
  
  //////////////////////////////
  //
  // Other event handlers
  //
  //////////////////////////////
  
  
  runtimeErrorHandler(err, frame, stack) {
    if (this.editor) {
      this.editor.freezeErrors();
      let pos = this.editor.getNodePosition(frame.node);
      // console.log(frame.node);
      this.editor.createError("error", pos.line-1, pos.ch, `Runtime error: ${err.getMessage ? err.getMessage() : String(err)}`, true)
    }
  }
  
  stopHandler(interpreter) {
    let stack = interpreter.stateStack;
    stack.forEach(frame => {
      if (frame.node && frame.node.__extra && frame.node.__extra.marks) {
        frame.node.__extra.marks.forEach(m => m.clear());
      }
    });
    if (this.editor) {
      this.editor.clearFrameScopes();
      this.editor.clearExpressionDemonstrators();
    }
    if (this.stackView) {
      this.stackView.clear();
    }
  }
  
  //////////////////////////////
  //
  // Handling Execution
  //
  //////////////////////////////
  
  
  async prerunSamples() {
    // console.log("prerunSamples");
    let deadline = Date.now() + 750; // 3/4 of a second from now...
    var lastSeed;
    try {
      while (Date.now() < deadline) {
        lastSeed = await this.sampleExecution(deadline)
      }
    } catch (seed) {
      // console.log("Something failed?", seed, typeof seed, typeof seed === 'number');
      if (typeof seed === 'number') {
        lastSeed = seed;
      } else {
        return new Error(seed);
      }
    }
    return lastSeed;
  }
  
  sampleExecution(deadline) {
    return new Promise((resolve, reject) => {
      let seed = Date.now() + Math.floor(Math.random() * 10000000000);
      this.runner = this.newSessionRunner(this.code, 0, seed);
      this.runner.deadline = deadline;
      this.runner.run((success) => {
        if (success) {
          resolve(seed);
        } else {
          reject(seed);
        }
      });
    });
  }
  
  async run(doneCb, skipSampling) {
    var seed = Date.now() + Math.floor(Math.random() * 10000000000);
    if (! skipSampling) {
      seed = await this.prerunSamples()
      if (seed instanceof Error) {
        doneCb();
        return;
      }
    }
    while(this.parentElement.lastChild) {
      this.parentElement.removeChild(this.parentElement.lastChild);
    }
    this.runner = this.newSessionRunner(this.code, this.evaluationDelay, seed, this, this.parentElement);
    this.runner.run(doneCb);

    // XXX This is caused by a bug that only shows up in Safari where the canvas isn't made visible...
    if (this.parentElement.firstChild.dataset.hidden === 'true') {
      console.error("Showing because was still hidden #racecondition");
      this.parentElement.firstChild.style.visibility = '';
      delete this.parentElement.firstChild.dataset.hidden
    }
  }
  
  pause() {
    this.runner.pause();
  }
  
  resume() {
    this.runner.resume();
  }
  
  step() {
    this.runner.step();
  }
  
  stop() {
    this.runner.stop();
  }
  
  setEvaluationDelay(delay) {
    this.evaluationDelay = delay;
    if (this.runner) {
      this.runner.evaluationDelay = delay;
    }
  }
}

class RudyCodeRunner extends CodeRunner {
  constructor(code, level, evaluationDelay, parentElement, editor, stackView) {
    super(code, evaluationDelay, parentElement, editor, stackView);

    this.level = level;
  }
  
  newSessionRunner(code, evaluationDelay, seed, eventHandler, parentElement) {
    return new RudySessionRunner(code, evaluationDelay, seed, eventHandler, parentElement, this.level);
  }
}

class SketchCodeRunner extends CodeRunner {
  newSessionRunner(code, evaluationDelay, seed, eventHandler, parentElement) {
    return new SketchSessionRunner(code, evaluationDelay, seed, eventHandler, parentElement);
  }
}

class SessionRunner {
  constructor(code, evaluationDelay, randomSeed, eventHandler, drawIntoElement, ...otherArgs) {
    // console.log("session running drawing into", drawIntoElement);
    this.randomSeed = randomSeed;
    this.parentElement = drawIntoElement;
    this.evaluationDelay = evaluationDelay;
    this.eventHandler = eventHandler;

    if (this.preInit) {
      this.preInit(...otherArgs);
    }

    this.p5 = new p5((sketch) => this.p5init(sketch), drawIntoElement || document.createElement('div'), false); // use existing element, or fake one.

    this.interpreter = new Interpreter(code, (interpreter, scope) => this.postScopeInit(interpreter, scope))
    
    if (this.eventHandler) {
      this.interpreter.stateStack.addDelegate(this.eventHandler);
    }
    // console.log("Session Runner built");
  }
  
  runFunction(fn, cb) {
    // console.log("runFunction", fn);
    this.interpreter.ast = acorn.parse(`${fn}();`, Interpreter.PARSE_OPTIONS);
    delete this.interpreter.ast.start;
    delete this.interpreter.ast.end;
    delete this.interpreter.ast.body[0].start;
    delete this.interpreter.ast.body[0].end;
    delete this.interpreter.ast.body[0].expression.start;
    delete this.interpreter.ast.body[0].expression.end;
    delete this.interpreter.ast.body[0].expression.callee.start;
    delete this.interpreter.ast.body[0].expression.callee.end;

    // console.log("ast?", this.interpreter.ast);

    while (this.interpreter.stateStack.length) {
      this.interpreter.stateStack.pop();
    }
    var state = new Interpreter.State(this.interpreter.ast, this.interpreter.global);
    state.done = false;
    this.interpreter.stateStack.push(state);
    
    if (cb) {
      this.completionCb = cb;      
    }
    this.isRunningFunction = true;
    this.stepAndSchedule();
  }
  
  stepAndSchedule() {
    let repeatDeadline = Date.now() + 50; //ms
    for (;;) { // a loop that lets us continually step unless something happens.
      if (this.isFinished) {
        this.p5.noLoop();
        return;
      }
      if (this.isPaused) {
        return;
      }
      if (this.deadline && this.deadline < Date.now()) {
        // console.log("Execution timeout!");
        this.p5.noLoop();
        let stack = this.interpreter.stateStack;
        let topFrame = stack.top();
        this.passEvent("runtimeError", new Error("timeout"), topFrame, stack);
        this.passEvent("stop", this.interpreter);
        this.complete("timeout");
        return;
      }
      try {
        let result = this.step();
        if (result && ! this.isWaiting) {
          if (this.evaluationDelay > 0 || Date.now() > repeatDeadline) {
            setTimeout(this.stepAndSchedule.bind(this), this.evaluationDelay);
            return;
          }
          // return this.stepAndSchedule();
        } else {
          return;          
        }
      } catch (err) {
        // console.error(err);
        this.p5.noLoop();
        let stack = this.interpreter.stateStack;
        let topFrame = stack.top();
        console.error("runtimeError", err, topFrame, stack);
        this.passEvent("runtimeError", err, topFrame, stack);
        this.complete("runtime");
        this.passEvent("stop", this.interpreter);
        return;
      }
    }
  }
  
  pause() {
    this.isPaused = true;
  }
  
  resume() {
    delete this.isPaused;
    this.stepAndSchedule();
  }
  
  _preStep() {
    this.passEvent("preStep", this.interpreter);
  }
  
  _postStep() {
    this.passEvent("postStep", this.interpreter);
  }
  
  step() {
    this._preStep();

    // WOO, ACTUALLY RUN THE STEP!
    let result = this.interpreter.step();

    this._postStep();
    
    if (! result) {
      this.handleNoMoreCodeToRun();
    }
    return result;
  }
  
  handleNoMoreCodeToRun() {
    this.isFinished = true;
    this.p5.noLoop();
    this.complete();
    this.passEvent("stop", this.interpreter);    
  }
  
  stop() {
    this.isFinished = true;
    this.passEvent("stop", this.interpreter);
  }
  
  complete(status) {
    if (this.completionCb) {
      // console.log("completion?", status);
      this.completionCb(status)
      delete this.completionCb;
    }
  }
  
  run(cb) {
    // console.log('running!');
    this.completionCb = cb;
    this.stepAndSchedule();
  }
  
  wrapAsyncFunction(f) {
    return () => {
      this.isWaiting = true;
      let realArgs = Array.prototype.slice.call(arguments);
      realArgs.unshift(value => {
        let stack = this.interpreter.stateStack;
        stack[stack.length-1].value = value;
        this.isWaiting = false;
        this.stepAndSchedule();
      });
      f.apply(null, realArgs);
      return undefined
    }
  }
  
  createNamedNativeFunction(interpreter, f, name) {
    let nativeFunction = interpreter.createNativeFunction(f);
    nativeFunction.__name = name;
    return nativeFunction;
  }

  passEvent(name, arg1, arg2, etc) {
    let eventHandler = this.eventHandler;
    let realArgs = Array.prototype.slice.call(arguments, 1);
    if (eventHandler && eventHandler[name+"Handler"]) {
      eventHandler[name+"Handler"].apply(eventHandler, realArgs);
    } else {
      // console.log("no handler for event", name, realArgs);
    }
  }
}

const EVENT_FUNCTIONS = [
  'keyPressed', 
  'keyReleased', 
  'keyTyped',
  'mouseMoved',
  'mouseDragged',
  'mousePressed',
  'mouseReleased',
  'mouseClicked',
  'doubleClicked',
  'mouseWheel',
  'touchStarted',
  'touchMoved',
  'touchEnded'
];

class SketchSessionRunner extends SessionRunner {
  nativeToPseudo(interpreter, nativeObj, depth = 0) {
    if (depth > 30) {
      debugger;
    }
    if (typeof nativeObj === 'boolean' ||
        typeof nativeObj === 'number' ||
        typeof nativeObj === 'string' ||
        nativeObj === null || nativeObj === undefined) {
      return nativeObj;
    }

    if (nativeObj instanceof RegExp) {
      var pseudoRegexp = interpreter.createObjectProto(interpreter.REGEXP_PROTO);
      interpreter.populateRegExp(pseudoRegexp, nativeObj);
      return pseudoRegexp;
    }

    if (nativeObj instanceof Function) {
      let self = this;
      var wrapper = function() {
        return self.nativeToPseudo(interpreter,
          nativeObj.apply(interpreter,
            Array.prototype.slice.call(arguments)
            .map(function(i) {
              return interpreter.pseudoToNative(i);
            })
          ),
          depth+1
        );
      };
      return interpreter.createNativeFunction(wrapper, undefined);
    }

    var pseudoObj;
    if (Array.isArray(nativeObj)) {  // Array.
      pseudoObj = interpreter.createObjectProto(interpreter.ARRAY_PROTO);
      for (var i = 0; i < nativeObj.length; i++) {
        if (i in nativeObj) {
          let k = i;
          interpreter.setProperty(pseudoObj, k, ReferenceError, {
            get: interpreter.createNativeFunction(() => {
              return this.nativeToPseudo(interpreter, nativeObj[k], depth+1)
            })
          });
        }
      }
    } else {  // Object.
      pseudoObj = interpreter.createObjectProto(this.nativeToPseudo(interpreter, nativeObj.__proto__, depth+1));
      interpreter.setProperty(pseudoObj, 'constructor', this.nativeToPseudo(interpreter, nativeObj.constructor, depth+1));
      for (var key in nativeObj) {
        let k = key;
        if (nativeObj[k] instanceof Function) {
          interpreter.setProperty(
            pseudoObj, k, this.nativeToPseudo(interpreter, nativeObj[k], depth+1));
        } else {
          interpreter.setProperty(pseudoObj, k, ReferenceError, {
            get: interpreter.createNativeFunction(() => {
              return this.nativeToPseudo(interpreter, nativeObj[k], depth+1)
            })
          });
        }
      }
    }
    pseudoObj.__native = nativeObj;
    return pseudoObj;
  }
  
  pseudoToNative(interpreter, pseudoObj, depth = 0) {
    if (depth > 30) {
      debugger;
    }
    // console.log("pseudo-ify", interpreter, pseudoObj, depth);
    if (typeof pseudoObj === 'boolean' ||
        typeof pseudoObj === 'number' ||
        typeof pseudoObj === 'string' ||
        pseudoObj === null || pseudoObj === undefined) {
          // console.log("primitive type!", pseudoObj);
      return pseudoObj;
    }
    
    if (interpreter.isa(pseudoObj, interpreter.REGEXP)) {  // Regular expression.
      return pseudoObj.data;
    }
    
    if (interpreter.isa(pseudoObj, interpreter.FUNCTION)) {
      if (pseudoObj.nativeFunc) {
        return pseudoObj.nativeFunc;
      } else {
        debugger; // not supported yet.
      }
    }

    if (interpreter.isa(pseudoObj, interpreter.ARRAY)) {  // Array.
      var nativeArray = [];
      var i = 0;
      while (interpreter.hasProperty(pseudoObj, i)) {
        nativeArray[i] = this.pseudoToNative(interpreter, interpreter.getProperty(pseudoObj, i), depth+1);
        i++;
      }
      return nativeArray;
    }
    
    if (pseudoObj.__native) {
      // console.log("pseudo to native yields native object", pseudoObj, pseudoObj.__native);
      return pseudoObj.__native;
    }
    var self = this;
    return new Proxy(pseudoObj, {
      get: function(target, property) {
        let ret = self.pseudoToNative(interpreter, interpreter.getProperty(target, property), depth+1);
        console.log("get on", target, ".", property, "yields", ret);
        return ret;
      },
      set: function(target, property, value) {
        interpreter.setProperty(target, property, self.nativeToPseudo(interpreter, value, depth+1));
      },
      has: function(target, property) {
        return interpreter.hasProperty(target, property);
      },
      ownKeys: function(target) {
        return Object.keys(target.isObject ? target.properties : target);
      }
    });
  }
  
  postScopeInit(interpreter, scope) {
    // console.log('setting up scope for sketch');
    let alertFunction = function() {
      console.log(...Array.from(arguments));
      alert(Array.from(arguments).map(v => Scope.plainTextValue(v)).join(" "));
    };
    let logFunction = this.parentElement ? alertFunction : function() { };
    interpreter.setProperty(scope, 'alert', this.createNamedNativeFunction(interpreter, logFunction, 'alert'));
    // interpreter.setProperty(scope, 'first', this.createNamedNativeFunction(interpreter, 
    //   (arr) => this.nativeToPseudo(interpreter, this.pseudoToNative(interpreter, arr)[0]), 'first'));
    // interpreter.setProperty(scope, 'rest', this.createNamedNativeFunction(interpreter, 
    //   (arr) => this.nativeToPseudo(interpreter, this.pseudoToNative(interpreter, arr).slice(1)), 'rest'));
      
    let p5 = this.p5;
    Object.keys(p5.__proto__).filter(k => ! k.startsWith('_')).forEach(k => {
      let value = p5[k];
      if (typeof (value) === 'function') {
        let self = this;
        let wrappedFunction;
        if (k === 'print') {
          wrappedFunction = function() {
            let args = Array.from(arguments).map(self.pseudoToNative.bind(self, interpreter));
            console.print?.(...args);
            let result = value.call(p5, ...args);
            return result === p5 ? undefined : self.nativeToPseudo(interpreter, result);
          };
        } else {
          wrappedFunction = function() {
            let args = Array.from(arguments).map(self.pseudoToNative.bind(self, interpreter));
            // console.log("call to", k, "with args", args);
            let result = value.call(p5, ...args);
            // console.log(`${k}(`, args, `) yielded`, result, result === p5, self.nativeToPseudo(interpreter, result));
            return result === p5 ? undefined : self.nativeToPseudo(interpreter, result);
          };          
        }
        interpreter.setProperty(scope, k, this.createNamedNativeFunction(interpreter, wrappedFunction, k));
      } else {
        interpreter.setProperty(scope, k, ReferenceError, {
          get: interpreter.createNativeFunction(() => {
            let result = p5[k]
            // console.log(`p5.${k} yielded`, result);
            return this.nativeToPseudo(interpreter, result);
          })
        });
      }
      // console.log(`made ${k}`);
    });
  }
  
  p5init(p5) {
    // console.log('setting up p5 for sketch', p5);
    p5.setup = () => {
      // console.log('running setup!', p5);
      if (this.randomSeed) {
        p5.randomSeed(this.randomSeed)
      }
      if (this.parentElement) {
        p5.createCanvas(340, 340);
        p5.background(238);
      }
    }
    
    p5.draw = () => {
      this.eventTriggered('draw');
    }
    
    EVENT_FUNCTIONS.forEach(k => {
      if (k === 'mouseClicked' || k === 'mousePressed' || k === 'touchStarted') {
        p5[k] = event => {
          // console.log(event.target.constructor === HTMLCanvasElement);
          if (event.target.constructor === HTMLCanvasElement) {
            this.eventTriggered(k);
          }
        } 
      } else {
        p5[k] = () => this.eventTriggered(k);
      }
    });   
  }
  
  eventTriggered(eventName) {
    if (! this.readyForEvents) {
      return;
    }
    // console.log("triggered", eventName);
    if (! this.nextEvents) {
      this.nextEvents = [];
    }
    if (! this.nextEvents.includes(eventName)) {
      this.nextEvents.push(eventName);
      // console.log("adding", eventName);
    }
    if (! this.isRunningFunction) {
      this.runNextEvent();
    }
  }
  
  runNextEvent() { // this is probably where we should construct the new graphics context.
    // maybe start by drawing the existing image onto the new one?
    if (this.parentElement && this.nextEvents && this.nextEvents.length > 0) {
      let next = this.nextEvents.shift();
      if (this.interpreter && this.interpreter.hasProperty(this.interpreter.global, next)) {
        // console.log("will run", next);
        this.isRunningFunction = true;
        setTimeout(() => this.runFunction(next), 0);
      } else {
        // console.log("not running", next, this.interpreter && this.interpreter.hasProperty(this.interpreter.global, next));
      }
    }    
  }
  
  handleNoMoreCodeToRun() { // this is probably where we should flush it to the earlier canvas
    this.readyForEvents = true;
    this.isRunningFunction = false;    
    if (this.parentElement && this.interpreter.hasProperty(this.interpreter.global, 'setup') && ! this.hasRunSetup) {
      this.hasRunSetup = true;
      this.runFunction('setup')
    } else if (this.parentElement && this.interpreter.hasProperty(this.interpreter.global, 'draw') && this.p5._loop) {
      this.runNextEvent();
    } else if (this.parentElement && this.p5._loop && 
        EVENT_FUNCTIONS.some(k => this.interpreter.hasProperty(this.interpreter.global, k))) {
      setTimeout(() => this.runNextEvent(), 100);
    } else {
      // console.log("Really done!");
      this.isFinished = true;
      this.p5.noLoop();
      this.complete();
      this.passEvent("stop", this.interpreter);
    }
  }
}

class RudySessionRunner extends SessionRunner {  
  preInit(level) {
    this.startLevel = level;
    
    this.allHues = {
      "red": {r: 255, g: 220, b: 220},
      "blue": {r: 150, g: 200, b: 255},
      "green": {r: 200, g: 255, b: 200},
      "yellow": {r: 255, g: 255, b: 200},
      false: {r: 255, g: 255, b: 255}
    };
  }

  postScopeInit(interpreter, scope) {
    let alertFunction = function() {
      console.log(...Array.from(arguments));
      alert(Array.from(arguments).map(v => Scope.plainTextValue(v)).join(" "));
    };
    let logFunction = this.parentElement ? alertFunction : function() {};
    interpreter.setProperty(scope, 'alert', this.createNamedNativeFunction(interpreter, logFunction, 'alert'));
    ['getColor', 'setColor', 'remainingDots'].forEach(name => 
      interpreter.setProperty(scope, name, this.createNamedNativeFunction(interpreter, this[name].bind(this), name))
    );
    ['down', 'up', 'left', 'right'].forEach(name =>
      interpreter.setProperty(scope, name, this.createNamedNativeFunction(interpreter, this.wrapAsyncFunction(this[name].bind(this)), name))
    );
  }
  

  getColor() {
    if (! this.level.colors) { return false; }
    var c = this.level.colors.contains(this.position.x, this.position.y);
    var returnValue = c ? c.hue : false;
    // console.log("coloring(", position.x, ",", position.y, ") = ", returnValue);
    return returnValue;    
  }
  
  setColor(hue) {
    if (hue === undefined || ! this.allHues[hue]) {
      throw new Error("setColor(color) requires one argument, a color, such as returned by the getColor() function.");
    }
    if (! this.level.colors) {
      this.level.colors = new PositionSet([]);
    }
    var pos = this.level.colors.contains(this.position.x, this.position.y);
    if (pos) {
      pos.hue = hue;
    } else {
      this.level.colors.push({
        x: this.position.x,
        y: this.position.y,
        hue: hue
      });
    }
  }
  
  remainingDots() {
    return this.level ? this.level.dots.list.length - this.level.dots.count("found", true) : 0;
  }
  
  createSimCommands(p5) {
    const GRIDWIDTH = this.level.GRIDWIDTH === undefined ? 30 : this.level.GRIDWIDTH;
    const MARGIN    = this.level.MARGIN    === undefined ? 20 : this.level.MARGIN;
    const CELLROWS  = this.level.CELLROWS  === undefined ? 10 : this.level.CELLROWS;
    const CELLCOLS  = this.level.CELLCOLS  === undefined ? 10 : this.level.CELLCOLS;

    let setFill = (hue) => {
      var c = this.allHues[hue];
      if (c) {
        p5.fill(c.r, c.g, c.b);
      }
    };

    let drawColors = () => {
      if (this.level.colors) {
        this.level.colors.forEach((c) => {
          setFill(c.hue);
          p5.rect(MARGIN+c.x*GRIDWIDTH,
                  MARGIN+c.y*GRIDWIDTH,
                  GRIDWIDTH, GRIDWIDTH);
        });
      }
    };

    let drawObstacles = () => {
      p5.fill(154);
      this.level.obstacles.forEach((o) => {
        p5.rect(MARGIN+o.x*GRIDWIDTH,
                MARGIN+o.y*GRIDWIDTH,
                GRIDWIDTH, GRIDWIDTH);
      });
    };

    let drawGates = () => {
      if (this.level.gates) {
        this.level.gates.forEach(gate => {
          gate.forEach(set => {
            set.borders().forEach(border => {
              p5.fill(154);
              if ((this.level.colors.contains(border.from.x, border.from.y) || {}).hue !==
                  (this.level.colors.contains(border.to.x, border.to.y) || {}).hue) {
                // gate is closed!
                if (border.to.x > border.from.x) {
                  // vertical gate
                  p5.rect(MARGIN+border.to.x*GRIDWIDTH-GRIDWIDTH/20,
                          MARGIN+border.to.y*GRIDWIDTH,
                          GRIDWIDTH/10, GRIDWIDTH);
                } else {
                  // horizontal gate
                  p5.rect(MARGIN+border.to.x*GRIDWIDTH,
                          MARGIN+border.yo.y*GRIDWIDTH-GRIDWIDTH/20,
                          GRIDWIDTH, GRIDWIDTH/10);
                }
              } else {
                // gate is open!
                if (border.to.x > border.from.x) {
                  // vertical gate
                  p5.rect(MARGIN+border.to.x*GRIDWIDTH-GRIDWIDTH/20,
                          MARGIN+border.to.y*GRIDWIDTH,
                          GRIDWIDTH/10, GRIDWIDTH/6);
                  p5.rect(MARGIN+border.to.x*GRIDWIDTH-GRIDWIDTH/20,
                          MARGIN+border.to.y*GRIDWIDTH+5*GRIDWIDTH/6,
                          GRIDWIDTH/10, GRIDWIDTH/6);
                } else {
                  // horizontal gate
                  p5.rect(MARGIN+border.to.x*GRIDWIDTH,
                          MARGIN+border.yo.y*GRIDWIDTH-GRIDWIDTH/20,
                          GRIDWIDTH/6, GRIDWIDTH/10);
                  p5.rect(MARGIN+border.to.x*GRIDWIDTH+5*GRIDWIDTH/6,
                          MARGIN+border.yo.y*GRIDWIDTH-GRIDWIDTH/20,
                          GRIDWIDTH/6, GRIDWIDTH/10);
                }
              }
            });
          });
        });
      }
    };

    let ellipseAtLoc = (loc) => {
      p5.ellipse(MARGIN+(loc.x+0.5)*GRIDWIDTH, MARGIN+(loc.y+0.5)*GRIDWIDTH, GRIDWIDTH/2, GRIDWIDTH/2);
    }

    const MOVETIME = this.level.MOVETIME === undefined ? 200 : this.level.MOVETIME;
    let moveStart = -MOVETIME;
    var moveFinishedCb;
    var overlayText = null;
    
    let runCommand = (op, cb) => {
      // console.log("running command:", op);
      let newPos = applyCommand(op);
      if (newPos) {
        this.nextPosition = newPos;
        moveStart = p5.millis();
        moveFinishedCb = () => {
          if (this.nextPosition && ! this.nextPosition.failed) {
            this.position = this.nextPosition;
            let dot = this.level.dots.contains(this.position.x, this.position.y);
            if (dot) {
              dot.found = true;
            }
            if (this.remainingDots() === 0) {
              this.complete(true);
              if (this.parentElement && this.level < this.levels().length) {
                this.passEvent("levelCompleted", this.startLevel);
              }
              overlayText = "LEVEL "+(this.startLevel)+"\nCLEARED";
            }
          }
          this.nextPosition = null;
          moveFinishedCb = null;
          cb();
        }
        if (! this.parentElement) {
          moveFinishedCb();
        }
      } else {
        if (! this.parentElement || MOVETIME === 0) {
          cb();
        } else {
          setTimeout(cb, MOVETIME);
        }
      }
    }
    let applyCommand = (command) => {
      var np = null;
      switch(command) {
        case 'right':
          np = {x: this.position.x+1, y: this.position.y};
          break;
        case 'left':
          np = {x: this.position.x-1, y: this.position.y};
          break;
        case 'up':
          np = {x: this.position.x, y: this.position.y-1};
          break;
        case 'down':
          np = {x: this.position.x, y: this.position.y+1};
          break;
        default:
          p5.print("unknown command: "+command);
      }
      if (! np) { return false; }
      if (this.level.obstacles.contains(np.x, np.y) ||
          np.x < 0 || np.y < 0 || np.x > (CELLCOLS-1) || np.y > (CELLROWS-1) ||
          (this.level.gates && this.level.gates.some((gate) => {
            if (! this.level.colors) { return false; }
            let gates = gate.gatesAt(this.position.x, this.position.y);
            if (! gates) {
              return false;
            }
            return gates.contains(np.x, np.y) &&
              (this.level.colors.contains(this.position.x, this.position.y) || {}).hue !== (this.level.colors.contains(np.x, np.y) || {}).hue;
          }))) {
        np.failed = true;
      }
      return np;
    }
    let drawCurrentPosition = () => {
      let p = this.position;
      p5.fill(238, 0, 0); // red
      let stepFraction = MOVETIME === 0 ? 1 : Math.min(MOVETIME, p5.millis()-moveStart)/MOVETIME;
      if (this.nextPosition && ! this.nextPosition.failed) {
        let np = this.nextPosition;
        ellipseAtLoc({
          x: p.x+(np.x-p.x)*stepFraction,
          y: p.y+(np.y-p.y)*stepFraction
        });
      } else if (this.nextPosition && this.nextPosition.failed) {
        let np = this.nextPosition;
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
        ellipseAtLoc(this.position);
      }
    }
    let updatePosition = () => {
      if (p5.millis()-moveStart > MOVETIME && moveFinishedCb) {
        moveFinishedCb();
      }
    }


    let simRedraw = () => {
      p5.background(255);

      p5.fill(238, 0, 0); // red
      p5.textFont("Courier New", 12);
      p5.textAlign(p5.LEFT);
      p5.text("Green dots remaining: "+this.remainingDots(), 20, 10);

      p5.noStroke();
      drawColors();
      if (this.level.strokeFn) {
        this.level.strokeFn(p5);
      } else {
        p5.stroke(204);        
      }
      for (let i = 0; i <= CELLCOLS+1; ++i) {
        p5.line(MARGIN+i*GRIDWIDTH, MARGIN, MARGIN+i*GRIDWIDTH, p5.height-MARGIN);
      }
      for (let i = 0; i <= CELLROWS+1; ++i) {
        p5.line(MARGIN, MARGIN+i*GRIDWIDTH, p5.width-MARGIN, i*GRIDWIDTH+MARGIN);
      }
      p5.noStroke();
      drawObstacles();
      drawGates();
      p5.fill(0, 238, 0); // green
      this.level.dots.list.filter(x => ! x.found).forEach(ellipseAtLoc);
      drawCurrentPosition();
      if (overlayText) {
        p5.fill(255,128);
        p5.rect(0,0,p5.width,p5.height);
        p5.fill(238,0,0);
        p5.textFont("Courier New", 48);
        p5.textAlign(p5.CENTER);
        p5.text(overlayText, p5.width/2, 150);
      }
    }
    
    this.left = (cb) => {
      runCommand('left', cb);
    }
    this.right = (cb) => {
      runCommand('right', cb);
    }
    this.up = (cb) => {
      runCommand('up', cb);
    }
    this.down = (cb) => {
      runCommand('down', cb);
    }
    
    return () => {
      updatePosition()
      if (this.parentElement) {
        simRedraw()
      }
    };
  }
  
  p5init(p5) {
    this.setLevel(p5, this.startLevel);
    p5.setup = () => {
      if (this.randomSeed) {
        p5.randomSeed(this.randomSeed)
      }
      if (this.parentElement) {
        p5.createCanvas(340, 340);
        p5.background(255);
      }
    }
    p5.draw = this.createSimCommands(p5);
  }
  
  setLevel(p5, i) {
    this.level = this.levels(p5)[i-1]();
    this.position = this.level.start || {x: 0, y: 0};
  }
  
  levels(p5) {
    if (! this._levels) {
      // let p5 = this.p5
      this._levels = (function() {
        function levelRoundTheFence() {
          return {
            dots: new PositionSet([ {x: 5, y: 5}, {x: 7, y: 5} ]),
            obstacles: PositionSet.makeRectangle(2, 0, 1, 7)
          };
        }

        function levelAnObstacleCourse() {
          return {
            dots: new PositionSet([ {x: 5, y: 5}, {x: 5, y: 7}]),
            obstacles: PositionSet.makeRectangle(2, 0, 1, 6).concat(PositionSet.makeRectangle(4, 5, 1, 5))
          };
        }

        function levelThroughTheGate() {
          var hue = ['red', 'blue', 'green', 'yellow'][Math.floor(p5.random()*4)];
          return {
            dots: new PositionSet([ {x: 4, y: 4 } ]),
            obstacles: PositionSet.makeRectangle(3,0,1,5).concat(PositionSet.makeRectangle(3,6,1,4)),
            gates: [new GateSet([PositionSet.makeRectangle(2, 5, 2, 1)])],
            colors: new PositionSet([ {x: 3, y: 5, hue: hue }, {x: 0, y:2, hue: hue } ])
          };
        }

        function levelThroughTwoGates() {
          var randomIndex = Math.floor(p5.random()*4);
          var hue1 = ['red', 'blue', 'green', 'yellow'][randomIndex];
          var hue2 = ['blue', 'green', 'yellow', 'red'][randomIndex];
          return {
            dots: new PositionSet([{x: 3, y: 5}, {x: 6, y: 5}]),
            obstacles: PositionSet.makeRectangle(2, 3, 7, 1).concat(PositionSet.makeRectangle(2, 7, 7, 1)).concat(PositionSet.makeRectangle(8, 4, 1, 3))
                       .concat(new PositionSet([{x: 2, y: 4}, {x: 5, y: 4}, {x: 2, y: 6}, {x: 5, y: 6}])),
            gates: [new GateSet([PositionSet.makeRectangle(1, 5, 2, 1)]), new GateSet([PositionSet.makeRectangle(4, 5, 2, 1)])],
            colors: new PositionSet([ {x: 2, y: 5, hue: hue1}, {x: 1, y: 4, hue: hue1}, {x: 5, y: 5, hue: hue2}, {x: 4, y: 4, hue: hue2}])
          };
        }

        function levelGateSequence() {
          var hues = [];
          for (let i = 0; i < 8; ++i) {
            hues.push(['red', 'blue', 'green', 'yellow'][Math.floor(p5.random()*4)]);
          }
          var obstacles = PositionSet.makeRectangle(1,0,1,9);
          for (let i = 0; i < 7; ++i) {
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
              return new GateSet([PositionSet.makeRectangle(index+1,9-index,2,1)]);
            }),
            colors: new PositionSet(hues.map(function(hue, index) {
              return { x: index+2, y: 9-index, hue: hue }
            })).concat(new PositionSet(hues.map(function(hue, index) {
              return { x: 0, y: index+1, hue: hue }
            })))
          }
        }

        function levelDownUpDownUpDown() {
          return {
            dots: new PositionSet([ {x: 9, y: 8 } ]),
            obstacles: PositionSet.makeRectangle(1,0,1,8).concat(PositionSet.makeRectangle(3,2,1,8)).concat(PositionSet.makeRectangle(5,0,1,8)).concat(PositionSet.makeRectangle(7,2,1,8)).concat(PositionSet.makeRectangle(9,0,1,8))
          };
        }

        function levelUpOrDown() {
          var holes = [5];
          for (let i = 1; i <= 3; ++i) {
              holes.push(holes[i-1]+(p5.random()<0.5 ? -1 : 1));
          }
          var start = 1;
          var obstacles = new PositionSet([]);
          var colors = new PositionSet([]);
          for (let i = 0; i < holes.length; ++i) {
            obstacles = obstacles
              .concat(PositionSet.makeRectangle(start+i*2, 0, 1, holes[i]))
              .concat(PositionSet.makeRectangle(start+i*2, holes[i]+1, 1, (9-holes[i])));
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

        function levelOutOfTheBox() {
          var path = [p5.random() < 0.5, p5.random() < 0.5];
          return {
            start: {x: 3, y: 4},
            dots: new PositionSet([ {x: path[1] ? 3 : 5, y: path[0] ? 0 : 8 }]),
            obstacles: PositionSet.makeRectangle(2, 2, 1, 5).concat(PositionSet.makeRectangle(6, 2, 1, 5))
              .concat(PositionSet.makeRectangle(0, 4, 2, 1)).concat(PositionSet.makeRectangle(7, 4, 3, 1))
              .concat(new PositionSet([{x: 3, y: 2}, {x: 5, y: 2}, {x: 3, y: 6}, {x: 5, y: 6}, {x: 4, y: 0}, {x: 4, y: 8}, {x: 4, y: 9}])),
            colors: new PositionSet([ {x: 4, y: 4, hue: path[0] ? "red" : "blue" },
                                      {x: 4, y: path[0] ? 1 : 7, hue: path[1] ? "red" : "blue" }])
          }
        }

        function levelRedsTheMark() {
          var holes = [
              Math.floor(p5.random()*5+5),
              Math.floor(p5.random()*5),
              Math.floor(p5.random()*5+5),
              Math.floor(p5.random()*5)
          ];
          var start = 1;
          var obstacles = new PositionSet([]);
          var colors = new PositionSet([{x:8, y:9, hue:"red"}]);
          for (let i = 0; i < holes.length; ++i) {
              obstacles = obstacles
                  .concat(PositionSet.makeRectangle(start+i*2, 0, 1, holes[i]))
                  .concat(PositionSet.makeRectangle(start+i*2, holes[i]+1, 1, (9-holes[i])));
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

        function levelFollowTheColors() {
          function sum(p1, p2) {
            return {x: p1.x + p2.x, y: p1.y + p2.y};
          }
          // function s(p) { return "("+p.x+","+p.y+")"; }
          var obstacles = new PositionSet([]);
          var pos = {x: 0, y: 0};
          var attempts = 40;
          var colors = new PositionSet([]);
          var passedOver = new PositionSet([pos]);
          var lastNextPos = {x: 9, y: 9};
          var lastDirection;
          while (attempts-- > 0) {
            var dIndex = Math.floor(p5.random()*4);
            var direction = [{x: -1, y: 0}, {x: 0, y: -1}, {x: 1, y: 0}, {x: 0, y: 1}][dIndex];
            if (dIndex === lastDirection) {
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
            for (let i = 0; i < Math.floor(p5.random()*9); ++i) {
              nextPos = sum(nextPos, direction);
              if (nextPos.x < 0 || nextPos.x > 9 || nextPos.y < 0 || nextPos.y > 9) {
                break;
              }
              if (passedOver.contains(nextPos.x, nextPos.y)) {
                break;
              }
              if (p5.random() < 0.25) {
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
          for (let i = 0; i < 10; ++i) {
            for (let j = 0; j < 10; ++j) {
              if (p5.random() < .75 &&
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
        
        function levelFreePlay() {
          return {
            MOVETIME: 0,
            GRIDWIDTH: 3,
            CELLROWS: 100,
            CELLCOLS: 100,
            dots: new PositionSet([ { x:99, y: 99 } ]),
            obstacles: new PositionSet([]),
            strokeFn: (p5) => p5.noStroke()
          };
        }
        
        return [
          levelRoundTheFence,
          levelAnObstacleCourse,
          levelThroughTheGate,
          levelThroughTwoGates,
          levelUpOrDown,
          levelOutOfTheBox,
          levelRedsTheMark,
          levelDownUpDownUpDown,
          levelFreePlay,
          levelGateSequence,
          levelFollowTheColors,
        ];
      })();
    }
    return this._levels;
  }
}

class PositionSet {
  constructor(list, grid) {
    var posRegex = new RegExp("(\\d+),(\\d)");
    if (list && ! grid) {
        grid = {};
        list.forEach(function(pos) {
            grid[pos.x+","+pos.y] = pos;
        });
    }
    if (grid && ! list) {
        list = [];
        for (let k in grid) {
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

  contains(x, y) {
    return this.grid[x+","+y];
  }
  count(property, value) {
    return this.list.filter(function(x) { return x[property] === value; }).length;
  }
  push(pos) {
    this.list.push(pos);
    this.grid[pos.x+","+pos.y] = pos;
  }
  concat(positionSet) {
    return new PositionSet(this.list.concat(positionSet.list));
  }
  forEach(f) {
    return this.list.forEach(f, this);
  }
  borders() {
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
  
  static makeRectangle(x, y, width, height) {
    var out = [];
    for (let i = 0; i < width; ++i) {
      for (let j = 0; j < height; ++j) {
        out.push({x: x+i, y: y+j});
      }
    }
    return new PositionSet(out);
  }
}

class GateSet {
  constructor(list) {
    var grid = {};
    list.forEach(function(posSet) {
      posSet.forEach(function(pos) {
        var key = pos.x+","+pos.y;
        posSet.forEach(function(otherPos) {
          if (pos !== otherPos) {
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
  
  gatesAt(x, y) {
    return this.grid[x+","+y];
  }
  concat(gateSet) {
    return new GateSet(this.list.concat(gateSet.list));
  }
  forEach(f) {
    return this.list.forEach(f);
  }
}

export default CodeRunner
export {RudyCodeRunner, CodeRunner, SketchCodeRunner}