window.CodingSupport = Em.Namespace.create({
  SyntaxChecker: Em.Object.extend({
    codeTemplate: "run",
    predef: null,
    initializePredef: function() {
      if (! this.get('predef')) {
        var predef = {};
        switch(this.get('codeTemplate')) {
          case 'run':
            new Processing(document.getElementById('testcanvas'), function(processing) {
              for (var k in processing) {
                predef[k] = false;
              }
              predef.setup = true;
              predef.draw = true;
              predef.mousePressed = true;
              predef.mouseClicked = true;
              predef.mouseDragged = true;
              predef.mouseMoved = true;
              predef.mouseReleased = true;
              predef.mouseScrolled = true;
              predef.mouseOver = true;
              predef.mouseOut = true;
              predef.touchStart = true;
              predef.touchEnd = true;
              predef.touchMove = true;
              predef.touchCancel = true;
              predef.keyPressed = true;
              predef.keyReleased = true;
              predef.keyTyped = true;
            });
            break;
          case 'rudy':
            predef.left = false;
            predef.right = false;
            predef.up = false;
            predef.down = false;
            predef.coloring = false;
            predef.remainingDots = false;
            predef.println = false;
            break;
        }
        this.set('predef', predef);
      }
    },
    
    check: function(code) {
      this.initializePredef();
      var pass = JSLINT(code, {
        predef: this.get('predef'),
        anon: true,
        eqeq: true,
        plusplus: true,
        newcap: true,
        unparam: true,
        sloppy: true,
        vars: true,
        white: true,
        regexp: true,
        forin: true,
        sub: true
      });
      if (! pass) {
        return JSLINT.errors;
      }
    }
  }),
  
  CodeInstrumentor: Em.Object.extend({
    instrument: function(code, tree) {
      var checkPoints = [];
      var lines = code.split("\n");
      function handleNode(node) {
        if (node instanceof Array) {
          return node.forEach(handleNode);
        }
        if (node.first) {
          handleNode(node.first);
        }
        if (node.second) {
          handleNode(node.second);
        }
        if (node.block) {
          handleBlock(node.block);
        }
      }
      function getNodeStart(node) {
        switch(node.arity) {
          case "infix": case "suffix":
            return getNodeStart(node.first);
          default:
            return {line: node.line, from: node.from};
        }
      }
      function handleBlock(block, skipInsertion) {
        if (! skipInsertion) {
          checkPoints.push(getNodeStart(block[0]));
        }
        for (var i = block.length-1; i >= 0; --i) {
          handleNode(block[i])
        }
      }
      handleBlock(tree.first, true);
      checkPoints.sort(function(a, b) {
        return a.line == b.line ? a.line - b.line : a.from - b.from;
      }).reverse();
      checkPoints.forEach(function(loc) {
        var line = loc.line-1; // 1-indexed.
        var chr  = loc.from-1; // also 1-indexed.
        var curLine = lines[line];
        lines[line] = curLine.substr(0, chr)+"__ck("+loc.line+","+loc.from+"); "+curLine.substr(chr);
      });
      var newCode = lines.join("\n");
      return newCode;
    }
    // test: function() {
    //   var code = Main.controller.getCode();
    //   Main.controller.validate(code);
    //   console.log(this.instrument(code, JSLINT.tree));
    // }
  }),
  
  CodeMirrorView: Em.View.extend({
    shareDocName: null,
    shareDoc: null,
    autoResize: false,
    status: 'off',
    didInsertElement: function() {
      this._super();
      var initialCode = this.$().text();
      this.$().html('<textarea>'+initialCode+'</textarea>');

      var self = this;
      var codeArea = CodeMirror.fromTextArea(this.$('textarea')[0], {
        mode: "javascript",
        tabSize: 2,
        lineNumbers: true,
        indentWithTabs: false,
        // extraKeys: { "Tab": "IndentAuto" },
        onChange: function() {
          if (self.get('controller').noteCodeChange) {
            self.get('controller').noteCodeChange();
          }
        }
      });
      this.set('codeArea', codeArea);

      if (this.get('autoResize')) {
        CodeMirror.connect(window, 'resize', function() { self.resizeCodeMirror(); });
        this.resizeCodeMirror();        
      }
      
      this.set('markedLines', []); // don't share this across instances.
      if (this.get('controller')) {
        this.set('controller.codeMirrorView', this);
      }
      
      if (this.get('shareDocName')) {
        var self = this;
        this.set('shareConnection', sharejs.open(this.get('shareDocName'), "text", function(error, newDoc) {
          if (self.get('shareDoc')) {
            var oldDoc = self.get('shareDoc');
            oldDoc.close();
            oldDoc.detach_cm();
          }
          if (error) {
            console.log("Failed to connect to server...");
          }
          self.set('shareDoc', newDoc);
          newDoc.attach_cm(self.get('codeArea'), true);
        }));
        var connection = this.get('shareConnection');
        connection.on('ok', function() {self.set('status', 'success')});
        connection.on('connecting', function() {self.set('status', 'connecting')});
        connection.on('disconnected', function() {self.set('status', 'disconnected')});
        connection.on('stopped', function() {self.set('status', 'stopped')});
      }
    },
    
    resizeCodeMirror: function() {
      var codeArea = this.get('codeArea');
      var winHeight = window.innerHeight || (document.documentElement || document.body).clientHeight;
      codeArea.getScrollerElement().style.height = (winHeight - 60) + " px";
      codeArea.refresh();
    },
    
    initialCode: "// Your code here.",
    defaultTemplate: Em.Handlebars.compile("{{{initialCode}}}"),

    markedLines: null,
    clearErrors: function() {
      this.$('.errorbox').remove();
      var codeArea = this.get('codeArea')
      this.get('markedLines').forEach(function(lineHandle) {
        codeArea.setLineClass(lineHandle, null, null);
        codeArea.clearMarker(lineHandle);
      });
      this.set('markedLines', []);
    },
    markErrors: function(errors, suppressBoxes) {
      var codeArea = this.get('codeArea');
      var markedLines = this.get('markedLines');
      var stopped = false;
      var boxes = errors.map(function(error) {
        if (stopped || error == null) {
          stopped = true;
          return;
        }
        if (error.reason.substr(0, "Stopping".length) == "Stopping") {
          return; // don't print these.
        }
        
        var lineHandle = codeArea.setMarker(error.line-1, '%N%', 'gutter-warning');
        codeArea.setLineClass(lineHandle, null, 'line-warning');
        markedLines.push(lineHandle);
        return suppressBoxes ? Em.K : this.showErrorBox(error.line-1, error.character-1||1, error.reason);
      }, this);
      
      boxes.reverse().forEach(function(box) {
        if (box) { box(); }
      });
    },
    showErrorBox: function(line, character, msg) {
      var codeArea = this.get('codeArea');
      return function() {
        var box = $('<div class="callout errorbox">');
        var closeBox = $('<div class="close">&times;</div>');
        closeBox.click(function() {
          box.remove();
        });
        box.append(closeBox);
        box.append($('<span>').text(msg));
        box.append($('<div class="border-notch notch">'))
        box.append($('<div class="notch">'))
        codeArea.addWidget({line: line, ch: character}, box[0], true);        
      };
    },
    controller: null
  }),
  
  CodeController: Em.Object.extend({
    validate: function(code, suppressBoxes) {
      this.get('codeMirrorView').clearErrors();
      var errors = this.get('syntaxChecker').check(code);
      if (errors) {
        $.ajax('/noteError', {
          type: 'post',
          data: {
            clientId: this.get('clientId'),
            sketchId: this.get('sketchId'),
            code: code,
            errors: JSON.stringify(errors)
          }
        });
        this.get('codeMirrorView').markErrors(errors, suppressBoxes);
      }
      return ! errors;
    },
    getCode: function() {
      return this.get('codeArea').getValue();
    },
    
    extra: null,
    
    codeAreaBinding: "codeMirrorView.codeArea",
    codeTemplate: 'run',
    sketchId: null,
    doSave: function(code, saveVersion, cb) {
      var data = {
        code: code,
        clientId: this.get('clientId'),
        template: this.get('codeTemplate'),
        saveVersion: saveVersion
      };
      if (this.get('extra')) {
        data.extra = this.get('extra');
      }
      $.ajax('/save/'+this.get('sketchId'), {
        type: 'post',
        data: data,
        success: function(data, textStatus, xhr) {
          if (data.status == 'ok') {
            (cb || Em.K)(true);
          } else {
            console.log("error!");
            (cb || Em.K)(false);
          }
        },
        error: function() {
          (cb || Em.K)(false);
        }
      });      
    }, 
    play: function() {
      // var randomId = ""+Math.round(Math.random()*10000000000);
      var sketchId = this.get('sketchId');
      var clientId = this.get('clientId');
      var code = this.getCode();
      if (! this.validate(code)) {
        return;
      }
      var instrumentedCode = this.get('instrumentor').instrument(code, JSLINT.tree); // JSLINT.tree is set in this.validate.
      this.doSave(code, true);
      var self = this;
      window.ProcessingWrapper.executeCode(instrumentedCode, this);
      // console.log("new window with", sketchId, clientId, randomId);
      // window.open('/play/'+[this.get('codeTemplate'), sketchId, clientId, randomId].join('/'), 'rudy-'+this.get('codeTemplate'));
    },
    parse: function() {
      var code = this.getCode();

      if (! this.validate(code)) {
        return;
      }
      var parser = new JSParser(code, {});
      console.log(JSLINT.tree, parser.getSyntaxTree());
    },
    // eval: function(code) {
    //   var interpreter = JSEvaluator.Interpreter;
    //   interpreter.set('builtIns', {
    //     
    //   })
    // },
    
    changeSaveTimeout: null,
    changeSaveState: 'saved',
    noteCodeChange: function() {
      var controller = this;
      switch (this.get('changeSaveState')) {
        case 'saved':
          this.set('changeSaveState', 'waiting');
          this.set('changeSaveTimeout', setTimeout(function() {
            controller.saveChangeTimeoutTriggered();
          }, 500));
          break;
        case 'saving':
          this.set('changeSaveState', 'dirty');
          break;
        case 'dirty':
        case 'waiting':
          // nothing to do.
        default:
          break;
      }
    },
    saveChangeTimeoutTriggered: function() {
      var controller = this;
      switch (this.get('changeSaveState')) {
        case 'waiting':
          this.set('changeSaveTimeout', null);
          this.doSave(this.getCode(), false, function(ok) {
            controller.saveChangeAjaxCompleted(ok);
          });
          this.set('changeSaveState', 'saving');
          break;
        case 'saving':
        case 'dirty':
          console.log("unacceptable saveChangeTimeoutTriggered call in state", this.get('changeSaveState'));
        case 'saved':
          // nothing to do.
        default:
          break;
      }
    },
    saveChangeAjaxCompleted: function(status) {
      var controller = this;
      switch (this.get('changeSaveState')) {
        case 'saving':
          if (status) {
            this.set('changeSaveState', 'saved');
            break;            
          }
        case 'dirty':
          this.set('changeSaveState', 'waiting');
          this.set('changeSaveTimeout', setTimeout(function() {
            controller.saveChangeTimeoutTriggered();
          }, 500));
          break;
        case 'waiting':
        case 'saved':
          console.log("unacceptable saveChangeAjaxCompleted call in state", this.get('changeSaveState'));
        default:
          break;
      }
    },
    
    statusLabel: function() {
      switch (this.get('codeMirrorView.status')) {
        case 'success':
          return {c: "label-success", l: "Connected"};
        case 'connecting':
          return {c: "label-warning", l: "Connecting..."};
        case 'disconnected':
        case 'stopped':
          return {c: "label-danger", l: "Disconnected"};
        case 'off':
          switch (this.get('changeSaveState')) {
            case 'saved':
              return {c: "label-success", l: "Saved"};
            case 'dirty':
            case 'waiting':
            case 'saving':
            default:
              return {c: "", l: "Saving..."};
          }
        default:
          return {c: "label-warning", l: "???"};
      }
    }.property('codeMirrorView.status', 'changeSaveState'),
    
    init: function() {
      this._super();
      this.set('syntaxChecker', CodingSupport.SyntaxChecker.create({codeTemplate: this.get('codeTemplate')}));
      this.set('instrumentor', CodingSupport.CodeInstrumentor.create());
      var controller = this;
      if (controller.showInitialState) {
        setTimeout(function() {controller.showInitialState()}, 250);        
      }
    }
  })
});

window.JSEvaluator = Em.Namespace.create({
  Scope: Em.Object.extend({
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
    getValue: function(name) {
      if (name in this.get('variables')) {
        return this.get('variables')[name];
      } else if (this.get('parent')) {
        return this.get('parent').getValue(name);
      } else {
        var interpreter = this.get('interpreter');
        // console.log("seeking otherwise undefined name", name, "in global scope");
        if (name in interpreter.get('builtIns')) {
          // console.log("...it exists, and...")
          var val = interpreter.get('builtIns')[name];
          if (typeof(val) == 'function') {
            // console.log("...it's a function.");
            return JSEvaluator.Function.create({ // make a "fake" function here.
              name: name,
              call: function(thisPtr, args) {
                var ret = val.apply(thisPtr, args);
                // console.log("calling external function", name, "with args", args, "returning", ret);
                return ret;
              }
            });
          } else if (typeof(val) == 'object') {
            return interpreter.newObject(val);
          } else {
            return val;
          }
        } else {
          return undefined;          
        }
      }
    },
    init: function() {
      this._super();
      this.set('variables', {}); // no variables set initially...
      if (! this.get('interpreter')) {
        throw new Error('Attempted to create a scope without an interpreter...');
      }
    }
  }),
  Function: Em.Object.extend({
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
    }
  }),
  Object: Em.Object.extend({
    id: Em.required(),
    underlying: Em.required(),
    init: function() {
      this._super();
      console.log("creating object with id", this.get('id'));
    }
  }),
  Interpreter: Em.Object.extend({
    builtIns: null,
    nextObjectId: 0,
    assert: function(expr, value) {
      if (expr != value) {
        throw new Error("Assertion failed: expected "+value+" was "+expr);
      }
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
      bk.value = bk.base.get('underlying')[bk.key];
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
          scope.declareValue(node.children[0]._text, this.evaluate(node.children[2], scope));
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
              return (bk.base.get('underlying')[bk.key] = this.evaluate(c[2], scope));
            case '+=':
              return (bk.base.get('underlying')[bk.key] = bk.value + this.evaluate(c[2], scope));
            case '-=':
              return (bk.base.get('underlying')[bk.key] = bk.value - this.evaluate(c[2], scope));
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
    evaluate: function(parserNode, scope) {
      if (parserNode instanceof Array) {
        return this.evaluateBlock(parserNode, scope);
      }
      switch (parserNode.name) {
        case 'program':
          return this.evaluateBlock(parserNode.children, scope);
        case 'functionDecl':
          var f = this.createFunction(parserNode, scope);
          if (f.name) {
            scope.declareValue(f.name, f);
          } // else what?
          return undefined;
        case 'functionExpr':
          var f = this.createFunction(parserNode, scope);
          if (f.name) {
            scope.declareValue(f.name, f); // should this happen in the non-declaration case?
          }
          return f;
        case 'expressionStmnt':
          return this.evaluateExpression(parserNode, scope);
        case 'call':
          return this.evaluateCall(parserNode, scope);
        case 'identifier':
          var out = scope.getValue(parserNode.children[0]._text);
          // console.log("lookup of", parserNode.children[0]._text, "in scope", scope, "=", out);
          return out;
        case 'dot':
          return this.evaluateDot(parserNode, scope);
        case 'bracket':
          return this.evaluateBracket(parserNode, scope);
        case 'binary':
          return this.evaluateBinary(parserNode, scope);
        case 'blockStmnt':
          this.assert(parserNode.children[0]._text, '{');
          this.assert(parserNode.children[parserNode.children.length-1]._text, '}');
          return this.evaluateBlock(parserNode.children.slice(1, parserNode.children.length-1), scope);
        case 'number': 
          return Number(parserNode.children[0]._text);
        case 'string':
          return eval(parserNode.children[0]._text);
        case 'object':
          return this.evaluateObject(parserNode, scope);
        case 'array':
          return this.evaluateArray(parserNode, scope);
        case 'this':
          return scope.getValue('this');
        case 'varStmnt':
          this.evaluateVar(parserNode, scope);
          return undefined;
        case 'assignment':
          return this.evaluateAssignment(parserNode, scope);
        case 'ifStmnt':
          this.evaluateIf(parserNode, scope);
          return undefined;
        case 'whileStmnt':
          this.evaluateWhile(parserNode, scope);
          return undefined;
        case 'prefix':
          return this.evaluatePrefix(parserNode, scope);
        case 'postfix':
          return this.evaluatePostfix(parserNode, scope);
        case 'parens':
          return this.evaluateBlock(parserNode.children.slice(1, parserNode.children.length-1), scope);
        case 'unary':
          return this.evaluateUnary(parserNode, scope);
        default:
          throw new Error("unknown node type: "+parserNode.name);
      }
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
    interpret: function(code, scope) {
      if (scope && scope.get('interpreter') != this) {
        throw new Error("Specified scope was not created by this interpreter.");
      }
      var parser = new JSParser(code, {});
      this.evaluate(parser.getSyntaxTree(), scope || this.get('globalScope'));
    },
    init: function() {
      this._super();
      this.set('globalScope', JSEvaluator.Scope.create({
        interpreter: this
      }));
    }
  })
})