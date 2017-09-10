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
				console.log("word!");
			}
		}
    
    this.markedLines = [];
	}
  
	createError(severity, line, ch, message, showMessage) {
    console.log("LINT ERROR", severity, line, ch, message);
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
      messageBox.parentElement.removeChild(messageBox);
    }
    this._cm.addWidget({line:line+1, ch:ch}, charIndicator);
    var lineHandle = this._cm.addLineClass(line+1, 'wrap', 'line-warning');
    this.markedLines.push(lineHandle);
	}
	
	clearErrors() {
    this.markedLines.forEach(line => this._cm.removeLineClass(line, 'wrap', 'line-warning'));
    this.markedLines = [];
    Array.from(document.getElementsByClassName('error')).forEach((elt) => elt.parentElement.removeChild(elt));
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
            console.log(x);
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
    // var padding = "";
    // var interpreter = this.get('runController');
    var startPos = this._cm.posFromIndex(frame.node.start);
    var endPos = this._cm.posFromIndex(frame.node.end);
    // var nodeLineCh = interpreter.getNodeLineCh(node);
    // var oldText = this._cm.getRange(startPos, endPos);

    // console.log("evaluating node", frame.node, "at depth", stack.length);
    var mark = this._cm.markText(startPos, endPos, {className:'eval'+stack.length});

    frame.node.__extra = {
      // visible: (nodeType == 'call' || nodeType == 'whileStmnt'),
      pos: {start: startPos, end: endPos},
      // text: this.get('codeArea').getRange(nodeLineCh.start, nodeLineCh.end)+"\n",
      mark: mark
    }
  }
  unhighlightNode(frame, stack) {
    var nodeType = frame.node.name;
    if (nodeType === 'Program') { return; }

    if (frame.node.__extra && frame.node.__extra.mark) {
      frame.node.__extra.mark.clear();
    }
  }
}

Editor.lintOptions = {
  'asi': true,
  'eqeqeq': false,
  '-W041': false
};

export default Editor;