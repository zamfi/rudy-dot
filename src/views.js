import {extra, hideBadEntities} from './util'
import {Scope} from './editor'

class ExpressionDemonstrator {
  constructor(code, stack, frame, elt) {
    this.code = code;
    this.stack = stack;

    this.rootFrameIndex = stack.length-1;
    this.rootFrame = frame;
  
    this.nodeCode = this.codeAt(frame.node.start, frame.node.end);

    this.lines = [];
  
    this.elt = elt;
  }

  pushedFrame(frame) {
    // console.log("pushed", frame);
    this.update();
  }
  
  poppedFrame(frame) {
    // console.log("popped", frame);
    this._latestFrame = frame;
    this.update();
    delete this._latestFrame;
  }
  
  stepComplete() {
    // console.log("stepped", this.stack.top());
    this.update();
  }

  update() {
    // try {
      this.elt.innerHTML = this.render();
    // } catch (e) {
      // debugger;
    // }
  }

  remove() {
    // console.log("removing demonstrator for", this.code.slice(this.rootFrame.node.start, this.rootFrame.node.end));
    this.elt.remove();
  }

  frameAt(index) {
    if (index < this.stack.length) {
      return this.stack[index];
    } else {
      return undefined;
    }
  }
  lastIndex() {
    let topFrameIndex = this.stack.length-1;
    if (topFrameIndex < this.rootFrameIndex) {
      return topFrameIndex;
    }
    let last = this.rootFrameIndex;
    while (last < topFrameIndex && 'expressionDemonstrator' in extra(this.frameAt(last))) {
      last++;
    }
    return last;
  }

  codeAt(start, end) {
    return hideBadEntities(this.code.slice(start, end));
  }

  subRender(startIndex, endIndex, startNode=null) {
    // console.log("subrender", startIndex, endIndex, this.rootFrameIndex);
    if (endIndex < this.rootFrameIndex) {
      let frame = this.frameAt(endIndex);
      if (frame) {
        if (frame.node.type === "AssignmentExpression" && frame.doneLeft_ && !frame.doneRight_) {
          return this.codeAt(frame.node.left.start, frame.node.left.end);
        }
        let strVal = Scope.stringValue(frame.value, false);
        return strVal;
      }
      return;
    }
    let frame = this.frameAt(startIndex);
    let nextFrame = startIndex < endIndex ? this.frameAt(startIndex+1) : null;

    var result;
    var prefix;
    var suffix;

    // console.log("Rendering frame", frame.node.type, !!(nextFrame), frame);
    switch (frame.node.type) {
    case 'Literal':
      return Scope.stringValue(frame.node.value, false);
    case 'Identifier':
      return frame.node.name; // XXX: might need something more complex here.

    // [doneLeft_:leftValue_,doneRight_]:value & nextFrame
    // [,] ; [true,] & left ; [true,]:lv ; [true:lv,true]:lv & right ; [true:lv,true]:rv ; popped(up one frame gets .value)
    case 'LogicalExpression':
    case 'BinaryExpression':
      prefix = this.codeAt(frame.node.start, frame.node.left.start);
      suffix = this.codeAt(frame.node.right.end, frame.node.end);
      if (frame.doneLeft_ && frame.doneRight_) {
        result = Scope.stringValue('leftValue_' in frame ? frame.leftValue_ : (frame.node.operator === '&&' ? true : false), false) + 
          this.codeAt(frame.node.left.end, frame.node.right.start) + 
          (nextFrame ? this.subRender(startIndex+1, endIndex, frame.node.right) : Scope.stringValue(frame.value, false));
      } else if (frame.doneLeft_) {
        result = (nextFrame ? this.subRender(startIndex+1, endIndex, frame.node.left) : Scope.stringValue(frame.value, false)) + this.codeAt(frame.node.left.end, frame.node.right.end);
      } else {
        return this.codeAt(frame.node.start, frame.node.end);
      }
      return prefix + result + suffix;
    case 'UnaryExpression':
      let opString = this.codeAt(frame.node.start, frame.node.argument.start);
      if (nextFrame) {
        return opString + this.subRender(startIndex+1, endIndex, frame.node.argument);
      } else {
        if ('value' in frame) {
          return opString + Scope.stringValue(frame.value, false);
        } else {
          return this.codeAt(frame.node.start, frame.node.end);
        }
      }
    case 'UpdateExpression':
      if (! nextFrame && ! ('leftValue_' in frame) && (! ('value' in frame) || frame.value instanceof Array)) {
        return this.codeAt(frame.node.start, frame.node.end);
      } else if (nextFrame) {
        return this.codeAt(frame.node.start, frame.node.argument.start) +
          this.subRender(startIndex+1, endIndex, frame.node.argument) + 
          this.codeAt(frame.node.argument.end, frame.node.end);
      } else {
        return Scope.stringValue('leftValue_' in frame ? frame.leftValue_ : frame.value, false);
      }
    case 'CallExpression':
      // console.log("CallExpression", frame);
      if (! nextFrame && frame.doneExec_ && extra(frame).checkedFunction && extra(frame).allArgsShown) {
        return Scope.stringValue(frame.value, false);
      }
      if (! frame.node.callee) {
        // probably a getter or something -- need to use the original identifier. :(
        // but really this breaks some member expressions that rely on native wrapper getters...
        // those have an extra CallExprsesion that doesn't render properly.
        return this.codeAt(startNode.start, startNode.end);
      }
      prefix = this.codeAt(frame.node.start, frame.node.callee.start);
      var callee = this.codeAt(frame.node.callee.start, frame.node.callee.end);
      if ('func_' in frame && frame.func_ !== undefined) {
        extra(frame).checkedFunction = true;
        let fname = Scope.functionName(frame.func_);
        if (fname !== callee && fname !== "<em>anonymous</em>" && fname !== "wrapper") {
          callee = fname;
        }
      } else if (nextFrame) {
        callee = this.subRender(startIndex+1, endIndex, frame.node.callee);
      } else if (frame.doneCallee_ === 1 && Array.isArray(frame.value)) {
        let [obj, prop] = frame.value;
        if (Scope.stringValue(obj, false) === "{}") {
          prefix = prop;
        } else {
          // console.log('f', obj);
          prefix = Scope.stringValue(obj, false);
          if (frame.node.callee.type === "MemberExpression") {
            prefix += this.codeAt(frame.node.callee.object.end, frame.node.callee.property.start)
            prefix += prop;
            prefix += this.codeAt(frame.node.callee.property.end, frame.node.callee.end);
          } else {
            return "???" // does this ever happen?
          }
        }
        return prefix + this.codeAt(frame.node.callee.end, frame.node.end);
      }
      let fullArguments = frame.arguments_ && ! (frame.value instanceof Array) && frame.arguments_.length < frame.n_-(nextFrame?1:0) ? frame.arguments_.concat(frame.value) : frame.arguments_ || [];
      let args = frame.node.arguments.map((arg, i, args) => {
        let suffix = i < args.length-1 ? this.codeAt(arg.end, args[i+1].start) : "";
        if (i in fullArguments) {
          // console.log('g');
          return Scope.stringValue(fullArguments[i], false) + suffix;
        } else if (nextFrame && i === frame.n_-1) {
          // console.log('h', nextFrame, arg);
          return this.subRender(startIndex+1, endIndex, arg) + suffix;
        } else {
          // console.log('i');
          return this.codeAt(arg.start, arg.end) + suffix;
        }
      });
      if (fullArguments.length === frame.node.arguments.length) {
        extra(frame).allArgsShown = true;
      }
      if (args.length === 0) {
        // console.log('j');
        return prefix + callee + this.codeAt(frame.node.callee.end, frame.node.end);
      } else {
        // console.log('k', args);
        return [
          prefix,
          callee,
          this.codeAt(frame.node.callee.end, frame.node.arguments[0].start),
          args.join(""),
          this.codeAt(frame.node.arguments[frame.node.arguments.length-1].end, frame.node.end)
        ].join("");
      }
    case 'ConditionalExpression':
      prefix = this.codeAt(frame.node.start, frame.node.test.start);
      suffix = this.codeAt(frame.node.alternate.end, frame.node.end);
      if (frame.mode_ === 0 || ! ('mode_' in frame)) {
        return this.codeAt(frame.node.start, frame.node.end);
      } else if (frame.mode_ === 1) {
        return [
          prefix,
          (nextFrame ? this.subRender(startIndex+1, endIndex, frame.node.test) : Scope.stringValue(frame.value, false)),
          this.codeAt(frame.node.test.end, frame.node.end)
        ].join("");
      } else { // mode_ === 2
        if (nextFrame) {
          return this.subRender(startIndex+1, endIndex, frame.value ? frame.node.consequent : frame.node.alternate);
        } else {
          return Scope.stringValue(frame.value, false);
        }
      }
    case 'AssignmentExpression':
      prefix = this.codeAt(frame.node.start, frame.node.right.start);
      if (frame.doneRight_) {
        if (nextFrame) {
          return prefix + this.subRender(startIndex+1, endIndex, frame.node.right);
        } else {
          return prefix + Scope.stringValue(frame.value, false) + this.codeAt(frame.node.right.end, frame.node.end);
        }
      } else {
        return this.codeAt(frame.node.start, frame.node.end);
      }
    case 'FunctionExpression':
      return `function <strong>${Scope.functionName(frame)}</strong>`;
    case 'MemberExpression':
      if (! frame.object_) {
        suffix = this.codeAt(frame.node.object.end, frame.node.end);
        if (nextFrame) {
          // console.log('a');
          return this.subRender(startIndex+1, endIndex, frame.node.object) + suffix;
        } else if ('value' in frame) {
          // console.log('b');
          return Scope.stringValue(frame.value, false) + suffix;
        }
      } else {
        prefix = Scope.stringValue(frame.object_, false);
        if (prefix === '{}') { // don't bother showing this, probably a built-in object.
          prefix = this.codeAt(frame.node.object.start, frame.node.object.end);
        }
        // console.log('c', prefix);
        if (frame.node.computed) {
          // console.log('d');
          return prefix + this.codeAt(frame.node.object.end, frame.node.property.start) +
                  (nextFrame ? this.subRender(startIndex+1, endIndex, frame.node.property) 
                             : Scope.stringValue(frame.value, false))+
                  this.codeAt(frame.node.property.end, frame.node.end);
        } else {
          // console.log('e', prefix + this.codeAt(frame.node.object.end, frame.node.end));
          return prefix + this.codeAt(frame.node.object.end, frame.node.end);
        }
      }
      // console.log("fallthrough!");
      return this.codeAt(frame.node.start, frame.node.end);
    default:
      console.log("rendering unknown expression type!", frame);
      return "???";
    }
  }

  render() {
    // console.log("rendering stack", flattenStack(this.stack), this.rootFrameIndex, this._latestFrame);
    let line = this.subRender(this.rootFrameIndex, this.lastIndex(), this.rootFrame.node);
    if (this.lines.length === 0) {
      if (line !== this.nodeCode && line !== 'undefined' && line !== null) {
        this.lines.push(line);
      }
    } else if (line !== null && line !== 'undefined' && this.lines[this.lines.length-1] !== line && this.lines[this.lines.length-2] !== line) {
      this.lines.push(line);
    }
    let result = this.lines.length === 0 ? "" : `<div class="expression-list"><div class="node-code">${this.nodeCode.split('\n')[0]}</div>${this.lines.map(line => `<div class="expression">${line}</div>`).join("")}</div>`;
    // console.log("got from render", this.lines, result);
    return result;
  }
}

export {ExpressionDemonstrator}