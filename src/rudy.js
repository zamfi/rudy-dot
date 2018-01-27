import React, { Component } from 'react';
import { JSHINT } from 'jshint';

import { debounce, queryString } from './util';

import Editor from './editor';
import './rudy.css'
import {RudyCodeRunner, SketchCodeRunner, CodeRunner} from './runner'
import StackView from './stack'


class Rudy extends Component {
  constructor(props) {
    super(props);
      
    this.state = {
      controllerState: 'stopped',
      executionSpeed: 4,
      showExecution: true,
      type: "rudy",
      extra: {},
      saveState: 'saved',
      clientId: ""+Math.round(Math.random()*1000000000),
      sketchId: null,
      loadingError: null
    };
    
    [ 'run', 
      'stop', 
      'reset',
      'pause',
      'resume',
      'step',
      'changeSpeed',
      'setShowExecution',
      'updateCanvasParent',
      'codeChangeHandler',
      'createNewSketch',
      'cloneCurrentSketch',
      'loadSketch',
      'refreshFrame'
    ].forEach(name => this[name] = this[name].bind(this))
    
    let saveSoon = debounce(() => this.doSave(), 2000);
    this.saveSoon = () => {
      // console.log("save soon!");
      this.setState({saveState: 'saving'});
      saveSoon();
    }
    this.saveSoon.cancel = saveSoon.cancel;
  }
  
  componentDidMount() {
    let sketchId = this.getUrlSketchId();
    
    if (sketchId !== undefined) {
      this.loadSketch(sketchId);
    }
    
    window.onpopstate = (event) => {
      this.loadSketch(this.getUrlSketchId());
    }
  }  
  
  normalView() {
    // console.log("normal view of type", this.state.extra.type);
    let Toolbar = this.state.extra.type === 'p5' ? SketchToolbar : RudyToolbar;
    
    return (
      <div className="app">
        <Toolbar 
          runState={this.state.controllerState}
          saveState={this.state.saveState}
          executionSpeed={this.state.executionSpeed}
          showExecution={this.state.showExecution}
          runFn={this.run}
          stopFn={this.stop} 
          resetFn={this.reset}
          pauseFn={this.pause}
          resumeFn={this.resume}
          stepFn={this.step}
          changeSpeed={this.changeSpeed}
          setShowExecution={this.setShowExecution}
          canChangeShowExecution={this.state.controllerState === 'stopped'}
          loadSketch={this.loadSketch}
          cloneCurrentSketch={this.cloneCurrentSketch}
          extra={this.state.extra}
          everSolved={this.state.everSolved}
          ref={bar => this._toolbar = bar}
          />
        <div className="editor-panel">
          <Editor 
            initialCode={this.state.loadedCode} 
            theme={this.state.extra.type === 'p5' ? 'playground' : 'default'}
            ref={(ed) => this._editor = ed} 
            showExecution={this.state.showExecution}
            onChange={this.codeChangeHandler}/>
          {this.props.showStackView ? <StackView ref={(stack) => this._stack = stack} code={this.state.latestCode} /> : ""}
          <RudySidebar updateCanvasParent={this.updateCanvasParent} isRunning={this.state.controllerState !== 'stopped'} refreshFrame={this.refreshFrame}/>
        </div>
      </div>
    );
  }
  
  loadingView() {
    return (
      <div className="app">
      {this.state.loadingError
        ? <p>Failed to load your sketch... Try a <a className="link" onClick={() => this.createNewSketch({type: 'rudy', level: 1})}>new sketch</a>?</p>
        : <p>Loading your sketch...</p> }
      </div>
    )
  }
  
  freshPageView() {
    let level = Number(window.location.hash.substr(1) || 1)
    if (isNaN(level)) {
      level = 1;
    }
    
    return (
      <div className="app homepage">
        <h1>Rudy the Red Dot</h1>
        <a className="link" onClick={() => this.createNewSketch({type: 'rudy', level: level})}>Start puzzles at level {level} &raquo;</a>
        <a className="link" onClick={() => this.createNewSketch({type: 'p5'})}>Create p5.js playground &raquo;</a>
      </div>
    );
  }
  
  render() {
    if (this.state.sketchId === null) {
      if (this.getUrlSketchId() !== undefined) {
        return this.loadingView()
      } else {
        return this.freshPageView();        
      }
    } else {
      return this.normalView();
    }
  }

  _editor: Editor

  //// Controller
  
  _canvasParent: null
  
  async updateStateFromResponse(response) {
    let res = await response;
    if (res.status !== 200) {
      this.setState({
        sketchId: null,
        loadingError: `Error ${res.status}: ${res.statusText}`
      });      
    } else {
      let json = await res.json();
      if (json.status === 'ok') {
        // force a save if there's one pending
        if (this.saveSoon.cancel && this.saveSoon.cancel()) {
          await this.doSave();
        }
        let url = `/edit/${json.sketchId}`;
        if (window.location.pathname !== url) {
          window.history.pushState(json, null, url);
        }
        let saveSoon = this.saveSoon;
        this.saveSoon = () => {};
        this.setState({
          sketchId: json.sketchId,
          extra: json.extra,
          executionSpeed: json.extra && json.extra.executionSpeed !== undefined ? json.extra.executionSpeed : this.state.executionSpeed,
          loadedCode: json.code,
          loadingError: null,
          everSolved: false
        }, () => {
          this.refreshFrame();
          this._editor.setCode(json.code);
          this.saveSoon = saveSoon;
        });
      } else {
        this.setState({
          sketchId: null,
          loadingError: `Error ${json.status}: ${json.err}`
        });
      }
    }
  }
  
  createNewSketch(extra) {
    this.updateStateFromResponse(fetch(`/api/new?${queryString({
      extra: JSON.stringify(Object.assign({}, extra, {executionSpeed: this.state.executionSpeed})),
    })}`));
  }
  
  cloneCurrentSketch(extra) {
    this.updateStateFromResponse(fetch(`/api/new?${queryString({
      extra: JSON.stringify(Object.assign({}, extra, {executionSpeed: this.state.executionSpeed})),
      cloneCode: this.state.sketchId
    })}`));
  }

  loadSketch(sketchId) {
    this.updateStateFromResponse(fetch(`/api/read?id=${sketchId}`))
  }
  
  getUrlSketchId() {
    let pathComponents = window.location.pathname.split('/')
    if (pathComponents[1] === 'edit' && pathComponents[2] !== undefined) {
      return pathComponents[2];
    }
    return undefined;
  }
  
  noteErrors(errors) {
    fetch(new Request(`/api/error?${queryString({
      clientId: this.state.clientId,
      sketchId: this.state.sketchId,
      extra: JSON.stringify(Object.assign({}, this._toolbar.extra(), {executionSpeed: this.state.executionSpeed}))
    })}`, {
      method: 'POST',
      body: JSON.stringify({code: this._editor.currentCode(), errors})
    }));
  }
  
  async doSave(asVersion) {
    // console.log("Saving!");
    let code = this._editor.currentCode();
    let url = `/api/save?${queryString({
      clientId: this.state.clientId,
      sketchId: this.state.sketchId,
      saveVersion: asVersion ? "true" : "false",
      extra: JSON.stringify(Object.assign({}, this._toolbar.extra(), {executionSpeed: this.state.executionSpeed}))
    })}`
    try {
      let response = await fetch(new Request(url, {
        method: 'POST',
        body: code
      }));
      let json = await response.json()
      if (! json.status || json.status !== 'ok') {
        this.setState({saveState: 'error'});
        // console.log(json);
        return;
      }      
    } catch (err) {
      this.setState({saveState: 'error'});
      console.log("Error saving!", err);
      return;
    }
    this.setState({saveState: 'saved'});
  }

  codeChangeHandler() {
    this.saveSoon()
  }
  
  refreshFrame() {
    if (this._toolbar && this._canvasParent) {
      let codeRunner = this._toolbar.codeRunner("", 0, this._canvasParent);
      // console.log("running with runner", codeRunner, "to refresh frame");
      codeRunner.run((done) => {
        // nothing to do here.
      }, true);
    }    
  }  
  
  updateCanvasParent(elt) {
    // console.log("updating canvas parent");
    this._canvasParent = elt
    this.refreshFrame();
  }
  
  static evaluationDelay(executionSpeed) {
    if (executionSpeed == 10) { // eslint-disable-line eqeqeq
      return 0;
    }
    return Math.pow(2, 10-executionSpeed);
  }
  
  run() {
    let code = this._editor.currentCode();
    JSHINT(code, Editor.lintOptions);
    let annotations = JSHINT.data().errors;
    if (annotations && annotations.length > 0) {
      this._editor.clearErrors();
      annotations.forEach((x) => {
        if (annotations.length > 1 && x.reason.startsWith("Unrecoverable syntax error")) {
          return;
        }
        if (x.line > -1) {
          this._editor.createError(x.id, x.line-2, x.character-1, x.reason, true);
        }
      })
      this._editor.freezeErrors();
      this.noteErrors(annotations);
      return;
    } else {
      this._editor.clearErrors();
    }
    this._editor.disableEditing();
    this.doSave(true);
    // console.log("Creating runner with parent", this._canvasParent);
    this.codeRunner = this._toolbar.codeRunner(
      this._editor.currentCode(),
      Rudy.evaluationDelay(this.state.executionSpeed), 
      this._canvasParent, 
      this._editor,
      this._stack);
    this.setState({ 
      controllerState: 'running',
      latestCode: this._editor.currentCode()
    }, () => {
      // console.log("running with runner", this.codeRunner, "!");
      this.codeRunner.run((success) => {
        if (success === true) {
          this.setState({ everSolved: true });
        }
        this.stop();
      })
    });
  }
  
  stop() {
    if (this.state.controllerState !== 'stopped') {
      this.setState({ controllerState: 'stopped' });
      this.codeRunner.stop();
    }
    this._editor.enableEditing();
  }
  
  pause() {
    if (this.state.controllerState === 'running') {
      this.setState({ controllerState: 'paused' });
      this.codeRunner.pause();
    }
  }
  
  resume() {
    if (this.state.controllerState === 'paused') {
      this.setState({ controllerState: 'running' });
      this.codeRunner.resume();
    }
  }
  
  step() {
    if (this.state.controllerState === 'paused') {
      this.codeRunner.step();
    }
  }
  
  reset() {
    // stub
  }
  
  changeSpeed(event) {
    let executionSpeed = event.target.value
    this.setState({ executionSpeed });
    if (this.codeRunner) {
      this.codeRunner.setEvaluationDelay(Rudy.evaluationDelay(executionSpeed));
    }
    this.saveSoon();
  }
  
  setShowExecution(event) {
    this.setState({ showExecution: !! event.target.checked });
  }
}

class BaseToolbar extends Component {
  extra() {
    return Object.assign({}, this.props.extra);
  }
  
  buttons() {
    switch (this.props.runState) {
    case 'stopped':
      return [{ type: 'run', title: "▶ Run", action: this.props.runFn }];
    case 'running':
      return [{ type: 'pause', title: "‖ Pause", action: this.props.pauseFn }];
    case 'paused':
      return [{ type: 'resume', title: "▶ Resume", action: this.props.resumeFn }, 
              { type: 'step', title: "➔ Step", action: this.props.stepFn },
              { type: 'stop', title: "◼ Stop", action: this.props.stopFn }];
    default:
      return [{ type: 'reset', title: "Reset", action: this.props.resetFn }];
    }
  }
  
  render() {
    let buttons = this.buttons();
    
    return <div className="toolbar">
        <div className="toolbar-entry">
          {buttons.map(button => <button key={button.type} className={`action button ${button.type}`} onClick={button.action}>{button.title}</button>)}
        </div>
        <SaveWidget status={this.props.saveState} label={this.props.saveState} />
        <div className="toolbar-entry execution-controls">
          Speed: <input min="0" max="10" step="0.25" type="range" onChange={this.props.changeSpeed} value={this.props.executionSpeed} /><br/>
          <label>Show execution: <input type="checkbox" disabled={this.props.canChangeShowExecution ? "" : "disabled"} checked={this.props.showExecution} onChange={this.props.setShowExecution} /></label>
        </div>
      </div>
  }
  
  codeRunner(code, executionDelay, canvasParent, editor, stack) {
    console.error("Using base code runner?");
    return new CodeRunner(code, executionDelay, canvasParent, editor, stack);
  }
}

class SketchToolbar extends BaseToolbar {
  extra() {
    return Object.assign(super.extra(), {type: 'p5'});
  }
  
  codeRunner(code, executionDelay, canvasParent, editor, stack) {
    // console.log("sketch code runner!");
    return new SketchCodeRunner(code, executionDelay, canvasParent, editor, stack);
  }
}

class RudyToolbar extends BaseToolbar {
  nextLevel() {
    // console.log("Next", this.state.clonedTo);
    this.props.stopFn();
    if (this.props.extra.clonedTo) {
      this.props.loadSketch(this.props.extra.clonedTo);
    } else {
      this.props.cloneCurrentSketch({type: 'rudy', level: Number(this.props.extra.level) + 1});
    }
  }
  
  previousLevel() {
    // console.log("Previous", this.state.clonedFrom);
    this.props.stopFn();
    if (this.props.extra.clonedFrom) {
      this.props.loadSketch(this.props.extra.clonedFrom);
    }
  }
  
  codeRunner(code, executionDelay, canvasParent, editor, stack) {
    // console.log("rudy code runner");
    return new RudyCodeRunner(code, this.props.extra.level, executionDelay, canvasParent, editor, stack);
  }

  extra() {
    return Object.assign(super.extra(), {type: 'rudy'});
  }

  render() {
    let buttons = this.buttons();
    
    return <div className="toolbar">
        <div className="toolbar-entry">
          {buttons.map(button => <button key={button.type} className={`action button ${button.type}`} onClick={button.action}>{button.title}</button>)}
        </div>
        <SaveWidget status={this.props.saveState} label={this.props.saveState} />
        <div className="toolbar-entry execution-controls">
          Speed: <input min="0" max="10" step="0.25" type="range" onChange={this.props.changeSpeed} value={this.props.executionSpeed} /><br />
          <label>Show execution: <input type="checkbox" disabled={! this.props.canChangeShowExecution} checked={this.props.showExecution} onChange={this.props.setShowExecution} /></label>
        </div>
        <div className="toolbar-entry">
        </div>
        <div className="toolbar-entry">
          {this.props.extra.clonedFrom ? <a className="link" onClick={() => this.previousLevel()}> &laquo; go back </a> : null}
        </div>
        <div className="toolbar-entry">
          Level: <strong>{this.props.extra.level}</strong>
        </div>
        <div className="toolbar-entry">
          {this.props.extra.clonedTo || this.props.everSolved ? <button className="button advance" onClick={() => this.nextLevel()}> Advance &rarr; </button> : null}
        </div>
      </div>
  }
}

class RudySidebar extends Component {
  render() {
    return <div id="rudy-sidebar">
      <RudyDisplay {...this.props} />
      <div className="canvas-toolbar"><button className="button refresh" disabled={this.props.isRunning} onClick={this.props.refreshFrame}>⟳ Refresh</button></div>
      <RudySyntaxHelper />
    </div>
  }
}

class RudyDisplay extends Component {
  shouldComponentUpdate(newProps) {
    return false;
  }

  render() {
    return <div id="rudy-canvas-parent" ref={ (elt) => this.props.updateCanvasParent(elt) } />
  }
}

class SaveWidget extends Component {
  render() {
    return <div className="toolbar-entry save">
      <span className={`label save ${this.props.status}`}>{this.props.label}</span>
    </div>
  }
}

function RudySyntaxHelper() {
  let content = `
  <h3>Programming Syntax Cheat Sheet</h3>
    <h4>Naming &amp; updating</h4>
    <p>Create a new name:
      <pre style="color: #d14;">var numberOfDots = 1;</pre>
    </p>
    <p>Update a name’s value:
      <pre style="color: #d14;">numberOfDots = numberOfDots + 1;</pre>
      This line computes the value of <code>numberOfDots&nbsp;+&nbsp;1</code>, and stores the new value in <code>numberOfDots</code>.
    </p>

    <h4>If, else</h4>
    <p>Run some code if a condition is true:
      <pre style="color: #d14">if (getColor() == "blue") {
  right();
} else {
  left();
}</pre>
This code tells Rudy to go right if the current color is blue, and left otherwise. The <code>else { ... }</code> clause is optional.</p>

    <h4>While</h4>
    <p>Repeat some code as long as a condition is true:
      <pre style="color: #d14;">while (getColor() == "blue") {
  down();
}</pre>
This code tells Rudy to go down as long as the square Rudy is currently on is blue.</p>
    <p>Other possible condition checks include:</p>
    <table cellspacing="0">
      <tr><td><code>!=</code></td><td><p>(not equal to)</p></td></tr>
      <tr><td><code>&lt; </code></td><td><p>(less than)</p></td></tr>
      <tr><td><code>&lt;=</code></td><td><p>(less than or equal to)</p></td></tr>
      <tr><td><code>&gt; </code></td><td><p>(greater than)</p></td></tr>
      <tr><td><code>&gt;=</code></td><td><p>(greater than or equal to)</p></td></tr>
    </table>
    <p>Combine conditions with logical <code>||</code> (or) and <code>&&</code> (and), like:
      <pre style="color: #d14;">if ((getColor() == "red") || (total &lt; 8)) { 
  right(); 
}</pre>
    </p>

    <h4>Functions</h4>
    <p>To execute the <code>repeatDown</code> function:
      <pre style="color: #d14;">repeatDown(5);</pre>
      This function <code>repeatDown</code> is executed with one parameter: the number <code>5</code>.
    </p>
    <p>To define the <code>repeatDown</code> function:
      <pre style="color: #d14;">function repeatDown(total) {
  var count = 0;
  while (count < total) {
    down();
    count = count + 1;
  }
}</pre>
The previous example, <code>repeatDown(5)</code>, sets <code>total = 5</code> inside the body of the <code>repeatDown</code> function.
    </p>`
  return <div className="rudy-syntax-helper" dangerouslySetInnerHTML={{__html: content}} />
}

export default Rudy;