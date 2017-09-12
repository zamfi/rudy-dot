import React, { Component } from 'react';
import CodeMirror from 'codemirror';
import 'codemirror/mode/javascript/javascript'
import 'codemirror/keymap/sublime';
import 'codemirror/addon/selection/active-line';
import 'codemirror/addon/lint/lint';
import 'codemirror/addon/lint/javascript-lint';
import 'codemirror/addon/comment/comment';
import 'codemirror/lib/codemirror.css'
import { JSHINT } from 'jshint';
import { debounce } from './util';

import './editor.css'


window.JSHINT = JSHINT

class Editor extends Component {
	constructor(props) {
		super(props);
		this.beep = {
			play() {
        // console.log("word!");
			}
		}
    
    this.markedLines = [];
	}
  
	createError(severity, line, ch, message, showMessage) {
    // console.log("LINT ERROR", severity, line, ch, message);
    // let elt = document.createElement('div');
    // elt.className = "callout errorbox";
    // elt.innerHTML = `<div class="close">&times;</div>
    //                   <span>${message}</span>
    //                   <div class="border-notch notch"></div>
    //                   <div class="notch"></div>`
    // elt.getElementsByClassName('close')[0].onclick = () => elt.parentElement.removeChild(elt);

    let charIndicator = document.createElement('div');
    charIndicator.className = "callout error";
    charIndicator.innerHTML = `<div class="indicator"></div>`
    let messageBox = document.createElement('div');
    messageBox.className = "callout error";
    messageBox.innerHTML = `<div class="box">
                              <div class="close">&times;</div>
                              <span>${message}</span>
                              <div class="border-notch notch"></div>
                              <div class="notch"></div>
                            </div>`
    if (showMessage) {
      this._cm.addWidget({line:line+1, ch:ch}, messageBox);
    } else {
      charIndicator.onmouseenter = () => {
        this._cm.addWidget({line:line+1, ch:ch}, messageBox);      
      }
    }
    messageBox.getElementsByClassName('close')[0].onclick = () => {
      messageBox.remove();
    }
    this._cm.addWidget({line:line+1, ch:ch}, charIndicator);
    var lineHandle = this._cm.addLineClass(line+1, 'wrap', 'line-warning');
    this.markedLines.push(lineHandle);
	}
	
	clearErrors() {
    this.markedLines.forEach(line => this._cm.removeLineClass(line, 'wrap', 'line-warning'));
    this.markedLines = [];
    Array.from(document.getElementsByClassName('error')).forEach((elt) => elt.remove());
	}
  
  getNodePosition(node) {
    return this._cm.posFromIndex(node.start);
  }
	
	componentDidMount() {
    this._cm = CodeMirror(this.cmContainer, { // eslint-disable-line
      // theme: `p5-${this.props.theme}`,
			mode: "javascript",
      value: this.props.initialCode,
			tabSize: 2,
      lineNumbers: true,
      styleActiveLine: true,
      inputStyle: 'contenteditable',
      lineWrapping: false,
      fixedGutter: false,
      gutters: ['CodeMirror-lint-markers'],
      keyMap: 'sublime',
      highlightSelectionMatches: true, // highlight current search match
      lint: {
        onUpdateLinting: debounce((annotations) => {
          if (this._errorsFrozen) {
            return;
          }
					this.clearErrors();
          annotations.forEach((x) => {
            if (annotations.length > 1 && x.message.startsWith("Unrecoverable syntax error")) {
              return;
            }
            // console.log(x);
            if (x.from.line > -1) {
              this.createError(x.severity, (x.from.line - 1), x.from.ch, x.message);
            }
          });
          if (this.markedLines.length > 0 && this.props.lintWarning !== false) {
            this.beep.play();
          }
        }, 2000),
        options: Editor.lintOptions
      }
    });
    this._cm.on('change', () => { this._errorsFrozen = false; this.props.onChange() });
		
		this._cm.setSize("100%", "100%")
	}
	
	_cm: CodeMirror.Editor
	
	render() {
		return <div className="cm-container" ref={(elt) => this.cmContainer = elt}></div>
	}
	
	currentCode() {
		return this._cm.getDoc().getValue();
	}
  
  setCode(code) {
    this._cm.off('change', this.props.onChange);
    this._cm.getDoc().setValue(code);
    this._cm.on('change', this.props.onChange);
  }
  
  disableEditing() {
    this._cm.setOption('readOnly', 'nocursor');
  }
  
  enableEditing() {
    this._cm.setOption('readOnly', false);
  }
  
  freezeErrors() {
    this._errorsFrozen = true;
  }
  
  highlightNode(frame, stack) {
    var nodeType = frame.node.type;
    if (nodeType === 'Program') { return; }
    var startPos = this._cm.posFromIndex(frame.node.start);
    var endPos = this._cm.posFromIndex(frame.node.end);
    
    var mark = this._cm.markText(startPos, endPos, {className:'eval'+stack.length});

    if (! frame.node.__extra) {
      frame.node.__extra = {};
    }
    frame.node.__extra.pos = {start: startPos, end: endPos};
    if (! frame.node.__extra.marks) {
      frame.node.__extra.marks = [];
    }
    frame.node.__extra.marks.push(mark);
  }
  unhighlightNode(frame, stack) {
    var nodeType = frame.node.name;
    if (nodeType === 'Program') { return; }

    if (frame.node.__extra && frame.node.__extra.marks) {
      frame.node.__extra.marks.pop().clear();
    }
  }

  showGlobalVariables(frame) {
    return frame.node.declarations.map(decl => {
      let elt = document.createElement('div')
      elt.className = "callout"
      
      let handler = new SingleVarTracker(frame.scope, decl, elt);
      handler.render();

      let pos = this._cm.posFromIndex(decl.init.start);
      this._cm.addWidget(pos, elt);
      
      return handler;
    });
  }
  
  showFrameScope(frame) {
    let node = frame.node;
    let scope = frame.scope;
    
    let scopeViewElement = document.createElement('div');
    let scopeHandler = new Scope(scope, scopeViewElement);
    scopeHandler.render();
    
    let pos = this._cm.posFromIndex(node.start);
    
    this._cm.addWidget(pos, scopeViewElement);
    node.__extra.scope = scopeHandler;

    return scopeHandler;
  }
  
  removeFrameScope(frame) {
    if (frame.node.__extra && frame.node.__extra.scope) {
      frame.node.__extra.scope.remove();
    }
  }
  
  clearFrameScopes() {
    Array.from(document.getElementsByClassName('scope')).forEach(elt => elt.remove());
    Array.from(document.getElementsByClassName('variable')).forEach(elt => elt.remove());
  }
  
  showExpressionCalculation(frame) {
    
  }
}

Editor.lintOptions = {
  'asi': true,
  'eqeqeq': false,
  '-W041': false
};

class Scope {
  constructor(scope, elt) {
    this.scope = scope;
    this.elt = elt;
    this.elt.className = "callout";
    this.showHidden = false;
  }
  
  static stringValue(v) {
    if (typeof(v) === 'object') {
      switch(v.class) {
      case 'Function':
        return `function <strong>${v.nativeFunc ? (v.nativeFunc.name || v.__name) : (v.node.id ? v.node.id.name : "<em>anonymous</em>")}</strong>`;
      case 'Array':
        return `[${Array.from(v.properties).map(Scope.stringValue).join(', ')}]`;
      default:
        return String(v);
      }
    } else if (typeof(v) === 'string'){
      return `"<strong>${v}</strong>"`
    } else {
      return `<strong>${String(v)}</strong>`;
    }
  }
  
  value(k) {
    return Scope.stringValue(this.scope.properties[k]);
  }
  
  render() {
    this.elt.innerHTML = ['<table class="scope">',
      this.scope.properties
        ? Object.keys(this.scope.properties)
            .filter(this.showHidden ? k => k : k => k !== 'this' && k !== 'arguments')
            .map(k => `<tr class="scope-entry"><th>${k}</th><td>${this.value(k)}</td></tr>`)
            .join("")
        : "",
      '</table>'].join('\n');
          
  }
  
  update() {
    this.render();
  }
  
  remove() {
    this.elt.remove();
  }
}

class SingleVarTracker {
  constructor(scope, declaration, elt) {
    this.scope = scope;
    this.name = declaration.id.name;
    this.elt = elt;
  }
  
  render() {
    this.elt.innerHTML = `<div class="variable">${Scope.stringValue(this.scope.properties[this.name])}</div>`
  }
  
  update() {
    this.render();
  }
  
  remove() {
    this.elt.remove();
  }
}

export default Editor;