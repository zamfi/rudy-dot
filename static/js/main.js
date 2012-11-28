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
      window.ProcessingWrapper.executeCode(code /* instrumentedCode */, this);
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
