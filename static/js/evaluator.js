window.JSEvaluator = Em.Namespace.create({});

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
    
  call: function(thisPtr, args) {
    var scope = this.get('declarationScope').subScope();
    scope.declareValue('this', thisPtr);
    var argNames = this.get('argumentNames');
    for (var i = 0; i < Math.min(args.length, argNames.length); ++i) {
      scope.declareValue(argNames[i], args[i]);
    }
    return this.get('declarationScope.interpreter').evaluateBlock(this.get('bodyNodes'), scope)
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
      call: function(thisPtr, args) {
        var ret = f.apply(thisPtr, args);
        console.log("calling external function", name, "with args", args, "returning", ret);
        return ret;
      }
    });
  },
  createFunction: function(parserNode, scope) {
    var c = parserNode.children;
    this.assert(c[0]._text, 'function'); // just checking...
    var name = c[1]._type == 'IDENTIFIER' ? c[1]._text : null;
    this.assert(c[2]._text, '(');
    var i = 3;
    var argumentNames = [];
    while (c[i]._text != ')') { // "function foo(a,b,c,)" with trailing , in argument list should be caught by parser, right...?
      argumentNames.push(c[i]._text);
      if (c[i+1]._text == ',') {
        i += 2;
      } else {
        i++;
      }
    }
    this.assert(c[i]._text, ')'); i++;
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
  evaluateExpression: function(parserNode, scope) {
    var c = parserNode.children;
    this.assert(c[1]._text, ';')
    return this.evaluate(c[0], scope);
  },
  getBaseAndKey: function(parserNode, scope) {
    var c = parserNode.children;
    var bk;
    switch (parserNode.name) {
      case 'dot':
        var baseNode = c[0];
        this.assert(c[1]._text, '.');
        var key = c[2]._text;
        bk = {base: this.evaluate(baseNode, scope), key: key};
        break;
      case 'bracket':
        var baseNode = c[0];
        this.assert(c[1]._text, '[');
        var key = c[2];
        this.assert(c[3]._text, ']');
        bk = {base: this.evaluate(baseNode, scope), key: this.evaluate(key, scope)};
        break;
      default:
        throw new Error("Unknown node type "+parserNode.name+" to get base and key from.");
    }
    if (typeof(bk.base) != 'object') {
      throw new Error("'"+bk.base+"' is not an object");
    }
    bk.value = bk.base.retrieve(bk.key);
    return bk;
  },
  evaluateCall: function(parserNode, scope) {
    var c = parserNode.children;
    var functionNode = c[0];
    var thisPtr = null;
    var f;
    switch (functionNode.name) {
      case 'dot':
      case 'bracket':
        var bk = this.getBaseAndKey(functionNode, scope);
        thisPtr = bk.base;
        f = bk.value;
        break;
      case 'identifier':
        f = this.evaluate(functionNode, scope);
        break;
      default:
        throw new Error("not sure how to call functionNode"+functionNode.name);
    }

    this.assert(c[1]._text, '(');
    var i = 2;
    var args = [];
    while (c[i]._text != ')') {
      args.push(c[i]);
      if (c[i+1]._text == ',') {
        i += 2;
      } else {
        i++;
      }
    }
    args = args.map(function(argNode) {
      return this.evaluate(argNode, scope);
    }, this);

    return f.call(thisPtr, args);        
  },
  evaluateDot: function(parserNode, scope) {
    return this.getBaseAndKey(parserNode, scope).value;
  },
  evaluateBracket: function(parserNode, scope) {
    return this.getBaseAndKey(parserNode, scope).value;
  },
  evaluateBinary: function(parserNode, scope) {
    var self = this;
    var c = parserNode.children;
    // LHS and RHS are functions so we can rely on javascript's existing behavior when it comes to
    // whether to actually evaluate the LHS and RHS (for || and &&)
    var lhs = function() { return self.evaluate(c[0], scope); };
    var rhs = function() { return self.evaluate(c[2], scope); };
    // this.assert(c[1]._type, 'PUNCTUATION'); // could be PUNCTUATION or KEYWORD.
    var op = c[1]._text;
    switch (op) {
      case '+':
        return lhs() + rhs();
      case '-':
        return lhs() - rhs();
      case '*':
        return lhs() * rhs();
      case '/':
        return lhs() / rhs();
      case '%':
        return lhs() % rhs();
      case '<':
        return lhs() < rhs();
      case '>': 
        return lhs() > rhs();
      case '==':
        return lhs() == rhs();
      case '===':
        return lhs() === rhs();
      case '!=':
        return lhs() != rhs();
      case '!==':
        return lhs() !== rhs();
      case '<=':
        return lhs() <= rhs();
      case '>=':
        return lhs() >= rhs();
      case '&&':
        return lhs() && rhs();
      case '||':
        return lhs() || rhs();
      case 'instanceof':
        return lhs() instanceof rhs();
      default:
        throw new Error('Unknown operator: '+op);
    }      
  },
  evaluateObject: function(parserNode, scope) {
    var c = parserNode.children;
    var object = {};
    this.assert(c[0]._text, '{');
    this.assert(c[c.length-1]._text, '}');
    c.forEach(function(n) {
      if (n.name != 'prop') { return; }
      var pc = n.children;
      this.assert(pc[1]._text, ':');
      var n = pc[0];
      switch (n.name) {
        case 'idPropName':
          object[n.children[0]._text] = this.evaluate(pc[2], scope);
          break;
        case 'strPropName':
        case 'numPropName':
          // eval the string or number text to get an actual string or number
          object[eval(n.children[0]._text)] = this.evaluate(pc[2], scope);
          break;
        default:
          throw new Error("unknown property identifier type: "+n.name);
      }
    }, this);
    return this.newObject(object);
  },
  evaluateArray: function(parserNode, scope) {
    var c = parserNode.children;
    var arr = [];
    this.assert(c[0]._text, '[');
    this.assert(c[c.length-1]._text, ']');
    var i = 1;
    while (c[i]._text != ']') {
      arr.push(this.evaluate(c[i], scope));
      if (c[i+1]._text == ',') {
        i += 2;
      } else {
        i++;
      }
    }
    return this.newObject(arr);
  },
  evaluateVar: function(parserNode, scope) {
    this.assert(parserNode.children[0]._text, 'var');
    parserNode.children.forEach(function(node) {
      if (node.name == 'varDecl') {
        scope.declareValue(node.children[0]._text, node.children.length == 2 ? this.evaluate(node.children[2], scope) : undefined);
      }
    }, this);
    return undefined;
  },
  evaluateAssignment: function(parserNode, scope) {
    var c = parserNode.children;
    var op = c[1]._text;
    switch (c[0].name) {
      case 'identifier':
        switch (op) {
          case '=':
            return scope.updateValue(c[0].children[0]._text, this.evaluate(c[2], scope));
          case '+=':
            var oldValue = scope.getValue(c[0].children[0]._text);
            return scope.updateValue(c[0].children[0]._text, oldValue + this.evaluate(c[2], scope));
          case '-=':
            var oldValue = scope.getValue(c[0].children[0]._text);
            return scope.updateValue(c[0].children[0]._text, oldValue - this.evaluate(c[2], scope));
          default:
            throw new Error("unknown operator: "+op);
        }
      case 'dot':
      case 'bracket':
        var bk = this.getBaseAndKey(c[0], scope);
        switch (op) {
          case '=':
            return bk.base.assign(bk.key, this.evaluate(c[2], scope));
          case '+=':
            return bk.base.assign(bk.key, bk.value + this.evaluate(c[2], scope));
          case '-=':
            return bk.base.assign(bk.key, bk.value - this.evaluate(c[2], scope));
          default:
            throw new Error("unknown operator: "+op);
        }
      default:
        throw new Error("Unknown assignee node: "+c[0]);
    }
  },
  evaluateIf: function(parserNode, scope) {
    var c = parserNode.children;
    this.assert(c[0]._text, 'if');
    var condition = this.evaluate(c[2], scope);
    var consequentNode = c[4];
    var alternateNode = null;
    if (c.length > 6 && c[5]._text == 'else') {
      alternateNode = c[6];
    }
    if (condition) {
      this.evaluate(consequentNode, scope);
    } else if (alternateNode) {
      this.evaluate(alternateNode, scope);
    }
  },
  evaluateWhile: function(parserNode, scope) {
    var c = parserNode.children;
    this.assert(c[0]._text, 'while');
    var conditionNode = c[2];
    var bodyNode = c[4];
    while (this.evaluate(conditionNode, scope)) {
      this.evaluate(bodyNode, scope);
    }
  },
  evaluatePostfix: function(parserNode, scope) {
    var c = parserNode.children;
    var bodyNode = c[0];
    var op = c[1]._text;
    switch (bodyNode.name) {
      case 'identifier':
        var oldValue = this.evaluate(bodyNode, scope);
        var newValue = null;
        switch (op) {
          case '++':
            newValue = oldValue + 1;
            break;
          case '--':
            newValue = oldValue - 1;
            break;
          default:
            throw new Error("Unknown operator type", op);
        }
        scope.updateValue(bodyNode.children[0]._text, newValue);
        return oldValue;
      default:
        throw new Error("unable to apply", op, "postfix operator to", bodyNode);          
    }
  },
  evaluatePrefix: function(parserNode, scope) {
    var c = parserNode.children;
    var bodyNode = c[1];
    var op = c[0]._text;
    switch (bodyNode.name) {
      case 'identifier':
        var value = this.evaluate(bodyNode, scope);
        switch (op) {
          case '++':
            value += 1;
            break;
          case '--':
            value -= 1;
            break;
          default:
            throw new Error("Unknown operator type", op);
        }
        scope.updateValue(bodyNode.children[0]._text, value);
        return value;
      default:
        throw new Error("unable to apply", op, "postfix operator to", bodyNode);
    }      
  },
  evaluateUnary: function(parserNode, scope) {
    var c = parserNode.children;
    var op = c[0]._text;
    var bodyNode = c[1];
    switch (op) {
      case '!':
        return ! this.evaluate(bodyNode, scope);
      case '-':
        return (- this.evaluate(bodyNode, scope));
      case '+':
        return (+ this.evaluate(bodyNode, scope));
      default:
        throw new Error("Unknown unary operator", op);
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
  evaluate: function(parserNode, scope) {
    if (parserNode instanceof Array) {
      return this.evaluateBlock(parserNode, scope);
    }
    if (Date.now() > this.get('deadline')) {
      var e = new Error("Timeout at node");
      e.errorType = "timeout";
      var pos = this.getNodePosition(parserNode);
      console.log("error at node", parserNode, pos, this.get('lineColMapping'));
      e.startPos = this.getLineCol(pos.start);
      e.endPos = this.getLineCol(pos.end);
      throw e;
    }
    var ret;
    switch (parserNode.name) {
      case 'program':
        ret = this.evaluateBlock(parserNode.children, scope);
        break;
      case 'functionDecl':
        var f = this.createFunction(parserNode, scope);
        if (f.name) {
          scope.declareValue(f.name, f);
        } // else what?
        ret = undefined;
        break;
      case 'functionExpr':
        var f = this.createFunction(parserNode, scope);
        if (f.name) {
          scope.declareValue(f.name, f); // should this happen in the non-declaration case?
        }
        ret = f;
        break;
      case 'expressionStmnt':
        ret = this.evaluateExpression(parserNode, scope);
        break;
      case 'call':
        ret = this.evaluateCall(parserNode, scope);
        break;
      case 'identifier':
        var out = scope.getValue(parserNode.children[0]._text);
        // console.log("lookup of", parserNode.children[0]._text, "in scope", scope, "=", out);
        ret = out;
        break;
      case 'dot':
        ret = this.evaluateDot(parserNode, scope);
        break;
      case 'bracket':
        ret = this.evaluateBracket(parserNode, scope);
        break;
      case 'binary':
        ret = this.evaluateBinary(parserNode, scope);
        break;
      case 'blockStmnt':
        this.assert(parserNode.children[0]._text, '{');
        this.assert(parserNode.children[parserNode.children.length-1]._text, '}');
        ret = this.evaluateBlock(parserNode.children.slice(1, parserNode.children.length-1), scope);
        break;
      case 'number': 
        ret = Number(parserNode.children[0]._text);
        break;
      case 'string':
        ret = eval(parserNode.children[0]._text);
        break;
      case 'object':
        ret = this.evaluateObject(parserNode, scope);
        break;
      case 'array':
        ret = this.evaluateArray(parserNode, scope);
        break;
      case 'this':
        ret = scope.getValue('this');
        break;
      case 'varStmnt':
        this.evaluateVar(parserNode, scope);
        ret = undefined;
        break;
      case 'assignment':
        ret = this.evaluateAssignment(parserNode, scope);
        break;
      case 'ifStmnt':
        this.evaluateIf(parserNode, scope);
        ret = undefined;
        break;
      case 'whileStmnt':
        this.evaluateWhile(parserNode, scope);
        ret = undefined;
        break;
      case 'prefix':
        ret = this.evaluatePrefix(parserNode, scope);
        break;
      case 'postfix':
        ret = this.evaluatePostfix(parserNode, scope);
        break;
      case 'parens':
        ret = this.evaluateBlock(parserNode.children.slice(1, parserNode.children.length-1), scope);
        break;
      case 'unary':
        ret = this.evaluateUnary(parserNode, scope);
        break;
      default:
        throw new Error("unknown node type: "+parserNode.name);
    }
    console.log("Evaluating", this.getNodeText(parserNode), "which evaluates to", ret);
    return ret;
  },
  evaluateBlock: function(parserNodes, scope) {
    var functionDeclarations = parserNodes.filter(function(node) {
      return node.name == 'functionDecl';
    });
    functionDeclarations.forEach(function(node) {
      this.evaluate(node, scope);
    }, this);
    parserNodes.forEach(function(node) {
      if (node.name == 'functionDecl') { return; } // skip these now.
      this.evaluate(node, scope);
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
  timeout: 1000,
  interpret: function(code, scope, timeout) {
    console.log("running", JSON.stringify(code));
    this.set('deadline', Date.now() + (timeout || this.get('timeout') || 10000));
    if (scope && scope.get('interpreter') != this) {
      throw new Error("Specified scope was not created by this interpreter.");
    }
    this.set('lineColMapping', this.calculateLineColumnMapping(code));
    this.set('currentCode', code);
    var parser = new JSParser(code, {});
    this.evaluate(parser.getSyntaxTree(), scope || this.get('globalScope'));
  },
  init: function() {
    this._super();
    this.set('globalScope', JSEvaluator.Scope.create({
      interpreter: this
    }));
  }
});