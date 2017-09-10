import React, { Component } from 'react';
import { JSHINT } from 'jshint';

import { debounce, queryString } from './util';

import Editor from './editor';
import './rudy.css'
import RudyRunner from './runner'


class Rudy extends Component {
  constructor(props) {
    super(props);
      
    this.state = {
      controllerState: 'stopped',
      executionSpeed: 4,
      currentLevel: 1,
      saveState: 'saved',
      clientId: ""+Math.round(Math.random()*1000000000),
      sketchId: null,
      clonedTo: null,
      clonedFrom: null,
      loadingError: null
    };
    
    [ 'run', 
      'stop', 
      'reset',
      'changeSpeed',
      'nextLevel',
      'previousLevel',
      'updateCanvasParent',
      'codeChangeHandler',
      'createNewSketch',
      'refreshFrame'
    ].forEach(name => this[name] = this[name].bind(this))
    
    this.saveSoon = debounce(() => this.doSave(), 2000)
  }
  
  componentDidMount() {
    let sketchId = this.getUrlSketchId();
    
    if (sketchId !== undefined) {
      this.loadSketch(sketchId);
    }
  }  
  
  normalView() {
    return (
      <div className="app">
        <RudyToolbar 
          runState={this.state.controllerState}
          saveState={this.state.saveState}
          executionSpeed={this.state.executionSpeed}
          runFn={this.run}
          stopFn={this.stop} 
          resetFn={this.reset}
          changeSpeed={this.changeSpeed}
          currentLevel={this.state.currentLevel}
          nextLevel={this.state.clonedTo || this.state.everSolved ? this.nextLevel : false}
          previousLevel={this.state.clonedFrom ? this.previousLevel : false}/>
        <div className="editor-panel">
          <Editor initialCode={this.state.loadedCode} ref={(ed) => this._editor = ed} onChange={this.codeChangeHandler}/>
          <RudySidebar updateCanvasParent={this.updateCanvasParent} />
        </div>
      </div>
    );
  }
  
  loadingView() {
    return (
      <div className="app">
      {this.state.loadingError
        ? <p>Failed to load your sketch... Try a <a className="link" onClick={this.createNewSketch}>new sketch</a>?</p>
        : <p>Loading your sketch...</p> }
      </div>
    )
  }
  
  freshPageView() {
    return (
      <div className="app">
        <h1>Greetings!</h1>
        <p>Start with a <a className="link" onClick={this.createNewSketch}>new sketch</a>.</p>
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
        if (this.saveSoon.cancel()) {
          await this.doSave();
        }
        let url = `/edit/${json.sketchId}`;
        if (window.location.pathname !== url) {
          window.history.pushState(json, null, url);
        }
        this.setState({
          sketchId: json.sketchId,
          clonedFrom: json.extra ? json.extra.clonedFrom : null,
          clonedTo: json.extra ? json.extra.clonedTo : null,
          executionSpeed: json.extra && json.extra.executionSpeed !== undefined ? json.extra.executionSpeed : this.state.executionSpeed,
          currentLevel: json.extra ? Number(json.extra.level) || 1 : 1,
          loadedCode: json.code,
          loadingError: null,
          everSolved: false
        }, () => {
          this.refreshFrame();
          this._editor.setCode(json.code);
        });
      } else {
        this.setState({
          sketchId: null,
          loadingError: `Error ${json.status}: ${json.err}`
        });
      }
    }
  }
  
  createNewSketch() {
    this.updateStateFromResponse(fetch('/api/new'));
  }
  
  cloneCurrentSketch() {
    this.updateStateFromResponse(fetch(`/api/new?${queryString({
      level: Number(this.state.currentLevel) + 1, 
      executionSpeed: this.state.executionSpeed,
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
  
  async doSave(asVersion) {
    // console.log("Saving!");
    let code = this._editor.currentCode();
    let url = `/api/save?${queryString({
      clientId: this.state.clientId,
      sketchId: this.state.sketchId,
      saveVersion: asVersion ? "true" : "false",
      extra: JSON.stringify({level: this.state.currentLevel, executionSpeed: this.state.executionSpeed})
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
    this.setState({saveState: 'saving'});
    this.saveSoon()
  }
  
  refreshFrame() {
    if (this._canvasParent) {
      let rudyRunner = new RudyRunner("", this.state.currentLevel, 0, this._canvasParent)
      rudyRunner.run((done) => {
        // nothing to do here.
      }, true);
    }    
  }
  
  nextLevel() {
    // console.log("Next", this.state.clonedTo);
    this.stop();
    if (this.state.clonedTo) {
      this.loadSketch(this.state.clonedTo);
    } else {
      this.cloneCurrentSketch();
    }
  }
  
  previousLevel() {
    // console.log("Previous", this.state.clonedFrom);
    this.stop();
    if (this.state.clonedFrom) {
      this.loadSketch(this.state.clonedFrom);
    }
  }
  
  
  updateCanvasParent(elt) {
    console.log("updating canvas parent");
    this._canvasParent = elt
    this.refreshFrame();
  }
  
  static evaluationDelay(executionSpeed) {
    return Math.pow(2, 10-executionSpeed)
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
      this._editor.freezeErrors();;
      return;
    } else {
      this._editor.clearErrors();
    }
    this._editor.disableEditing();
    this.doSave(true);
    // console.log("Creating runner with parent", this._canvasParent);
    this.rudyRunner = new RudyRunner(this._editor.currentCode(), this.state.currentLevel, Rudy.evaluationDelay(this.state.executionSpeed), this._canvasParent, this._editor)
    this.setState({ controllerState: 'running' }, () =>
      this.rudyRunner.run((success) => {
        if (success === true) {
          this.setState({ everSolved: true });
        }
        this.stop();
      })
    );
  }
  
  stop() {
    if (this.state.controllerState !== 'stopped') {
      this.setState({ controllerState: 'stopped' });
      this.rudyRunner.stop();
    }
    this._editor.enableEditing();
  }
  
  reset() {
    // stub
  }
  
  changeSpeed(event) {
    let executionSpeed = event.target.value
    this.setState({ executionSpeed });
    if (this.rudyRunner) {
      this.rudyRunner.setEvaluationDelay(Rudy.evaluationDelay(executionSpeed));
    }
    this.saveSoon();
  }
}

class RudyToolbar extends Component {
  button() {
    switch (this.props.runState) {
    case 'stopped':
      return { title: "▶ Run", action: this.props.runFn }
    case 'running':
      return { title: "◼ Stop", action: this.props.stopFn }
    default:
      return { title: "Reset", action: this.props.resetFn }
    }
  }
    
  render() {
    let button = this.button();
    
    return <div className="toolbar">
        <div className="toolbar-entry">
          <button className="run button" onClick={button.action}>{button.title}</button>
        </div>
        <SaveWidget status={this.props.saveState} label={this.props.saveState} />
        <div className="toolbar-entry">
          Speed: <input min="0" max="10" step="0.25" type="range" onChange={this.props.changeSpeed} value={this.props.executionSpeed} />
        </div>
        <div className="toolbar-entry">
          {this.props.previousLevel ? <a className="link" onClick={this.props.previousLevel}> &laquo; go back </a> : null}
        </div>
        <div className="toolbar-entry">
          Level: <strong>{this.props.currentLevel}</strong>
        </div>
        <div className="toolbar-entry">
          {this.props.nextLevel ? <button className="button advance" onClick={this.props.nextLevel}> Advance &rarr; </button> : null}
        </div>
      </div>
  }
}

class RudySidebar extends Component {
  render() {
    return <div id="rudy-sidebar"><RudyDisplay {...this.props} /><RudySyntaxHelper /></div>
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
    return <div className="toolbar-entry">
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