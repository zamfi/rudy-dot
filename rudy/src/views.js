import {extra, flattenStack} from './util'
import {Scope} from './editor'

class ExpressionDemonstrator {
  constructor(code, stack, frame, elt) {
    this.code = code;
    this.stack = stack;

    this.rootFrameIndex = stack.length-1;
    this.rootFrame = frame;
  
    this.nodeCode = code.slice(frame.node.start, frame.node.end);

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

  subRender(startIndex, endIndex, startNode=null) {
    // console.log("subrender", startIndex, endIndex, this.rootFrameIndex);
    if (endIndex < this.rootFrameIndex) {
      let frame = this.frameAt(endIndex);
      if (frame) {
        if (frame.node.type === "AssignmentExpression" && frame.doneLeft_ && !frame.doneRight_) {
          return this.code.slice(frame.node.left.start, frame.node.left.end);
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

    switch (frame.node.type) {
    case 'Literal':
      return Scope.stringValue(frame.node.value, false);
    case 'Identifier':
      return frame.node.name; // XXX: might need something more complex here.

    // [doneLeft_:leftValue_,doneRight_]:value & nextFrame
    // [,] ; [true,] & left ; [true,]:lv ; [true:lv,true]:lv & right ; [true:lv,true]:rv ; popped(up one frame gets .value)
    case 'LogicalExpression':
    case 'BinaryExpression':
      prefix = this.code.slice(frame.node.start, frame.node.left.start);
      suffix = this.code.slice(frame.node.right.end, frame.node.end);
      if (frame.doneLeft_ && frame.doneRight_) {
        result = Scope.stringValue('leftValue_' in frame ? frame.leftValue_ : (frame.node.operator === '&&' ? true : false), false) + 
          this.code.slice(frame.node.left.end, frame.node.right.start) + 
          (nextFrame ? this.subRender(startIndex+1, endIndex, frame.node.right) : Scope.stringValue(frame.value, false));
      } else if (frame.doneLeft_) {
        result = (nextFrame ? this.subRender(startIndex+1, endIndex, frame.node.left) : Scope.stringValue(frame.value, false)) + this.code.slice(frame.node.left.end, frame.node.right.end);
      } else {
        return this.code.slice(frame.node.start, frame.node.end);
      }
      return prefix + result + suffix;
    case 'UnaryExpression':
      let opString = this.code.slice(frame.node.start, frame.node.argument.start);
      if (nextFrame) {
        return opString + this.subRender(startIndex+1, endIndex, frame.node.argument);
      } else {
        if ('value' in frame) {
          return opString + Scope.stringValue(frame.value, false);
        } else {
          return this.code.slice(frame.node.start, frame.node.end);
        }
      }
    case 'UpdateExpression':
      if (! nextFrame && ! ('leftValue_' in frame) && (! ('value' in frame) || frame.value instanceof Array)) {
        return this.code.slice(frame.node.start, frame.node.end);
      } else if (nextFrame) {
        return this.code.slice(frame.node.start, frame.node.argument.start) +
          this.subRender(startIndex+1, endIndex, frame.node.argument) + 
          this.code.slice(frame.node.argument.end, frame.node.end);
      } else {
        return Scope.stringValue('leftValue_' in frame ? frame.leftValue_ : frame.value, false);
      }
    case 'CallExpression':
      if (! nextFrame && frame.doneExec_ && extra(frame).checkedFunction && extra(frame).allArgsShown) {
        return Scope.stringValue(frame.value, false);
      }
      if (! frame.node.callee) {
        // probably a getter or something -- need to use the original identifier. :(
        return this.code.slice(startNode.start, startNode.end);
      }
      prefix = this.code.slice(frame.node.start, frame.node.callee.start);
      var callee = this.code.slice(frame.node.callee.start, frame.node.callee.end);
      if ('func_' in frame) {
        extra(frame).checkedFunction = true;
        if (Scope.functionName(frame.func_) !== callee) {
          callee = Scope.functionName(frame.func_);
        }
      }
      let fullArguments = frame.arguments_ && ! (frame.value instanceof Array) && frame.arguments_.length < frame.n_-(nextFrame?1:0) ? frame.arguments_.concat(frame.value) : frame.arguments_ || [];
      let args = frame.node.arguments.map((arg, i, args) => {
        let suffix = i < args.length-1 ? this.code.slice(arg.end, args[i+1].start) : "";
        if (i in fullArguments) {
          return Scope.stringValue(fullArguments[i], false) + suffix;
        } else if (nextFrame && i === frame.n_-1) {
          return this.subRender(startIndex+1, endIndex, arg) + suffix;
        } else {
          return this.code.slice(arg.start, arg.end) + suffix;
        }
      });
      if (fullArguments.length === frame.node.arguments.length) {
        extra(frame).allArgsShown = true;
      }
      if (args.length === 0) {
        return prefix + callee + this.code.slice(frame.node.callee.end, frame.node.end);
      } else {
        return [
          prefix,
          callee,
          this.code.slice(frame.node.callee.end, frame.node.arguments[0].start),
          args.join(""),
          this.code.slice(frame.node.arguments[frame.node.arguments.length-1].end, frame.node.end)
        ].join("");
      }
    case 'ConditionalExpression':
      prefix = this.code.slice(frame.node.start, frame.node.test.start);
      suffix = this.code.slice(frame.node.alternate.end, frame.node.end);
      if (frame.mode_ === 0) {
        return this.code.slice(frame.node.start, frame.node.end);
      } else if (frame.mode_ === 1) {
        return [
          prefix,
          (nextFrame ? this.subRender(startIndex+1, endIndex, frame.node.test) : Scope.stringValue(frame.value, false)),
          this.code.slice(frame.node.test.end, frame.node.end)
        ].join("");
      } else { // mode_ === 2
        if (nextFrame) {
          return this.subRender(startIndex+1, endIndex, frame.value ? frame.node.consequent : frame.node.alternate);
        } else {
          return Scope.stringValue(frame.value, false);
        }
      }
    default:
      return;
      // return Scope.stringValue(frame.value, true);
    }
  }

  render() {
    // console.log("rendering stack", flattenStack(this.stack), this.rootFrameIndex, this._latestFrame);
    let line = this.subRender(this.rootFrameIndex, this.lastIndex(), this.rootFrame.node);
    if (this.lines.length === 0) {
      if (line !== this.nodeCode && line !== 'undefined' && line !== null) {
        this.lines.push(line);
      }
    } else if (line !== null && line !== 'undefined' && this.lines[this.lines.length-1] !== line) {
      this.lines.push(line);
    }
    let result = this.lines.length === 0 ? "" : `<div class="expression-list"><div class="node-code">${this.nodeCode}</div>${this.lines.map(line => `<div class="expression">${line}</div>`).join("")}</div>`;
    // console.log("got from render", this.lines, result);
    return result;
  }
}

export {ExpressionDemonstrator}