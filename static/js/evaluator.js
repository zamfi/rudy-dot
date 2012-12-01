window.JSEvaluator = Em.Namespace.create({});

JSEvaluator.Util = Em.Object.create({
  asyncForEach: function(arr, each_cb, done_cb, thisPtr) {
    var i = 0;

    function doNextCb(err, val) {
      if (err) {
        return done_cb.call(thisPtr, err);
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
  subScope: function() {
    return JSEvaluator.Scope.create({parent: this});
  },
  declareValue: function(name, value) {
    this.get('variables')[name] = value;
    // console.log("declaring variable", name, "with initial value", value);
  },
  updateValue: function(name, value) {
    if (name in this.get('variables') || ! this.get('parent')) {
      this.get('variables')[name] = value;
    } else {
      this.get('parent').setValue(name, value);
    }
  },
  getBuiltIn: function(name) {
    var interpreter = this.get('interpreter');
    // console.log("seeking otherwise undefined name", name, "in global scope");
    if (name in interpreter.get('builtIns')) {
      // console.log("...it exists, and...")
      var val = interpreter.get('builtIns')[name];
      if (typeof(val) == 'function') {
        // console.log("...it's a function.");
        val = interpreter.wrapExternalFunction(val, name);
      } else if (typeof(val) == 'object') {
        val = interpreter.newObject(val);
      }
      this.declareValue(name, val);
      return val;
    } else {
      return undefined;          
    }    
  },
  getValue: function(name) {
    if (name in this.get('variables')) {
      return this.get('variables')[name];
    } else if (this.get('parent')) {
      return this.get('parent').getValue(name);
    } else {
      return this.getBuiltIn(name);
    }
  },
  init: function() {
    this._super();
    this.set('variables', {}); // no variables set initially...
    if (! this.get('interpreter')) {
      throw new Error('Attempted to create a scope without an interpreter...');
    }
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
    
  call: function(thisPtr, args, cb) {
    var scope = this.get('declarationScope').subScope();
    scope.declareValue('this', thisPtr);
    var argNames = this.get('argumentNames');
    for (var i = 0; i < Math.min(args.length, argNames.length); ++i) {
      scope.declareValue(argNames[i], args[i]);
    }
    this.get('declarationScope.interpreter').evaluateBlock(this.get('bodyNodes'), scope, cb);
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
  wrapExternalFunction: function(f, name) {
    return JSEvaluator.Function.create({
      id: this.incrementProperty('nextObjectId'),
      name: name,
      call: function(thisPtr, args, cb) {
        try {
          var ret = f.apply(thisPtr, args);
          // console.log("calling external function", name, "with args", args, "returning", ret);
          cb(null, ret);
        } catch (e) {
          cb(e);
        }
      }
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
      argumentNames.push(c[i]._text);
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
          if (err) { return cb.call(this, err); }
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
          if (err) { return cb.call(this, err); }
          if (typeof(baseVal) !== 'object') {
            return cb.call(this, new Error("'"+baseVal+"' is not an object"));
          }
          this.evaluate(key, scope, function(err, keyVal) {
            if (err) { return cb.call(this, err); }
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
          if (err) { return cb(err); }
          withFunction.call(this, bk.base, bk.value);
        });
        break;
      case 'identifier':
        this.evaluate(functionNode, scope, function(err, val) {
          if (err) { return cb(err); }
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
          if (err) { return cb(err); }
          // console.log("...is", val);
          evaluatedArgs[index] = val;
          cb();
        });
      }, function(err, val) {
        if (err) { return cb(err); }
        // console.log("now calling function", f.get('name'));
        f.call(thisPtr, evaluatedArgs, cb);
      }, this);
    }    
  },
  evaluateDot: function(parserNode, scope, cb) {
    this.getBaseAndKey(parserNode, scope, function(err, bk) {
      if (err) {
        return cb(err);
      }
      cb(null, bk.value);
    });
  },
  // same as Dot I suppose.
  evaluateBracket: function(parserNode, scope, cb) {
    this.getBaseAndKey(parserNode, scope, function(err, bk) {
      if (err) {
        return cb(err);
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
      switch (op) {
        case '+':
          this.evaluate.call(this, c[2], scope, function(err, rhs) {
            if (err) { return cb(err); }
            cb(null, lhs + rhs);
          });
          break;
        case '-':
          this.evaluate.call(this, c[2], scope, function(err, rhs) {
            if (err) { return cb(err); }
            cb(null, lhs - rhs);
          });
          break;
        case '*':
          this.evaluate.call(this, c[2], scope, function(err, rhs) {
            if (err) { return cb(err); }
            cb(null, lhs * rhs);
          });
          break;
        case '/':
          this.evaluate.call(this, c[2], scope, function(err, rhs) {
            if (err) { return cb(err); }
            cb(null, lhs / rhs);
          });
          break;
        case '%':
          this.evaluate.call(this, c[2], scope, function(err, rhs) {
            if (err) { return cb(err); }
            cb(null, lhs % rhs);
          });
          break;
        case '<':
          this.evaluate.call(this, c[2], scope, function(err, rhs) {
            if (err) { return cb(err); }
            cb(null, lhs < rhs);
          });
          break;
        case '>': 
          this.evaluate.call(this, c[2], scope, function(err, rhs) {
            if (err) { return cb(err); }
            cb(null, lhs > rhs);
          });
          break;
        case '==':
          this.evaluate.call(this, c[2], scope, function(err, rhs) {
            if (err) { return cb(err); }
            cb(null, lhs == rhs);
          });
          break;
        case '===':
          this.evaluate.call(this, c[2], scope, function(err, rhs) {
            if (err) { return cb(err); }
            cb(null, lhs === rhs);
          });
          break;
        case '!=':
          this.evaluate.call(this, c[2], scope, function(err, rhs) {
            if (err) { return cb(err); }
            cb(null, lhs != rhs);
          });
          break;
        case '!==':
          this.evaluate.call(this, c[2], scope, function(err, rhs) {
            if (err) { return cb(err); }
            cb(null, lhs !== rhs);
          });
          break;
        case '<=':
          this.evaluate.call(this, c[2], scope, function(err, rhs) {
            if (err) { return cb(err); }
            cb(null, lhs <= rhs);
          });
          break;
        case '>=':
          this.evaluate.call(this, c[2], scope, function(err, rhs) {
            if (err) { return cb(err); }
            cb(null, lhs >= rhs);
          });
          break;
        case '&&':
          if (lhs) {
            this.evaluate.call(this, c[2], scope, function(err, rhs) {
              if (err) { return cb(err); }
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
              if (err) { return cb(err); }
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
            if (err) { return cb(err); }
            object[n.children[0].text()] = val;
            cb();            
          });
          break;
        case 'strPropName':
        case 'numPropName':
          this.evaluate(pc[2], scope, function(err, val) {
            if (err) { return cb(err); }
            // eval the string or number text to get an actual string or number
            object[eval(n.children[0].text())] = val;
            cb();
          });
          break;
        default:
          cb(new Error("unknown property identifier type: "+n.name));
      }      
    }, function(err, val) {
      if (err) { return cb(err); }
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
        if (err) { return cb(err); }
        evaluatedArgs.push(val);
        cb();
      });
    }, function(err, val) {
      if (err) { return cb(err); }
      cb(null, this.newObject(evaluatedArgs));
    }, this);
  },
  evaluateVar: function(parserNode, scope, cb) {
    this.assert(parserNode.children[0].text(), 'var');
    JSEvaluator.Util.asyncForEach(parserNode.children, function(node, i, cb) {
      if (node.name == 'varDecl') {
        if (node.children.length == 3) {
          this.evaluate(node.children[2], scope, function(err, val) {
            if (err) { return cb(err); }
            scope.declareValue(node.children[0].text(), val);
            cb();
          });
        } else {
          scope.declareValue(node.children[0].text(), undefined);
          cb();
        }
      } else {
        cb();
      }      
    }, function(err, val) {
      cb(err);
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
              if (err) { return cb(err); }
              scope.updateValue(c[0].children[0].text(), val);
              cb(null, val);
            });
            break;
          case '+=':
            var oldValue = scope.getValue(c[0].children[0].text());
            this.evaluate(c[2], scope, function(err, val) {
              if (err) { return cb(err); }
              scope.updateValue(c[0].children[0].text(), oldValue + val);
              cb(null, oldValue + val);
            });
            break;
          case '-=':
            var oldValue = scope.getValue(c[0].children[0].text());
            this.evaluate(c[2], scope, function(err, val) {
              if (err) { return cb(err); }
              scope.updateValue(c[0].children[0].text(), oldValue - val);
              cb(null, oldValue + val);
            });
            break;
          default:
            cb(new Error("unknown operator: "+op));
        }
        break;
      case 'dot':
      case 'bracket':
        this.getBaseAndKey(c[0], scope, function(err, bk) {
          if (err) { return cb(err); }
          switch (op) {
            case '=':
              this.evaluate(c[2], scope, function(err, val) {
                if (err) { return cb(err); }
                bk.base.assign(bk.key, val);
                cb(null, val);
              });
              break;
            case '+=':
              this.evaluate(c[2], scope, function(err, val) {
                if (err) { return cb(err); }
                bk.base.assign(bk.key, bk.value + val);
                cb(null, val);
              });
              break;
            case '-=':
              this.evaluate(c[2], scope, function(err, val) {
                if (err) { return cb(err); }
                bk.base.assign(bk.key, bk.value - val);
                cb(null, val);
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
      if (err) { return cb(err); }
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
  evaluateWhile: function(parserNode, scope, cb) {
    var c = parserNode.children;
    this.assert(c[0].text(), 'while');
    var conditionNode = c[2];
    var bodyNode = c[4];
    var depth = 0;
    this.evaluate(conditionNode, scope, testAndRun);
    function testAndRun(err, condition) {
      if (err) { return cb(err); }
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
          if (err) { return cb(err); }
          this.evaluate(conditionNode, scope, testAndRun);
        });
      } else {
        cb();
      }
    }
  },
  evaluatePostfix: function(parserNode, scope, cb) {
    var c = parserNode.children;
    var bodyNode = c[0];
    var op = c[1].text();
    switch (bodyNode.name) {
      case 'identifier':
        this.evaluate(bodyNode, scope, function(err, oldValue) {
          if (err) { return cb(err); }
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
          if (err) { return cb(err); }
          cb(null, ! val);
        });
        break;
      case '-':
        this.evaluate(bodyNode, scope, function(err, val) {
          if (err) { return cb(err); }
          cb(null, - val);
        });
        break;
      case '+':
        this.evaluate(bodyNode, scope, function(err, val) {
          if (err) { return cb(err); }
          cb(null, + val);
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
  getNodeText: function(node) {
    var pos = this.getNodePosition(node);
    return this.get('currentCode').substring(pos.start, pos.end);
  },
  
  breakPeriod: 50,
  evaluate: function(parserNode, scope, cb) {
    var self = this;
    var setBreak = false;
    if (! this.get('nextBreak')) {
      setBreak = true;
      this.set('nextBreak', Date.now() + this.get('breakPeriod'));
    } else if (Date.now() > this.get('nextBreak')) {
      setTimeout(function() {
        self.set('nextBreak', Date.now() + self.get('breakPeriod'));
        self.evaluate(parserNode, scope, cb);
      }, 0);
      return;
    }
    if (parserNode instanceof Array) {
      return this.evaluateBlock(parserNode, scope, cb);
    }
    if (Date.now() > this.get('deadline')) {
      var e = new Error("Timeout at node");
      e.errorType = "timeout";
      var pos = this.getNodePosition(parserNode);
      console.log("error at node", parserNode, pos, this.get('lineColMapping'));
      e.startPos = this.getLineCol(pos.start);
      e.endPos = this.getLineCol(pos.end);
      return cb(e);
    }
    function ecb(err, val) {
      console.log("Evaluating", self.getNodeText(parserNode), "which evaluates to", val);
      cb.call(self, err, val);
      if (setBreak) {
        self.set('nextBreak', undefined);
      }
    }
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
      case 'number': 
        ecb(null, Number(parserNode.children[0].text()));
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
  },
  evaluateBlock: function(parserNodes, scope, cb) {
    var functionDeclarations = parserNodes.filter(function(node) {
      return node.name == 'functionDecl';
    });
    JSEvaluator.Util.asyncForEach(functionDeclarations, function(node, index, cb) {
      this.evaluate(node, scope, cb);
    }, function(err, val) {
      if (err) { return cb(err); }
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
  getLineCol: function(pos) {
    var m = this.get('lineColMapping');
    return {line: m.line[pos], col: m.col[pos]};
  },
  timeout: 5000,
  interpret: function(code, scope, timeout, cb) {
    console.log("running", JSON.stringify(code));
    this.set('deadline', Date.now() + (timeout || this.get('timeout') || 10000));
    if (scope && scope.get('interpreter') != this) {
      cb(new Error("Specified scope was not created by this interpreter."));
    }
    this.set('lineColMapping', this.calculateLineColumnMapping(code));
    this.set('currentCode', code);
    var parser = new JSParser(code, {});
    this.evaluate(parser.getSyntaxTree(), scope || this.get('globalScope'), cb);
  },
  init: function() {
    this._super();
    this.set('globalScope', JSEvaluator.Scope.create({
      interpreter: this
    }));
  }
});