window.JSEvaluator = Em.Namespace.create({});

JSEvaluator.Util = Em.Object.create({
  asyncForEach: function(arr, each_cb, done_cb, thisPtr) {
    var i = 0;

    function doNextCb(err, val) {
      if (err) {
        return done_cb.call(thisPtr, err, val);
      }
      i += 1;
      if (i >= arr.length) {
        return done_cb.call(thisPtr, null, val);
      }
      each_cb.call(thisPtr, arr[i], i, doNextCb);
    }
    if (arr.length > 0) {
      each_cb.call(thisPtr, arr[i], i, doNextCb);
    } else {
      done_cb.call(thisPtr, null, undefined);
    }
  }
});

JSEvaluator.Scope = Em.Object.extend({
  interpreter: function() {
    return this.get('parent.interpreter');
  }.property('parent', 'parent.interpreter'),
  parent: null,
  variables: null,
  definedVariables: null,
  subScope: function() {
    return JSEvaluator.Scope.create({
      parent: this,
      id: this.get('interpreter').incrementProperty('nextScopeId')
    });
  },
  declareValue: function(name, value) {
    this.get('variables').set(name, value);
    this.get('definedVariables').pushObject(name);

    this.get('interpreter').noteEvent('declareValue', this, name, value);
    // console.log("declaring variable", name, "with initial value", value);
  },
  updateValue: function(name, value) {
    if (this.get('definedVariables').contains(name) || ! this.get('parent')) {
      this.get('variables').set(name, value);
      this.get('definedVariables').pushObject(name);

      this.get('interpreter').noteEvent('updateValue', this, name, value);
    } else {
      this.get('parent').updateValue(name, value);
    }
  },
  getBuiltIn: function(name) {
    var interpreter = this.get('interpreter');
    // console.log("seeking otherwise undefined name", name, "in global scope");
    if (name in interpreter.get('builtIns')) {
      // console.log("...it exists, and...")
      var val = interpreter.get('builtIns')[name];
      switch (val.type) {
        case 'async-function': 
          val = interpreter.wrapExternalFunction(val.underlying, name, true);
          break;
        case 'sync-function':
          val = interpreter.wrapExternalFunction(val.underlying, name);
          break;
        case 'object':
          val = interpreter.newObject(val.underlying);
          break;
        default:
          val = val.underlying;
          break;
      }
      this.declareValue(name, val);
      return val;
    } else {
      return undefined;          
    }    
  },
  getValue: function(name) {
    if (this.get('definedVariables').contains(name)) {
      return this.get('variables').get(name);
    } else if (this.get('parent')) {
      return this.get('parent').getValue(name);
    } else {
      return this.getBuiltIn(name);
    }
  },
  init: function() {
    this._super();
    if (! this.get('interpreter')) {
      throw new Error('Attempted to create a scope without an interpreter...');
    }
    this.set('variables', Em.Object.create()); // no variables set initially...
    this.set('definedVariables', []);
    this.get('interpreter').noteEvent('createScope', this);
  }
});

JSEvaluator.Object = Em.Object.extend({
  id: Em.required(),
  underlying: null,
  
  init: function() {
    this._super();
    // console.log("creating object with id", this.get('id'));
  },
  assign: function(key, value) {
    this.get('underlying')[key] = value;
    return value;
  },
  retrieve: function(key) {
    return this.get('underlying')[key];
  }
});

JSEvaluator.Function = JSEvaluator.Object.extend({
  declarationScope: Em.required(),
  name: Em.required(),
  bodyNodes: Em.required(),
  argumentNames: Em.required(),
    
  call: function(thisPtr, args, cb, callNode) {
    var scope = this.get('declarationScope').subScope();
    scope.declareValue('this', thisPtr);
    var argNames = this.get('argumentNames').mapProperty('name');
    for (var i = 0; i < Math.min(args.length, argNames.length); ++i) {
      scope.declareValue(argNames[i], args[i]);
    }
    var interpreter = this.get('declarationScope.interpreter');
    var callId = interpreter.incrementProperty('functionCallId');
    interpreter.noteEvent('functionCall', {
      id: callId,
      name: this.get('name'),
      scope: scope,
      functionObject: this,
      callNode: callNode
    });
    this.get('declarationScope.interpreter').evaluateBlock(this.get('bodyNodes'), scope, function(err, val) {
      interpreter.noteEvent('functionCallDone', callId, err, val);
      if (err === 'return') {
        // console.log("return statement!", err, val);
        // swallow a return 'error' created by the return statement.
        cb(null, val);
      } else {
        cb(err); // no return statement, no returned value...
      }
    });
  },
  init: function() {
    this._super();
    this.set('underlying', {});
  }
});

JSEvaluator.Interpreter = Em.Object.extend({
  builtIns: null,
  nextObjectId: 0,
  assert: function(expr, value) {
    if (expr != value) {
      throw new Error("Assertion failed: expected "+value+" was "+expr);
    }
  },
  wrapExternalFunction: function(f, name, async) {
    return JSEvaluator.Function.create({
      id: this.incrementProperty('nextObjectId'),
      name: name,
      call: (async ? 
        function(thisPtr, args, cb) {
          try {
            args.unshift(function(err, val) {
              // console.log("returning call from external function", name, "with args", args, "with value", err, val);
              cb(err, val);
            });
            f.apply(thisPtr, args);
          } catch (e) {
            cb(e);
          }
        } 
        :
        function(thisPtr, args, cb) {
          try {
            var ret = f.apply(thisPtr, args);
            // console.log("calling external function", name, "with args", args, "returning", ret);
            cb(null, ret);
          } catch (e) {
            cb(e);
          }
        })
    });
  },
  createFunction: function(parserNode, scope) {
    var c = parserNode.children;
    this.assert(c[0].text(), 'function'); // just checking...
    var name = c[1]._type == 'IDENTIFIER' ? c[1].text() : null;
    this.assert(c[2].text(), '(');
    var i = 3;
    var argumentNames = [];
    while (c[i].text() != ')') { // "function foo(a,b,c,)" with trailing , in argument list should be caught by parser, right...?
      argumentNames.push({name: c[i].text(), pos: this.convertPositionToLineCh(this.getNodePosition(c[i])) });
      if (c[i+1].text() == ',') {
        i += 2;
      } else {
        i++;
      }
    }
    this.assert(c[i].text(), ')'); i++;
    if (c[i]._text == '{') {
      i++;
    }
    var bodyNodes = c.slice(i, c[c.length-1]._text == '}' ? c.length-1 : c.length);
    return JSEvaluator.Function.create({
      id: this.incrementProperty('nextObjectId'),
      declarationScope: scope,
      name: name,
      argumentNames: argumentNames,
      bodyNodes: bodyNodes
    });
  },
  newObject: function(underlying) {
    return JSEvaluator.Object.create({
      id: this.incrementProperty('nextObjectId'),
      underlying: underlying
    });
  },
  evaluateExpression: function(parserNode, scope, cb) {
    var c = parserNode.children;
    this.assert(c[1].text(), ';')
    this.evaluate(c[0], scope, cb);
  },
  getBaseAndKey: function(parserNode, scope, cb) {
    var c = parserNode.children;
    var bk;
    switch (parserNode.name) {
      case 'dot':
        var baseNode = c[0];
        this.assert(c[1].text(), '.');
        var key = c[2].text();
        this.evaluate(baseNode, scope, function(err, baseVal) {
          if (err) { return cb.call(this, err, baseVal); }
          if (typeof(baseVal) !== 'object') {
            return cb.call(this, new Error("'"+baseVal+"' is not an object"));
          }
          cb.call(this, null, {
            base: baseVal,
            key: key,
            value: baseVal.retrieve(key)
          });
        });
        break;
      case 'bracket':
        var baseNode = c[0];
        this.assert(c[1].text(), '[');
        var key = c[2];
        this.assert(c[3].text(), ']');
        this.evaluate(baseNode, scope, function(err, baseVal) {
          if (err) { return cb.call(this, err, baseVal); }
          if (typeof(baseVal) !== 'object') {
            return cb.call(this, new Error("'"+baseVal+"' is not an object"));
          }
          this.evaluate(key, scope, function(err, keyVal) {
            if (err) { return cb.call(this, err, baseVal); }
            cb.call(this, null, {
              base: baseVal, 
              key: keyVal,
              value: baseVal.retrieve(keyVal)
            });
          })
        });
        break;
      default:
        cb.call(this, new Error("Unknown node type "+parserNode.name+" to get base and key from."));
    }
  },
  evaluateCall: function(parserNode, scope, cb) {
    var c = parserNode.children;
    var functionNode = c[0];
    switch (functionNode.name) {
      case 'dot':
      case 'bracket':
        this.getBaseAndKey(functionNode, scope, function(err, bk) {
          if (err) { return cb(err, bk); }
          withFunction.call(this, bk.base, bk.value);
        });
        break;
      case 'identifier':
        this.evaluate(functionNode, scope, function(err, val) {
          if (err) { return cb(err, val); }
          withFunction.call(this, null, val);
        });
        break;
      default:
        cb(new Error("not sure how to call functionNode"+functionNode.name));
    }
    function withFunction(thisPtr, f) {
      this.assert(c[1].text(), '(');
      var i = 2;
      var args = [];
      while (c[i]._text != ')') {
        args.push(c[i]);
        if (c[i+1].text() == ',') {
          i += 2;
        } else {
          i++;
        }
      }
      var evaluatedArgs = [];
      JSEvaluator.Util.asyncForEach(args, function(argNode, index, cb) {
        // console.log("evaluating arg at index", index);
        this.evaluate(argNode, scope, function(err, val) {
          if (err) { return cb(err, val); }
          // console.log("...is", val);
          evaluatedArgs[index] = val;
          cb();
        });
      }, function(err, val) {
        if (err) { return cb(err, val); }
        // console.log("now calling function", f.get('name'));
        f.call(thisPtr, evaluatedArgs, cb, parserNode);
      }, this);
    }    
  },
  evaluateReturn: function(parserNode, scope, cb) {
    var c = parserNode.children;
    this.assert(c[0].text(), 'return');
    if (c.length == 2) { // return;
      // console.log("naked return");
      return cb('return');
    }
    this.evaluate(c[1], scope, function(err, val) {
      if (err) {
        return cb(err, val);
      }
      // console.log("return with value", val);
      cb('return', val);
    });
  },
  evaluateDot: function(parserNode, scope, cb) {
    this.getBaseAndKey(parserNode, scope, function(err, bk) {
      if (err) {
        return cb(err, val);
      }
      cb(null, bk.value);
    });
  },
  // same as Dot I suppose.
  evaluateBracket: function(parserNode, scope, cb) {
    this.getBaseAndKey(parserNode, scope, function(err, bk) {
      if (err) {
        return cb(err, bk);
      }
      cb(null, bk.value);
    });
  },
  evaluateBinary: function(parserNode, scope, cb) {
    var self = this;
    var c = parserNode.children;
    // this.assert(c[1]._type, 'PUNCTUATION'); // could be PUNCTUATION or KEYWORD.
    var op = c[1].text();
    this.evaluate.call(this, c[0], scope, function(err, lhs) {
      if (err) { return cb(err, lhs); }
      switch (op) {
        case '+':
          this.evaluate.call(this, c[2], scope, function(err, rhs) {
            if (err) { return cb(err, rhs); }
            cb(null, lhs + rhs);
          });
          break;
        case '-':
          this.evaluate.call(this, c[2], scope, function(err, rhs) {
            if (err) { return cb(err, rhs); }
            cb(null, lhs - rhs);
          });
          break;
        case '*':
          this.evaluate.call(this, c[2], scope, function(err, rhs) {
            if (err) { return cb(err, rhs); }
            cb(null, lhs * rhs);
          });
          break;
        case '/':
          this.evaluate.call(this, c[2], scope, function(err, rhs) {
            if (err) { return cb(err, rhs); }
            cb(null, lhs / rhs);
          });
          break;
        case '%':
          this.evaluate.call(this, c[2], scope, function(err, rhs) {
            if (err) { return cb(err, rhs); }
            cb(null, lhs % rhs);
          });
          break;
        case '<':
          this.evaluate.call(this, c[2], scope, function(err, rhs) {
            if (err) { return cb(err, rhs); }
            cb(null, lhs < rhs);
          });
          break;
        case '>': 
          this.evaluate.call(this, c[2], scope, function(err, rhs) {
            if (err) { return cb(err, rhs); }
            cb(null, lhs > rhs);
          });
          break;
        case '==':
          this.evaluate.call(this, c[2], scope, function(err, rhs) {
            if (err) { return cb(err, rhs); }
            cb(null, lhs == rhs);
          });
          break;
        case '===':
          this.evaluate.call(this, c[2], scope, function(err, rhs) {
            if (err) { return cb(err, rhs); }
            cb(null, lhs === rhs);
          });
          break;
        case '!=':
          this.evaluate.call(this, c[2], scope, function(err, rhs) {
            if (err) { return cb(err, rhs); }
            cb(null, lhs != rhs);
          });
          break;
        case '!==':
          this.evaluate.call(this, c[2], scope, function(err, rhs) {
            if (err) { return cb(err, rhs); }
            cb(null, lhs !== rhs);
          });
          break;
        case '<=':
          this.evaluate.call(this, c[2], scope, function(err, rhs) {
            if (err) { return cb(err, rhs); }
            cb(null, lhs <= rhs);
          });
          break;
        case '>=':
          this.evaluate.call(this, c[2], scope, function(err, rhs) {
            if (err) { return cb(err, rhs); }
            cb(null, lhs >= rhs);
          });
          break;
        case '&&':
          if (lhs) {
            this.evaluate.call(this, c[2], scope, function(err, rhs) {
              if (err) { return cb(err, rhs); }
              cb(null, lhs && rhs);
            });
          } else {
            cb(null, lhs);
          }
          break;
        case '||':
          if (lhs) {
            cb(null, lhs);
          } else {
            this.evaluate.call(this, c[2], scope, function(err, rhs) {
              if (err) { return cb(err, rhs); }
              cb(null, lhs || rhs);
            });            
          }
          break;
        default:
          cb(new Error('Unknown operator: '+op));
      }      
    });
  },
  evaluateObject: function(parserNode, scope, cb) {
    var c = parserNode.children;
    var object = {};
    this.assert(c[0].text(), '{');
    this.assert(c[c.length-1].text(), '}');
    JSEvaluator.Util.asyncForEach(c, function(n, i, cb) {
      if (n.name != 'prop') { return cb(); }
      var pc = n.children;
      this.assert(pc[1].text(), ':');
      var n = pc[0];
      switch (n.name) {
        case 'idPropName':
          this.evaluate(pc[2], scope, function(err, val) {
            if (err) { return cb(err, val); }
            object[n.children[0].text()] = val;
            cb();            
          });
          break;
        case 'strPropName':
        case 'numPropName':
          this.evaluate(pc[2], scope, function(err, val) {
            if (err) { return cb(err, val); }
            // eval the string or number text to get an actual string or number
            object[eval(n.children[0].text())] = val;
            cb();
          });
          break;
        default:
          cb(new Error("unknown property identifier type: "+n.name));
      }      
    }, function(err, val) {
      if (err) { return cb(err, val); }
      cb(null, this.newObject(object));
    }, this);
  },
  evaluateArray: function(parserNode, scope, cb) {
    var c = parserNode.children;
    var arr = [];
    this.assert(c[0].text(), '[');
    this.assert(c[c.length-1].text(), ']');
    var i = 1;
    while (c[i]._text != ']') {
      arr.push(c[i]);
      if (c[i+1]._text == ',') {
        i += 2;
      } else {
        i++;
      }
    }
    var evaluatedArgs = [];
    JSEvaluator.Util.asyncForEach(arr, function(n, i, cb) {
      this.evaluate(n, scope, function(err, val) {
        if (err) { return cb(err, val); }
        evaluatedArgs.push(val);
        cb();
      });
    }, function(err, val) {
      if (err) { return cb(err, val); }
      cb(null, this.newObject(evaluatedArgs));
    }, this);
  },
  evaluateVarDecl: function(parserNode, scope, cb) {
    if (parserNode.children.length == 3) {
      this.evaluate(parserNode.children[2], scope, function(err, val) {
        if (err) { return cb(err, val); }
        scope.declareValue(parserNode.children[0].text(), val);
        cb();
      });
    } else {
      scope.declareValue(parserNode.children[0].text(), undefined);
      cb();
    }    
  },
  evaluateVar: function(parserNode, scope, cb) {
    this.assert(parserNode.children[0].text(), 'var');
    JSEvaluator.Util.asyncForEach(parserNode.children, function(node, i, cb) {
      if (node.name == 'varDecl') {
        this.evaluateVarDecl(node, scope, cb);
      } else {
        cb();
      }      
    }, function(err, val) {
      cb(err, val);
    }, this);
  },
  evaluateAssignment: function(parserNode, scope, cb) {
    var c = parserNode.children;
    var op = c[1].text();
    switch (c[0].name) {
      case 'identifier':
        switch (op) {
          case '=':
            this.evaluate(c[2], scope, function(err, val) {
              if (err) { return cb(err, val); }
              scope.updateValue(c[0].children[0].text(), val);
              cb(null, val);
            });
            break;
          case '+=':
            var oldValue = scope.getValue(c[0].children[0].text());
            this.evaluate(c[2], scope, function(err, val) {
              if (err) { return cb(err, val); }
              scope.updateValue(c[0].children[0].text(), oldValue + val);
              cb(null, oldValue + val);
            });
            break;
          case '-=':
            var oldValue = scope.getValue(c[0].children[0].text());
            this.evaluate(c[2], scope, function(err, val) {
              if (err) { return cb(err, val); }
              scope.updateValue(c[0].children[0].text(), oldValue - val);
              cb(null, oldValue - val);
            });
            break;
          default:
            cb(new Error("unknown operator: "+op));
        }
        break;
      case 'dot':
      case 'bracket':
        this.getBaseAndKey(c[0], scope, function(err, bk) {
          if (err) { return cb(err, bk); }
          switch (op) {
            case '=':
              this.evaluate(c[2], scope, function(err, val) {
                if (err) { return cb(err, val); }
                bk.base.assign(bk.key, val);
                cb(null, val);
              });
              break;
            case '+=':
              this.evaluate(c[2], scope, function(err, val) {
                if (err) { return cb(err, val); }
                bk.base.assign(bk.key, bk.value + val);
                cb(null, bk.value + val);
              });
              break;
            case '-=':
              this.evaluate(c[2], scope, function(err, val) {
                if (err) { return cb(err, val); }
                bk.base.assign(bk.key, bk.value - val);
                cb(null, bk.value - val);
              });
              break;
            default:
              cb(new Error("unknown operator: "+op));
          }          
        });
        break;
      default:
        cb(new Error("Unknown assignee node: "+c[0]));
    }
  },
  evaluateIf: function(parserNode, scope, cb) {
    var c = parserNode.children;
    this.assert(c[0].text(), 'if');
    this.evaluate(c[2], scope, function(err, condition) {
      if (err) { return cb(err, condition); }
      var consequentNode = c[4];
      var alternateNode = null;
      if (c.length > 6 && c[5].text() == 'else') {
        alternateNode = c[6];
      }
      if (condition) {
        this.evaluate(consequentNode, scope, cb);
      } else if (alternateNode) {
        this.evaluate(alternateNode, scope, cb);
      } else {
        cb();
      }
    });
  },
  maxCallDepth: 1000,
  evaluateLoop: function(conditionNode, bodyNode, postBodyNode, scope, cb) {
    var depth = 0;
    this.evaluate(conditionNode, scope, testAndRun);
    function testAndRun(err, condition) {
      if (err) { return cb(err, condition); }
      if (depth++ > this.get('maxCallDepth')) {
        var self = this;
        setTimeout(function() {
          depth = 0;
          testAndRun.call(self, err, condition);
        }, 0);
        return;
      }
      if (condition) {
        this.evaluate(bodyNode, scope, function(err, val) {
          if (err) { 
            if (err === 'break') {
              // resume after the while loop.
              return cb();
            } else if (err !== 'continue') {
              // if it's continue, evaluate the condition again
              return cb(err, val);
            }
          }
          if (postBodyNode) {
            this.evaluate(postBodyNode, scope, function(err, val) {
              if (err) { return cb(err, val); }
              this.evaluate(conditionNode, scope, testAndRun);              
            });
          } else {
            this.evaluate(conditionNode, scope, testAndRun);
          }
        });
      } else {
        cb();
      }
    }
  },
  evaluateWhile: function(parserNode, scope, cb) {
    var c = parserNode.children;
    this.assert(c[0].text(), 'while');
    var conditionNode = c[2];
    var bodyNode = c[4];
    this.evaluateLoop(conditionNode, bodyNode, null, scope, cb);
  },
  evaluateFor: function(parserNode, scope, cb) {
    var c = parserNode.children;
    this.assert(c[0].text(), 'for');
    var forSpec = c[2];
    var skipChildren = 0;
    if (forSpec.name == 'forVarSpec') {
      skipChildren = 1;
    }
    var fc = forSpec.children;
    var initialNode = fc[skipChildren+0];
    var conditionNode = fc[skipChildren+2];
    var postBodyNode = fc[skipChildren+4];
    var bodyNode = c[4];
    this.evaluate(initialNode, scope, function(err, val) {
      if (err) { return cb(err, val); }
      this.evaluateLoop(conditionNode, bodyNode, postBodyNode, scope, cb);
    });
  },
  evaluatePostfix: function(parserNode, scope, cb) {
    var c = parserNode.children;
    var bodyNode = c[0];
    var op = c[1].text();
    switch (bodyNode.name) {
      case 'identifier':
        this.evaluate(bodyNode, scope, function(err, oldValue) {
          if (err) { return cb(err, oldValue); }
          var newValue = null;
          switch (op) {
            case '++':
              newValue = oldValue + 1;
              break;
            case '--':
              newValue = oldValue - 1;
              break;
            default:
              return cb(new Error("Unknown operator type", op));
          }
          scope.updateValue(bodyNode.children[0].text(), newValue);
          cb(null, oldValue);
        });
        break;
      default:
        cb(new Error("unable to apply", op, "postfix operator to", bodyNode));
    }
  },
  evaluatePrefix: function(parserNode, scope, cb) {
    var c = parserNode.children;
    var bodyNode = c[1];
    var op = c[0].text();
    switch (bodyNode.name) {
      case 'identifier':
        this.evaluate(bodyNode, scope, function(err, value) {
          switch (op) {
            case '++':
              value += 1;
              break;
            case '--':
              value -= 1;
              break;
            default:
              return cb(new Error("Unknown operator type", op));
          }
          scope.updateValue(bodyNode.children[0].text(), value);          
          cb(null, value);
        });
        break;
      default:
        cb(new Error("unable to apply", op, "postfix operator to", bodyNode));
    }      
  },
  evaluateUnary: function(parserNode, scope, cb) {
    var c = parserNode.children;
    var op = c[0].text();
    var bodyNode = c[1];
    switch (op) {
      case '!':
        this.evaluate(bodyNode, scope, function(err, val) {
          if (err) { return cb(err, val); }
          cb(null, ! val);
        });
        break;
      case '-':
        this.evaluate(bodyNode, scope, function(err, val) {
          if (err) { return cb(err, val); }
          cb(null, - val);
        });
        break;
      case '+':
        this.evaluate(bodyNode, scope, function(err, val) {
          if (err) { return cb(err, val); }
          cb(null, + val);
        });
        break;
      case '--':
      case '++':
        this.evaluate(bodyNode, scope, function(err, val) {
          if (err) { return cb(err, val); }
          switch(op) {
            case '++':
              val += 1;
              break;
            case '--':
              val -= 1;
              break;
            default:
              return cb(new Error("Unknown unary operator", op));
          }
          scope.updateValue(bodyNode.children[0].text(), val);
          cb(null, val);
        });
        break;
      default:
        cb(new Error("Unknown unary operator", op));
    }
  },
  getNodePosition: function(node) {
    if (node.name == "program") {
      return {start: 0, end: this.get('currentCode').length};
    }
    var firstLexeme = node;
    while (firstLexeme.children) {
      firstLexeme = firstLexeme.children[0];
    }
    var lastLexeme = node;
    while (lastLexeme.children) {
      lastLexeme = lastLexeme.children[lastLexeme.children.length-1];
    }
    return {start: firstLexeme.startPos(), end: lastLexeme.endPos()};
  },
  convertPositionToLineCh: function(pos) {
    return {start: this.getLineCh(pos.start), end: this.getLineCh(pos.end) };
  },
  getNodeLineCh: function(node) {
    return this.convertPositionToLineCh(this.getNodePosition(node));
  },
  getNodeText: function(node) {
    var pos = this.getNodePosition(node);
    return this.get('currentCode').substring(pos.start, pos.end);
  },
  
  breakPeriod: 50,
  evaluationDelay: 0,
  evaluateCallId: 0,
  functionCallId: 0,
  evaluate: function(parserNode, scope, cb) {
    var self = this;
    var setBreak = false;
    if (! this.get('evaluationDelay')) {
      if (! this.get('blockStartTime')) {
        setBlockTime = true;
        this.set('blockStartTime', Date.now());
      } else if (Date.now() > this.get('blockStartTime') + this.get('breakPeriod')) {
        console.log("taking a break...");
        setTimeout(function() {
          self.set('blockStartTime', Date.now());
          self.evaluate(parserNode, scope, cb);
        }, 0);
        return;
      }      
    }
    if (parserNode instanceof Array) {
      return this.evaluateBlock(parserNode, scope, cb);
    }
    var nodePosition = this.getNodePosition(parserNode);
    var startLineCol = this.getLineCh(nodePosition.start);
    var endLineCol = this.getLineCh(nodePosition.end);
    if (this.get('state') != 'running') {
      var e = new Error('Evaluation stopped');
      e.errorType = "stopped";
      e.startPos = startLineCol;
      e.endPos = endLineCol;
      return cb(e);
    }
    if (this.get('deadline') && Date.now() > this.get('deadline')) {
      var e = new Error("Timeout at node");
      e.errorType = "timeout";
      console.log("error at node", parserNode, pos, this.get('lineColMapping'));
      e.startPos = startLineCol;
      e.endPos = endLineCol;
      return cb(e);
    }
    var callId = this.incrementProperty('evaluateCallId')
    this.noteEvent('evaluationStart', callId, parserNode, scope);
    var ed = self.get('evaluationDelay');
    if (ed) {
      setTimeout(function() {
        doEvaluation.call(self);
      }, ed);
    } else {
      doEvaluation.call(self);
    }
    function ecb(err, val) {
      // console.log("Evaluating", self.getNodeText(parserNode), "which evaluates to", val);
      self.noteEvent('evaluationEnd', callId, parserNode, scope, err, val);
      cb.call(self, err, val);
      if (setBlockTime) {
        self.set('blockStartTime', undefined);
      }
    }
    function doEvaluation() {
      switch (parserNode.name) {
        case 'program':
          this.evaluateBlock(parserNode.children, scope, ecb);
          break;
        case 'functionDecl':
          var f = this.createFunction(parserNode, scope);
          if (f.name) {
            scope.declareValue(f.name, f);
          } // else what?
          ecb(null, undefined);
          break;
        case 'functionExpr':
          var f = this.createFunction(parserNode, scope);
          if (f.name) {
            scope.declareValue(f.name, f); // should this happen in the non-declaration case?
          }
          ecb(null, f);
          break;
        case 'expressionStmnt':
          this.evaluateExpression(parserNode, scope, ecb);
          break;
        case 'call':
          this.evaluateCall(parserNode, scope, ecb);
          break;
        case 'returnStmnt':
          this.evaluateReturn(parserNode, scope, ecb);
          break;
        case 'identifier':
          var out = scope.getValue(parserNode.children[0].text());
          // console.log("lookup of", parserNode.children[0].text(), "in scope", scope, "=", out);
          ecb(null, out);
          break;
        case 'dot':
          this.evaluateDot(parserNode, scope, ecb);
          break;
        case 'bracket':
          this.evaluateBracket(parserNode, scope, ecb);
          break;
        case 'binary':
          this.evaluateBinary(parserNode, scope, ecb);
          break;
        case 'blockStmnt':
          this.assert(parserNode.children[0].text(), '{');
          this.assert(parserNode.children[parserNode.children.length-1].text(), '}');
          this.evaluateBlock(parserNode.children.slice(1, parserNode.children.length-1), scope, ecb);
          break;
        case 'breakStmnt':
          ecb('break');
          break;
        case 'continueStmnt':
          ecb('continue');
          break;
        case 'number': 
          ecb(null, Number(parserNode.children[0].text()));
          break;
        case 'boolean':
          ecb(null, parserNode.children[0].text() == 'false' ? false : true);
          break;
        case 'string':
          ecb(null, eval(parserNode.children[0].text()));
          break;
        case 'object':
          this.evaluateObject(parserNode, scope, ecb);
          break;
        case 'array':
          this.evaluateArray(parserNode, scope, ecb);
          break;
        case 'this':
          ecb(null, scope.getValue('this'));
          break;
        case 'varDecl':
          this.evaluateVarDecl(parserNode, scope, ecb);
        case 'varStmnt':
          this.evaluateVar(parserNode, scope, ecb);
          break;
        case 'assignment':
          this.evaluateAssignment(parserNode, scope, ecb);
          break;
        case 'ifStmnt':
          this.evaluateIf(parserNode, scope, ecb);
          break;
        case 'whileStmnt':
          this.evaluateWhile(parserNode, scope, ecb);
          break;
        case 'forStmnt':
          this.evaluateFor(parserNode, scope, ecb);
          break;
        case 'prefix':
          this.evaluatePrefix(parserNode, scope, ecb);
          break;
        case 'postfix':
          this.evaluatePostfix(parserNode, scope, ecb);
          break;
        case 'parens':
          this.evaluateBlock(parserNode.children.slice(1, parserNode.children.length-1), scope, ecb);
          break;
        case 'unary':
          this.evaluateUnary(parserNode, scope, ecb);
          break;
        default:
          ecb(new Error("unknown node type: "+parserNode.name));
      }
    }
  },
  evaluateBlock: function(parserNodes, scope, cb) {
    var functionDeclarations = parserNodes.filter(function(node) {
      return node.name == 'functionDecl';
    });
    JSEvaluator.Util.asyncForEach(functionDeclarations, function(node, index, cb) {
      this.evaluate(node, scope, cb);
    }, function(err, val) {
      if (err) { return cb(err, val); }
      var nonDeclarationNodes = parserNodes.filter(function(node) {
        return node.name != 'functionDecl';
      });
      JSEvaluator.Util.asyncForEach(nonDeclarationNodes, function(node, index, cb) {
        this.evaluate(node, scope, cb);
      }, cb, this);
    }, this);
  },
    
  calculateLineColumnMapping: function(code) {
    var rLineTerminator = /^[\u000A\u000D\u2028\u2029]$/g;
    var lineMapping = [];
    var columnMapping = [];
    var currentLine = 0;
    var currentColumn = 0;
    for (var i = 0; i < code.length; ++i) {
      lineMapping[i] = currentLine;
      columnMapping[i] = currentColumn;
      if (code[i].match(rLineTerminator)) { // for some reason rLineTerminator.test(code[i]) doesn't do the right thing.
        currentLine += 1;
        currentColumn = 0;
      } else {
        currentColumn++;
      }
    }
    return {line: lineMapping, col: columnMapping};
  },
  getLineCh: function(pos) {
    var m = this.get('lineColMapping');
    if (pos < 0) { return {line: 0, ch: 0}; }
    if (pos >= m.line.length) { return {line: m.line.length, ch: 0}; }
    return {line: m.line[pos], ch: m.col[pos]};
  },
  state: 'stopped',
  interpret: function(code, scope, timeout, cb) {
    console.log("running", JSON.stringify(code));
    if (timeout) {
      this.set('deadline', Date.now() + timeout);
    }
    if (scope && scope.get('interpreter') != this) {
      cb(new Error("Specified scope was not created by this interpreter."));
    }
    this.set('lineColMapping', this.calculateLineColumnMapping(code));
    this.set('currentCode', code);
    var parser = new JSParser(code, {});
    var syntaxTree = parser.getSyntaxTree();
    // console.log("tree", syntaxTree);
    this.set('state', 'running');
    this.evaluate(syntaxTree, scope || this.get('globalScope'), function(e) {
      this.set('state', 'stopped');
      cb(e);
    });
  },
  eventDelegate: null,
  noteEvent: function(name, arg1, arg2, etc) {
    var delegate = this.get('eventDelegate');
    if (delegate && delegate[name+'Handler']) {
      delegate[name+'Handler'].apply(delegate, Array.prototype.slice.call(arguments, 1));
    }
  },
  stop: function() {
    this.set('state', 'stopped');
  },
  nextScopeId: 1,
  init: function() {
    this._super();
    this.set('globalScope', JSEvaluator.Scope.create({
      id: 0,
      interpreter: this
    }));
  }
});