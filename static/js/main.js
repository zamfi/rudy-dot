window.Main = Em.Application.create({
  syntaxChecker: Em.Object.create({
    codeTemplateBinding: "Main.controller.codeTemplate",
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
            predef.setLevel = false;
            predef.remainingDots = false;
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
        forin: true
      });
      if (! pass) {
        return JSLINT.errors;
      }
    }
  }),
  
  instrumentor: Em.Object.create({
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
      // console.log(checkPoints);
      var newCode = lines.join("\n");
      // console.log(newCode);
      return newCode;
    },
    test: function() {
      var code = Main.controller.getCode();
      Main.controller.validate(code);
      console.log(this.instrument(code, JSLINT.tree));
    }
  }),
  
  errorController: Em.Object.create({
    markedLines: [],
    clearErrors: function() {
      $('.errorbox').remove();
      var codeArea = this.get('codeArea')
      this.get('markedLines').forEach(function(lineHandle) {
        codeArea.setLineClass(lineHandle, null, null);
        codeArea.clearMarker(lineHandle);
      });
      this.set('markedLines', []);
    },
    markErrors: function(errors) {
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
        return this.showErrorBox(error.line-1, error.character-1||1, error.reason);
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
    codeAreaBinding: "Main.controller.codeArea"
  }),
  
  controller: Em.Object.create({
    validate: function(code) {
      Main.errorController.clearErrors();
      var errors = Main.syntaxChecker.check(code);
      if (errors) {
        $.ajax('/noteError', {
          type: 'post',
          data: {
            code: code,
            errors: JSON.stringify(errors)
          }
        });
        Main.errorController.markErrors(errors);
      }
      return ! errors;
    },
    getCode: function() {
      return this.get('codeArea').getValue();
    },
    
    codeArea: null,
    codeTemplate: 'run',
    sketchId: null,
    doSave: function(randomId, code, instrumentedCode, pushVersion, cb) {
      var data = {
        code: code,
        pushVersion: pushVersion
      };
      if (instrumentedCode) {
        data.instrumentedCode = instrumentedCode;
      }
      if (randomId) {
        data.id = randomId;
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
      var randomId = Math.round(Math.random()*10000000000);
      var code = this.get('codeArea').getValue();
      if (! this.validate(code)) {
        return;
      }
      var instrumentedCode = Main.instrumentor.instrument(code, JSLINT.tree);
      this.doSave(randomId, code, instrumentedCode, true);
      window.open('/'+this.get('codeTemplate')+'/'+sketchId+'/'+randomId, 'rudy-'+this.get('codeTemplate'));
    },
    
    status: function() {
      return this.get('saveTimeout') ? 'icon-refresh' : 'icon-ok';
    }.property('saveTimeout'),
    statusTitle: function() {
      return this.get('saveTimeout') ? 'saving...' : 'saved';
    }.property('saveTimeout'),
    
    saveTimeout: null,
    lastChange: new Date(),
    timeoutFunction: function() {
      var savedChange = this.get('lastChange');
      var self = this;
      this.doSave(null, this.get('codeArea').getValue(), null, false, function(ok) {
        if (self.get('lastChange') > savedChange) {
          self.set('saveTimeout', setTimeout(function() { self.timeoutFunction() }, 1000));
        } else {
          if (ok) {
            self.set('saveTimeout', null);
          } else {
            self.set('saveTimeout', setTimeout(function() { self.timeoutFunction() }, 1000));
          }
        }
      });
    },
    noteCodeChange: function() {
      this.set('lastChange', new Date());
      if (! this.get('saveTimeout')) {
        if (! this.get('saveTimeout')) {
          var self = this;
          this.set('saveTimeout', setTimeout(function() { self.timeoutFunction() }, 1000));
        }
      }
    },

    resizeCodeMirror: function() {
      var codeArea = this.get('codeArea');
      var winHeight = window.innerHeight || (document.documentElement || document.body).clientHeight;
      codeArea.getScrollerElement().style.height = (winHeight - 60) + " px";
      codeArea.refresh();
    },
    
    createCodeArea: function() {
      var self = this;
      var codeArea = CodeMirror.fromTextArea($('#editor')[0], {
        mode: "javascript",
        tabSize: 2,
        lineNumbers: true,
        onChange: function() {
          self.noteCodeChange();
        }
      });
      this.set('codeArea', codeArea);
      CodeMirror.connect(window, 'resize', function() { self.resizeCodeMirror(); });
      this.resizeCodeMirror();
    }
  })
});

$(function() {
  document.onkeypress = function(e) {
    if ((e.ctrlKey || e.metaKey) && e.keyCode == 114) { // Ctrl-R
      e.preventDefault();
      window.Main.controller.play();
    }
  }
  window.Main.controller.createCodeArea();
});
