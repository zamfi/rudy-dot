import React, { Component } from 'react';

class StackView extends Component {
  constructor(props) {
    super(props)
    
    this.state = {
      stack: []
    }
  }
  
  addNode(node) {
    this.setState({
      stack: this.state.stack.concat([node])
    });
  }
  
  removeNode() {
    this.setState({
      stack: this.state.stack.splice(0, this.state.stack.length-1)
    });
  }
  
  clear() {
    this.setState({
      stack: []
    });
  }
  
  render() {
    return <div className="stack-view">
             <div>El Stacko</div>
             {this.state.stack.map((frame, idx) => 
               <div key={`node-${idx}`}>
                 <div>Frame {idx}</div>
                 <FrameView key={`node-${idx}`} frame={frame} {...this.props} />
               </div>
              )}
           </div>
  }
}

function NodeView(props) {
  let keys = Object.keys(props.node).filter(k => props.node.hasOwnProperty(k));
  if (props.node.type === "VariableDeclaration") {
    console.log("node with declarations", props.node);
  }
  return <div className="stack-node-view">
      {keys.map(k => <div key={k}>{`node-${k}: ${props.node[k]}`}</div>)}
    </div>;
}

function ScopeView(props) {
  let isGlobalScope = !props.scope.parentScope;
  return <div className="stack-scope-view">
      <div>ParentScope: {String(props.scope.parentScope)}</div>
      {isGlobalScope ? '' : Object.keys(props.scope.properties).map(k => <div key={k}>{`${k}: ${props.scope.properties[k]}`}</div>)}
    </div>;
}

function propView(name, value) {
  switch(name) {
  case 'node':
    return <NodeView key={name} node={value} />;
  case 'scope':
    return <ScopeView key={name} scope={value} />;
  default:
    return <div key={name}>{`${name}: ${value}`}</div>;
  }
}

function FrameView(props) {
  let keys = Object.keys(props.frame).filter(k => props.frame.hasOwnProperty(k));
  return <div className="stack-frame-view">
           <CodeView code={props.code.slice(props.frame.node.start, props.frame.node.end)} />
           {keys.map(k => propView(k, props.frame[k]))}
         </div>
}

function CodeView(props) {
  return <div className="code-view"><pre>{props.code}</pre></div>
} 


export default StackView