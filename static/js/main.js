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
            });
            break;
          case 'rudy':
            predef.left = false;
            predef.right = false;
            predef.up = false;
            predef.down = false;
            predef.coloring = false;
            predef.setLevel = false;
            predef.trashRemaining = false;
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
        return this.showErrorBox(error.line-1, error.character, error.reason);
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
        codeArea.addWidget({line: line, ch: character-1||1}, box[0], true);        
      };
    },
    codeAreaBinding: "Main.controller.codeArea"
  }),
  
  controller: Em.Object.create({
    validate: function(code) {
      Main.errorController.clearErrors();
      var errors = Main.syntaxChecker.check(code);
      if (errors) {
        console.log(errors);
        Main.errorController.markErrors(errors);
      }
      return ! errors;
    },
    
    codeArea: null,
    codeTemplate: 'run',
    sketchId: null,
    doSave: function(randomId, code, pushVersion, cb) {
      var data = {
        code: code,
        pushVersion: pushVersion
      };
      if (randomId) {
        data.id = randomId;
      }
      $.ajax('/save/'+this.get('sketchId'), {
        type: 'post',
        data: data,
        success: function(data, textStatus, xhr) {
          if (data.status == 'ok') {
            cb(true);
          } else {
            console.log("error!");
            cb(false);
          }
        },
        error: function() {
          cb(false);
        }
      });      
    }, 
    play: function() {
      var randomId = Math.round(Math.random()*10000000000);
      var code = this.get('codeArea').getValue();
      if (! this.validate(code)) {
        return;
      }
      this.doSave(randomId, code, true);
      window.open('/'+this.get('codeTemplate')+'/'+randomId, 'rudy-'+this.get('codeTemplate'));
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
      this.doSave(null, this.get('codeArea').getValue(), false, function(ok) {
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
