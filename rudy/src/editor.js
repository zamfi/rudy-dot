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
    
    this._markedLines = [];
    this._activeEvaluations = [];
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
    this._markedLines.push(lineHandle);
	}
	
	clearErrors() {
    this._markedLines.forEach(line => this._cm.removeLineClass(line, 'wrap', 'line-warning'));
    this._markedLines = [];
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
          if (this._markedLines.length > 0 && this.props.lintWarning !== false) {
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
    scopeViewElement.className = "callout";
    
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
    Array.from(document.getElementsByClassName('scope')).forEach(elt => elt.parentElement.remove());
    Array.from(document.getElementsByClassName('variable')).forEach(elt => elt.parentElement.remove());
  }
  
  createEvaluationCallout(code, stack, frame) {
    // console.log("making callout for frame", frame);
    let elt = document.createElement('div');
    elt.className = "callout";
    
    let view = new ExpressionView(code, stack, frame, elt);
    this._activeEvaluations.push(view);
    
    this._cm.addWidget(this._cm.posFromIndex(frame.node.start), elt);
    view.update(frame);
  }
  
  hasActiveEvaluationCallouts() {
    return this._activeEvaluations.length > 0;
  }
  
  updateEvaluationCallout(stack, frame) {
    let view = ExpressionView.parentView(stack, frame);
    // console.log("updating callout for frame", frame, view);
    if (view) {
      view.update(frame);
    }
  }
  
  removeEvaluationCallout(expressionView) {
    expressionView.remove();
    this._activeEvaluations.splice(this._activeEvaluations.indexOf(expressionView), 1);
  }
  
  clearEvaluations() {
    Array.from(document.getElementsByClassName('expression-list')).forEach(elt => elt.parentElement.remove());
    this._activeEvaluations = [];
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
    this.showHidden = false;
  }
  
  static stringValue(v, noStrong) {
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
      return noStrong ? `"${v}"` : `"<strong>${v}</strong>"`
    } else {
      return noStrong ? String(v) : `<strong>${String(v)}</strong>`;
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

class ExpressionView {
  constructor(code, stack, frame, elt) {
    this.code = code;
    this.stack = stack;

    this.rootFrameIndex = stack.length-2; // it's the second-to-last frame on the stack
    this.rootFrame = stack[this.rootFrameIndex]; 
    
    this.nodeCode = code.slice(frame.node.start, frame.node.end);

    if (! this.rootFrame.node.__extra) {
      this.rootFrame.node.__extra = {};
    }
    this.rootFrame.node.__extra.expressionView = this;
    this.lines = [];
    
    this.elt = elt;
  }
  
  static parentView(stack, frame) {
    let index = stack.indexOf(frame);
    if (index < 0) {
      index = stack.length-1;
    }
    while (index >= 0 && (! stack[index].node.__extra || ! stack[index].node.__extra.expressionView)) {
      index--;
    }
    // console.log("found parentView at index", index);
    return index < 0 ? false : stack[index].node.__extra.expressionView || false;
  }
  
  update(frame) {
    this._latestFrame = frame;
    this.elt.innerHTML = this.render(frame);
    
    return 
  }
  
  remove() {
    this.elt.remove();
  }
  
  // [doneLeft_:leftValue_,doneRight_]:value & nextFrame
  // [,] ; [true,] & left ; [true,]:lv ; [true:lv,true]:lv & right ; [true:lv,true]:rv ; popped(up one frame gets .value)
  
  renderTopFrame(index) {
    let frame = this.frameAt(index);
    // console.log("rendering top frame", index, frame);
    
    switch (frame.node.type) {
    case 'BinaryExpression':
      if (frame.doneLeft_ && frame.doneRight_) {
        return Scope.stringValue(frame.leftValue_, true) + this.code.slice(frame.node.left.end, frame.node.right.start) + Scope.stringValue(frame.value, true);
      } else if (frame.doneLeft_) {
        return Scope.stringValue(frame.value, true) + this.code.slice(frame.node.left.end, frame.node.end);
      } else {
        return this.code.slice(frame.node.start, frame.node.end);
      }
    case 'UnaryExpression':
      if ('value' in frame) {
        return this.code.slice(frame.node.start, frame.node.argument.start) + Scope.stringValue(frame.value, true);
      } else {
        return this.code.slice(frame.node.start, frame.node.end);
      }
    case 'Literal':
      return Scope.stringValue(frame.node.value, true);
    case 'Identifier':
      return frame.node.name;
    case 'CallExpression':
      if (frame.doneExec_) {
        return Scope.stringValue(frame.value, true);
      }
      let callee = this.code.slice(frame.node.callee.start, frame.node.callee.end);
      let fullArguments = frame.arguments_ && ! (frame.value instanceof Array) && frame.arguments_.length < frame.n_ ? frame.arguments_.concat(frame.value) : [];
      let args = frame.node.arguments.map((arg, i, args) => {
        let suffix = i < args.length-1 ? this.code.slice(arg.end, args[i+1].start) : "";
        if (i in fullArguments) {
          return Scope.stringValue(fullArguments[i], true) + suffix;
        // } else if (i === frame.n_) { // XX: No subrender for top of frame!
        //   return this.subRender(startIndex+1, endIndex) + suffix;
        } else {
          return this.code.slice(arg.start, arg.end) + suffix;
        }
      });
      if (args.length === 0) {
        return callee + this.code.slice(frame.node.callee.end, frame.node.end);
      } else {
        return [
          callee,
          this.code.slice(frame.node.callee.end, frame.node.arguments[0].start),
          args.join(""),
          this.code.slice(frame.node.arguments[frame.node.arguments.length-1].end, frame.node.end)
        ].join("");
      }
    case 'BlockStatement':
      return null;
    default:
      return;
      // return Scope.stringValue(frame.value, true);
    }
  }
  
  frameAt(index) {
    if (index < this.stack.length) {
      return this.stack[index];
    } else if (index === this.stack.length && this._latestFrame !== this.stack.top() && this._latestFrame) {
      return this._latestFrame;
    } else {
      return undefined;
    }
  }
  lastIndex() {
    let topFrameIndex = this.stack.length-1+(this._latestFrame === this.stack.top() || !this._latestFrame ? 0 : 1);
    let last = this.rootFrameIndex;
    while (last < topFrameIndex) {
      if (this.frameAt(last).node.type === 'BlockStatement') {
        return last-1;
      }
      last++;
    }
    return last;
  }
  
  subRender(startIndex, endIndex) {
    if (endIndex <= this.rootFrameIndex) {
      return Scope.stringValue(this.frameAt(endIndex).value, true);
    }
    if (startIndex === endIndex) {
      return this.renderTopFrame(startIndex);
    }
    let frame = this.frameAt(startIndex);
    // console.log("subrendering", startIndex, endIndex, frame);

    switch (frame.node.type) {
    case 'BinaryExpression':
      if (frame.doneLeft_ && frame.doneRight_) {
        return Scope.stringValue(frame.leftValue_, true) + this.code.slice(frame.node.left.end, frame.node.right.start) + this.subRender(startIndex+1, endIndex);
      } else if (frame.doneLeft_) {
        return this.subRender(startIndex+1, endIndex) + this.code.slice(frame.node.left.end, frame.node.end);
      } else {
        return this.code.slice(frame.node.start, frame.node.end);
      }
    case 'UnaryExpression':
      return this.code.slice(frame.node.start, frame.node.argument.start) + this.subRender(startIndex+1, endIndex);
      // if ('value' in frame) {
      //   return this.code.slice(frame.node.start, frame.node.argument.start) + Scope.stringValue(frame.value, true);
      // } else {
      //   return this.code.slice(frame.node.start, frame.node.end);
      // }
    case 'CallExpression':
      // if (frame.doneExec_) {
      //   return Scope.stringValue(frame.value, true);
      // }
      let callee = this.code.slice(frame.node.callee.start, frame.node.callee.end);
      let fullArguments = frame.arguments_ && ! (frame.value instanceof Array) && frame.arguments_.length < frame.n_-1 ? frame.arguments_.concat(frame.value) : frame.arguments_ || [];
      let args = frame.node.arguments.map((arg, i, args) => {
        let suffix = i < args.length-1 ? this.code.slice(arg.end, args[i+1].start) : "";
        if (i in fullArguments) {
          return Scope.stringValue(fullArguments[i], true) + suffix;
        } else if (i === frame.n_-1) {
          return this.subRender(startIndex+1, endIndex) + suffix;
        } else {
          return this.code.slice(arg.start, arg.end) + suffix;
        }
      });
      if (args.length === 0) {
        return callee + this.code.slice(frame.node.callee.end, frame.node.end);
      } else {
        return [
          callee,
          this.code.slice(frame.node.callee.end, frame.node.arguments[0].start),
          args.join(""),
          this.code.slice(frame.node.arguments[frame.node.arguments.length-1].end, frame.node.end)
        ].join("");
      }
    case 'BlockStatement':
      return null;
    default:
      return;
      // return Scope.stringValue(frame.value, true);
    }
  }
  
  render() {
    let line = this.subRender(this.rootFrameIndex+1, this.lastIndex());
    // console.log("line!", line);
    if (this.lines.length === 0) {
      if (line !== this.nodeCode && line !== 'undefined' && line !== null) {
        this.lines.push(line);
      }
    } else if (line !== null && line !== 'undefined' && this.lines[this.lines.length-1] !== line) {
      this.lines.push(line);
    }
    let result = this.lines.length === 0 ? "" : `<div class="expression-list"><div class="node-code">${this.nodeCode}</div>${this.lines.map(line => `<div class="expression">${line}</div>`).join("")}</div>`;
    // console.log("rendering stack", this.stack, this._latestFrame, this.lines, result);
    return result;
  }
}

export default Editor;